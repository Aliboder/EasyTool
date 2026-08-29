// 峰/谷计价时段前端版（与后端 modules/quota/pricing.rs 规则一一对应）。
// 官方口径（DeepSeek 开放平台）：峰时段 UTC 01:00–04:00 / 06:00–10:00
// （北京时间 09:00–12:00 / 14:00–18:00），谷价 = 峰价一半；
// 周末（周六/周日，北京日历）全天按谷价计费。
// 纯函数、无依赖，便于 vitest 单测。

export type PricingTier = "peak" | "valley";

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

/// 北京时区的墙钟字段（把 Date 平移 +8h 后读 UTC 字段即可）
function beijingFields(now: Date) {
  const b = new Date(now.getTime() + BEIJING_OFFSET_MS);
  return {
    year: b.getUTCFullYear(),
    month: b.getUTCMonth(), // 0-11
    date: b.getUTCDate(),
    day: b.getUTCDay(), // 0=周日
    mins: b.getUTCHours() * 60 + b.getUTCMinutes(),
  };
}

/// 北京 (y,m,d) 的 minute-of-day → 真实 UTC 毫秒
function instantAt(year: number, month: number, date: number, mins: number): number {
  return Date.UTC(year, month, date, Math.floor(mins / 60), mins % 60) - BEIJING_OFFSET_MS;
}

/** 今天（北京日历）是否周末 */
export function isWeekend(now: Date): boolean {
  const d = beijingFields(now).day;
  return d === 0 || d === 6;
}

/// 工作日峰时段边界（北京时间分钟数）：09:00 / 12:00 / 14:00 / 18:00
const WEEKDAY_BOUNDARIES: ReadonlyArray<readonly [number, PricingTier]> = [
  [9 * 60, "peak"],
  [12 * 60, "valley"],
  [14 * 60, "peak"],
  [18 * 60, "valley"],
];

/** 当前计价档位 */
export function tierAt(now: Date): PricingTier {
  const { mins, day } = beijingFields(now);
  if (day === 0 || day === 6) return "valley";
  if ((mins >= 9 * 60 && mins < 12 * 60) || (mins >= 14 * 60 && mins < 18 * 60)) return "peak";
  return "valley";
}

/** 从给定日期跳 n 个工作日（n>=1）后的北京日期；返回 {y,m,d} */
function nextWorkday(fields: { year: number; month: number; date: number; day: number }, n: number) {
  let y = fields.year;
  let mo = fields.month;
  let d = fields.date;
  let dow = fields.day;
  let remaining = n;
  while (remaining > 0) {
    const dt = new Date(Date.UTC(y, mo, d + 1));
    y = dt.getUTCFullYear();
    mo = dt.getUTCMonth();
    d = dt.getUTCDate();
    dow = dt.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return { year: y, month: mo, date: d };
}

export interface PeakBoundary {
  /** 下一次切换的 unix 毫秒 */
  ts: number;
  /** 切换后的档位 */
  tier: PricingTier;
  /** 距切换剩余毫秒 */
  remainingMs: number;
}

/** 下一次档位切换时刻与切换后档位 */
export function nextBoundary(now: Date): PeakBoundary {
  const f = beijingFields(now);
  const weekend = f.day === 0 || f.day === 6;
  if (!weekend) {
    for (const [m, tier] of WEEKDAY_BOUNDARIES) {
      if (m > f.mins) {
        const ts = instantAt(f.year, f.month, f.date, m);
        return { ts, tier, remainingMs: ts - now.getTime() };
      }
    }
    const next = nextWorkday(f, 1);
    const ts = instantAt(next.year, next.month, next.date, WEEKDAY_BOUNDARIES[0][0]);
    return { ts, tier: "peak", remainingMs: ts - now.getTime() };
  }
  const next = nextWorkday(f, 1);
  const ts = instantAt(next.year, next.month, next.date, WEEKDAY_BOUNDARIES[0][0]);
  return { ts, tier: "peak", remainingMs: ts - now.getTime() };
}