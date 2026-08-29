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