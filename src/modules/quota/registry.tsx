// 额度监控供应商注册表：新增供应商只需在此补充一条元数据 + 渲染映射，
// 卡骨架 / 摘要条 / 分组逻辑都不改动。所有供应商类型集中定义于此（字段全部来自后端）。

import { Gauge, Zap, type LucideIcon } from "lucide-react";

/// 后端 get_status 返回的账户状态
export interface GoQuotaPayload {
  window: string; // session | weekly | monthly
  used_percent: number;
  resets_at: number | null; // unix 秒
}

export interface AccountStatusPayload {
  id: string;
  kind: string;
  name: string;
  balance: number | null; // 余额型（DeepSeek）才有；Go 为 null
  granted: number; // 赠送余额
  topped_up: number; // 充值余额
  available: boolean; // 余额可用性
  error: string | null;
  go_windows: GoQuotaPayload[]; // 用量窗口型（Go）才有
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
  name: string; // 展示名（Used in 分组标题）
  icon: LucideIcon;
  order: number; // 分组排序
  shape: VendorMetricShape; // 主指标形态，据此走余额型 / 用量窗口型布局
}

export const KIND_REGISTRY: Record<string, KindMeta> = {
  deepseek: { id: "deepseek", name: "DeepSeek", icon: Gauge, order: 0, shape: "balance" },
  go: { id: "go", name: "OpenCode Go", icon: Zap, order: 1, shape: "usage" },
};

export const FALLBACK_META: KindMeta = {
  id: "unknown",
  name: "未知供应商",
  icon: Gauge,
  order: 99,
  shape: "usage",
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

export const WINDOW_NAMES: Record<string, string> = {
  session: "滚动用量",
  weekly: "每周用量",
  monthly: "每月用量",
};

export function fmtMoney(n: number): string {
  return `¥${n.toFixed(2)}`;
}
