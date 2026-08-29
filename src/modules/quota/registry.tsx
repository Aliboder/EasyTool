// 额度监控供应商注册表：新增供应商只需在此补充一条元数据 + 渲染映射，
// 卡骨架 / 摘要条 / 分组逻辑都不改动。所有供应商类型集中定义于此（字段全部来自后端）。

import {
  Gauge,
  Zap,
  Plug,
  Brain,
  Sparkles,
  Cpu,
  MessageSquare,
  Waypoints,
  Droplets,
  Terminal,
  Cloud,
  type LucideIcon,
} from "lucide-react";

/// 后端 get_status 返回的账户状态
export interface GoQuotaPayload {
  window: string; // session | weekly | monthly | 厂商窗口键
  used_percent: number;
  resets_at: number | null; // unix 秒
  /** 文本窗口（余额类，如 SiliconFlow / Kimi PAYG 余额）：有值时展示文本而非进度环 */
  text?: string | null;
}

export interface AccountStatusPayload {
  id: string;
  kind: string;
  name: string;
  balance: number | null; // 余额型（DeepSeek / 自定义 / SiliconFlow）才有；其余为 null
  granted: number; // 赠送余额
  topped_up: number; // 充值余额
  available: boolean; // 余额可用性
  error: string | null;
  go_windows: GoQuotaPayload[]; // 用量窗口型（Go / Coding Plan 厂商）才有
}

/// get_stats_data 返回的消费统计（DeepSeek）
export interface StatsPayload {
  today: number; // 今日消费
  avg_7d: number; // 近7天日均
  daily: { date: string; amount: number }[]; // 近14天每日
}

/// get_go_cycles 返回的窗口重置周期
export interface GoCycle {
  cycle_start: number;
  cycle_end: number | null;
  peak_utilization: number;
  total_delta: number;
}

/// 两种指标形态，注册表据此决定卡片主区域渲染
export type VendorMetricShape = "balance" | "usage";

export interface KindMeta {
  id: string;
  name: string; // 展示名（分组标题）
  icon: LucideIcon;
  order: number; // 分组排序
  shape: VendorMetricShape; // 主指标形态
  keyHint: string; // 设置页密钥占位提示
}

export const KIND_REGISTRY: Record<string, KindMeta> = {
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    icon: Gauge,
    order: 0,
    shape: "balance",
    keyHint: "sk-...",
  },
  go: {
    id: "go",
    name: "OpenCode Go",
    icon: Zap,
    order: 10,
    shape: "usage",
    keyHint: "留空自动使用本机 opencode 登录凭据",
  },
  custom: {
    id: "custom",
    name: "自定义 Provider",
    icon: Plug,
    order: 110, // 置底：自定义属于通用兜底类型，排在 8 家 Coding Plan 之后
    shape: "balance",
    keyHint: "密钥（请求头 {{KEY}} 占位符会替换为这里的值）",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    icon: Brain,
    order: 30,
    shape: "usage",
    keyHint: "Claude Code OAuth token；留空自动读 ~/.claude/.credentials.json",
  },
  zai: {
    id: "zai",
    name: "Z.ai / 智谱 GLM",
    icon: Sparkles,
    order: 40,
    shape: "usage",
    keyHint: "Coding Plan 专属 API Key（z.ai / bigmodel.cn 控制台）",
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    icon: Cpu,
    order: 50,
    shape: "usage",
    keyHint: "MiniMax API Key（sk-* / sk-cp-*）",
  },
  kimi: {
    id: "kimi",
    name: "Kimi / Moonshot",
    icon: MessageSquare,
    order: 60,
    shape: "usage",
    keyHint: "Kimi Code 订阅 Key（sk-kimi-*）显示本周/5小时配额；仅配开放平台 Key 显示 PAYG 余额",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    icon: Waypoints,
    order: 70,
    shape: "usage",
    keyHint: "OpenRouter API Key（sk-or-*；显示预付 credits 已用%）",
  },
  siliconflow: {
    id: "siliconflow",
    name: "SiliconFlow 硅基流动",
    icon: Droplets,
    order: 80,
    shape: "balance",
    keyHint: "SiliconFlow API Key（sk-*；显示账户余额）",
  },
  command: {
    id: "command",
    name: "CommandCode",
    icon: Terminal,
    order: 90,
    shape: "usage",
    keyHint: "commandcode.ai API Key（user_*）",
  },
  volc: {
    id: "volc",
    name: "火山方舟",
    icon: Cloud,
    order: 100,
    shape: "usage",
    keyHint:
      "管控面 AccessKey:SecretKey（IAM 子用户需 ArkReadOnlyAccess + BillingCenterReadOnlyAccess）",
  },
};

export const FALLBACK_META: KindMeta = {
  id: "unknown",
  name: "未知供应商",
  icon: Gauge,
  order: 999,
  shape: "usage",
  keyHint: "",
};

export function getKindMeta(kind: string): KindMeta {
  return KIND_REGISTRY[kind] ?? FALLBACK_META;
}

/** 已知 kind，按 order 升序 */
export function knownKinds(): string[] {
  return Object.keys(KIND_REGISTRY).sort(
    (a, b) => (KIND_REGISTRY[a].order ?? 0) - (KIND_REGISTRY[b].order ?? 0),
  );
}

/** 统一窗口名 → 展示名；未知窗口回退原名 */
export const WINDOW_NAMES: Record<string, string> = {
  session: "滚动用量",
  weekly: "本周",
  monthly: "本月",
  "5h": "5 小时",
  "7d": "7 天",
  daily: "每日",
  credits: "已用额度",
  balance: "余额",
  current: "当前窗口",
};

export function windowName(key: string): string {
  return WINDOW_NAMES[key] ?? key;
}

export function fmtMoney(n: number): string {
  return `¥${n.toFixed(2)}`;
}

/// 每日预算档位（与后端 alerts::BudgetStage 对应）
export type BudgetStage = 0 | 1 | 2;