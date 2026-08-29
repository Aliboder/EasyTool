// 日程表设置抽屉（受控组件；配置走 Page 的 useModuleConfig；数据管理自取数据）
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { fmtKeyLong } from "./utils";
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

interface StatsPayload {
  events: number;
  recurring: number;
  todos: number;
  todos_pending: number;
  imports: number;
}

interface ManageEvent {
  id: number;
  title: string;
  location: string;
  start_ms: number;
  end_ms: number;
  all_day: boolean;
  rrule: string | null;
}

function threeMonthsAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [events, setEvents] = useState<ManageEvent[]>([]);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [purgeDate, setPurgeDate] = useState(threeMonthsAgo);

  const loadStats = () => {
    invoke<StatsPayload>("calendar_stats").then(setStats).catch(() => {});
  };
  const loadEvents = () => {
    invoke<ManageEvent[]>("calendar_list_all_events").then(setEvents).catch(() => {});
  };
  const loadImports = () => {
    invoke<IcsImportInfo[]>("calendar_list_ics_imports").then(setImports).catch(() => {});
  };
  const refreshAll = () => {
    loadStats();
    loadEvents();
    loadImports();
    onImportsChanged?.();
  };
  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return kw
      ? events.filter((e) => e.title.toLowerCase().includes(kw) || e.location.toLowerCase().includes(kw))
      : events;
  }, [events, keyword]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirmTwice(`删除选中的 ${ids.length} 条事件？`)) return;
    try {
      const n = await invoke<number>("calendar_delete_events", { ids });
      toast(`已删除 ${n} 条`);
      setSelected(new Set());
      refreshAll();
    } catch (e) {
      toast(`删除失败：${e}`);
    }
  };

  const purgeOld = async () => {
    const [y, m, d] = purgeDate.split("-").map(Number);
    const beforeMs = new Date(y, m - 1, d).getTime();
    const count = events.filter((e) => e.rrule == null && e.start_ms < beforeMs).length;
    if (count === 0) {
      toast("该日期前没有可清理的单次事件");
      return;
    }
    const key = y * 10000 + m * 100 + d;
    if (!confirmTwice(`将删除 ${count} 条「${fmtKeyLong(key)}」前的单次事件（重复规则保留，可单独删）。`)) return;
    try {
      const n = await invoke<number>("calendar_purge_before", { beforeMs });
      toast(`已清理 ${n} 条旧事件`);
      refreshAll();
      loadRangeOnly();
    } catch (e) {
      toast(`清理失败：${e}`);
    }
  };

  const loadRangeOnly = () => onImportsChanged?.();

  const clearTodos = async (onlyDone: boolean) => {
    const label = onlyDone ? "已完成" : "全部";
    if (!confirmTwice(`清空${label}待办？`)) return;
    try {
      const n = await invoke<number>("calendar_clear_todos", { onlyDone });
      toast(`已清空 ${n} 条待办`);
      refreshAll();
    } catch (e) {
      toast(`操作失败：${e}`);
    }
  };

  const clearAll = async () => {
    if (!confirmTwice("清空全部数据（事件/待办/导入文件）？")) return;
    try {
      await invoke("calendar_clear_all");
      toast("已清空全部数据");
      refreshAll();
    } catch (e) {
      toast(`操作失败：${e}`);
    }
  };

  /// 二级确认：危险（批量/全量、不可恢复）操作必须再确认一次
  const confirmTwice = (scope: string): boolean =>
    window.confirm(scope) && window.confirm("最后确认：此操作不可恢复，真的要执行吗？");

  const removeImport = async (it: IcsImportInfo) => {
    if (!confirmTwice(`删除「${it.name}」？它导入的 ${it.count} 条事件将一并清除，其它数据不受影响。`)) return;
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

      {/* 数据管理 */}
      <div className="space-y-2">
        <div>
          <div className="text-sm font-medium">数据管理</div>
          <div className="text-xs text-muted-foreground">批量清理与逐条管理，删除不可恢复</div>
        </div>
        {stats && (
          <div className="grid grid-cols-4 gap-1.5 text-center">
            {[
              [stats.events, "事件"],
              [stats.recurring, "重复规则"],
              [stats.todos_pending, "未完成待办"],
              [stats.imports, "导入文件"],
            ].map(([n, label]) => (
              <div key={label as string} className="rounded-lg border p-1.5">
                <div className="text-base font-bold tabular-nums">{n}</div>
                <div className="text-[10px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={purgeDate}
            onChange={(e) => setPurgeDate(e.target.value)}
            className="w-36"
            title="删除此日期之前的单次事件"
          />
          <Button variant="outline" size="sm" onClick={purgeOld}>
            删除此日期前的旧事件
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => clearTodos(true)}>
            清除已完成待办
          </Button>
          <Button variant="outline" size="sm" onClick={() => clearTodos(false)}>
            清空全部待办
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-600"
            onClick={clearAll}
          >
            清空全部数据
          </Button>
        </div>

        {/* 精细管理：事件列表 */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 border-b pb-1.5">
            <Search className="size-3.5 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="按标题/地点搜索事件…"
              className="h-7 flex-1"
            />
          </div>
          <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {filtered.length === 0 && (
              <div className="py-3 text-center text-xs text-muted-foreground">
                {events.length === 0 ? "还没有事件" : "没有匹配的事件"}
              </div>
            )}
            {filtered.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent">
                <input
                  type="checkbox"
                  checked={selected.has(e.id)}
                  onChange={() => toggleSelect(e.id)}
                  className="size-3.5 shrink-0 accent-primary"
                />
                <span className={cn("min-w-0 flex-1 truncate text-sm", e.rrule && "text-primary")}>
                  {e.title}
                  {e.rrule && <span className="ml-1 rounded bg-primary/15 px-1 text-[9px] text-primary">重复</span>}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {new Date(e.start_ms).toLocaleDateString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>
          {selected.size > 0 && (
            <div className="flex items-center justify-between rounded-md bg-primary/10 px-2 py-1.5">
              <span className="text-xs text-foreground">已选 {selected.size} 条</span>
              <Button size="sm" variant="destructive" onClick={deleteSelected}>
                删除选中
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}