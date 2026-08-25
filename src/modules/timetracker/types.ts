export interface App {
  id: number;
  exe_path: string;
  app_name: string;
  window_title: string | null;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: number;
  app_id: number;
  start_time: string;
  end_time: string | null;
  duration_sec: number;
  window_title: string | null;
  is_active: number;
  app_name: string;
  category: string;
}

export interface DailyStat {
  app_id: number;
  app_name: string;
  category: string;
  /** 应用 exe 路径（取图标用；周/月聚合视图为空） */
  exe_path?: string;
  date: string;
  total_duration_sec: number;
  active_duration_sec: number;
  session_count: number;
}

export interface DayOverview {
  date: string;
  total_sec: number;
  active_sec: number;
  prev_total_sec: number;
  /** 该周期内有使用记录的应用数 */
  app_count: number;
}

export interface AppDetail {
  app: App;
  today_duration_sec: number;
  week_duration_sec: number;
  month_duration_sec: number;
  /** 近 7 天每日时长趋势 */
  daily_stats: DailyStat[];
}

/** 用户自定义分类规则 */
export interface CategoryRule {
  id: number;
  /** 正则表达式（匹配 app 名或窗口标题） */
  pattern: string;
  category: string;
  priority: number;
}

/** 单日分类占比 */
export interface CategoryBreakdown {
  category: string;
  total_duration_sec: number;
  active_duration_sec: number;
}

/** 应用分类管理列表项 */
export interface AppListItem {
  id: number;
  app_name: string;
  exe_path: string;
  category: string;
  /** 用户是否手动锁定过分类（重跑规则时跳过） */
  category_locked: boolean;
  total_duration_sec: number;
}

export type Period = "today" | "week" | "month";

export const CATEGORY_LABELS: Record<string, string> = {
  efficiency: "效率工具",
  resource: "资源获取",
  media: "视听娱乐",
  study: "学习创意",
  system: "系统工具",
  game: "游戏",
};

/** 分类色（hex）：条形图/饼图/甘特图统一取色 */
export const CATEGORY_HEX: Record<string, string> = {
  efficiency: "#3b82f6",
  resource: "#06b6d4",
  media: "#eab308",
  study: "#f97316",
  system: "#6b7280",
  game: "#a855f7",
};

export function categoryColor(category: string): string {
  return CATEGORY_HEX[category] ?? "#9ca3af";
}

/** 格式化秒数为「Xh Ym」短格式（紧凑场景：卡片对比、甘特 tooltip） */
export function formatDurationShort(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${m}m`;
}

/** 格式化秒数为「X小时Y分钟」（完整场景：排行、详情） */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  return `${minutes}分钟`;
}
