// 日程表共享 DTO（后端 camelCase 序列化）
export interface EventDto {
  id: number;
  title: string;
  location: string;
  notes: string;
  all_day: boolean;
  start_ms: number;
  end_ms: number;
  rrule: string | null;
  /** 重复事件展开后的实例日期（本地日键）；单次事件为 null */
  instance_date: number | null;
  /** 订阅来源 id（订阅日历事件，只读）；本地事件为 null */
  subscription_id: number | null;
  /** 导入源 id（.ics 导入的事件；手建为 null） */
  ics_import_id: number | null;
  /** 单条提醒提前量（分钟；null = 跟随全局） */
  remind_minutes: number | null;
}

export interface TodoDto {
  id: number;
  title: string;
  notes: string;
  due_date: number | null;
  done: boolean;
  done_at_ms: number | null;
}

export type ViewKey = "month" | "week" | "day" | "todo";