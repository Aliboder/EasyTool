// 日程表模块配置（useModuleConfig 三件套之一；存储键自动转 snake_case）
export interface CalendarConfig {
  reminderEnabled: boolean;
  eventRemindMinutes: number;
  todoOverdueRemind: boolean;
  defaultView: "timeline" | "month" | "week" | "day";
  weekShowWeekend: boolean;
}

export const CALENDAR_DEFAULTS: CalendarConfig = {
  reminderEnabled: true,
  eventRemindMinutes: 10,
  todoOverdueRemind: true,
  defaultView: "timeline",
  weekShowWeekend: true,
};