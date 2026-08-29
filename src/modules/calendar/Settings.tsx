// 日程表设置抽屉（受控组件，配置读写都在 Page 的 useModuleConfig）
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CalendarConfig } from "./config";

const VIEW_OPTIONS = [
  { value: "month", label: "月视图" },
  { value: "week", label: "周视图" },
  { value: "day", label: "日视图" },
];

const REMIND_OPTIONS = [
  { value: 0, label: "准时" },
  { value: 5, label: "提前 5 分钟" },
  { value: 10, label: "提前 10 分钟" },
  { value: 30, label: "提前 30 分钟" },
  { value: 60, label: "提前 1 小时" },
];

export function CalendarSettings({
  cfg,
  onUpdate,
}: {
  cfg: CalendarConfig;
  onUpdate: (p: Partial<CalendarConfig>) => void;
}) {
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
    </div>
  );
}