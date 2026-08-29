// 日期工具（纯函数，无 React 依赖，便于单测）
export const DAY_MS = 86_400_000;

/** 固定 MM/DD HH:mm（与 App 一致，不做人类化） */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 日期分组的本地键（yyyy-m-d），用于相邻项跨天判断 */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 日期分组标签：今天 / 昨天 / MM/DD 周X */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  const W = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${W[d.getDay()]}`;
}