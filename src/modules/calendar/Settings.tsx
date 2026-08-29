// 日程表设置抽屉（受控组件；配置走 Page 的 useModuleConfig；导入源管理自取数据）
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import type { CalendarConfig } from "./config";

const VIEW_OPTIONS = [
  { value: "day", label: "日视图" },
  { value: "week", label: "周视图" },
  { value: "month", label: "月视图" },
];

const REMIND_OPTIONS = [
  { value: 0, label: "准时" },
  { value: 5, label: "提前 5 分钟" },
  { value: 10, label: "提前 10 分钟" },
  { value: 30, label: "提前 30 分钟" },
  { value: 60, label: "提前 1 小时" },
];

interface IcsImportInfo {
  id: number;
  name: string;
  imported_at: number;
  count: number;
}

export function CalendarSettings({
  cfg,
  onUpdate,
  onImportsChanged,
}: {
  cfg: CalendarConfig;
  onUpdate: (p: Partial<CalendarConfig>) => void;
  onImportsChanged?: () => void;
}) {
  const [imports, setImports] = useState<IcsImportInfo[]>([]);

  const loadImports = () => {
    invoke<IcsImportInfo[]>("calendar_list_ics_imports").then(setImports).catch(() => {});
  };
  useEffect(() => {
    loadImports();
  }, []);

  const removeImport = async (it: IcsImportInfo) => {
    if (!window.confirm(`删除「${it.name}」？它导入的 ${it.count} 条事件将一并清除，其它数据不受影响。`)) return;
    try {
      await invoke("calendar_delete_ics_import", { id: it.id });
      toast("已删除该日历文件及其数据");
      loadImports();
      onImportsChanged?.();
    } catch (e) {
      toast(`删除失败：${e}`);
    }
  };

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">事件提醒</div>
          <div className="text-xs text-muted-foreground">事件开始前按提前量发系统通知（电脑开着才收得到）</div>
        </div>
        <Switch checked={cfg.reminderEnabled} onCheckedChange={(v) => onUpdate({ reminderEnabled: v })} />
      </div>
      {cfg.reminderEnabled && (
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">提前量</div>
            <div className="text-xs text-muted-foreground">像手机闹钟的「提前提醒」</div>
          </div>
          <Select value={String(cfg.eventRemindMinutes)} onValueChange={(v) => onUpdate({ eventRemindMinutes: Number(v) })}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REMIND_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">待办过期提醒</div>
          <div className="text-xs text-muted-foreground">今天截止还没做的待办，当日提醒一次</div>
        </div>
        <Switch checked={cfg.todoOverdueRemind} onCheckedChange={(v) => onUpdate({ todoOverdueRemind: v })} />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">默认视图</div>
          <div className="text-xs text-muted-foreground">打开日程表先看到哪个视图</div>
        </div>
        <Select value={cfg.defaultView} onValueChange={(v) => onUpdate({ defaultView: v as CalendarConfig["defaultView"] })}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEW_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">周视图显示周末</div>
          <div className="text-xs text-muted-foreground">关闭后只显示周一到周五</div>
        </div>
        <Switch checked={cfg.weekShowWeekend} onCheckedChange={(v) => onUpdate({ weekShowWeekend: v })} />
      </div>

      <div className="space-y-2">
        <div>
          <div className="text-sm font-medium">已导入的日历文件</div>
          <div className="text-xs text-muted-foreground">
            按文件整份管理：删一个 .ics，它导入的事件一起清除；其中的事件可随时单独编辑
          </div>
        </div>
        {imports.length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            还没有可管理的导入文件（早于本功能的导入数据无来源标记，不影响使用）
          </div>
        ) : (
          imports.map((it) => (
            <div key={it.id} className="flex items-center gap-2 rounded-lg border p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{it.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {it.count} 条 · {new Date(it.imported_at).toLocaleString("zh-CN")}
                </div>
              </div>
              <button
                onClick={() => removeImport(it)}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                title="删除整份"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}