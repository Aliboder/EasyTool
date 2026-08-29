// 日程表日期纯函数（无依赖，供 vitest 单测；展开/格定义在此收敛）
// 约定：本地日键 = yyyymmdd 整数；周起始 = 周一（课表/手机日历习惯）

/** 毫秒 → 本地日键（yyyyMMdd 整数） */
export function localDayKey(ms: number): number {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** 今天（本地）的日键 */
export function todayKey(): number {
  return localDayKey(Date.now());
}

/** 日键 → 该日 00:00 本地毫秒 */
export function dayStartMs(key: number): number {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100) - 1;
  const d = key % 100;
  return new Date(y, m, d).getTime();
}

/** 日键 → 该日 23:59:59.999 本地毫秒 */
export function dayEndMs(key: number): number {
  return dayStartMs(key) + 86_400_000 - 1;
}

/** 某月天数（含 2 月闰年） */
export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

export interface MonthCell {
  key: number; // 日键（跨月格子是前后月的日期）
  inMonth: boolean; // 是否属于当前月
  dayOfMonth: number;
}

/** 生成月视图 6 行 × 7 列（周一起始）的日期格，首尾补前后月日期 */
export function monthGrid(year: number, month0: number): MonthCell[] {
  const first = new Date(year, month0, 1);
  // 周一 = 1 ... 周日 = 0
  const lead = (first.getDay() + 6) % 7;
  const total = 42; // 6 行，保证固定高度、跨月不跳动
  const cells: MonthCell[] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(year, month0, 1 - lead + i);
    const key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    cells.push({ key, inMonth: d.getMonth() === month0, dayOfMonth: d.getDate() });
  }
  return cells;
}

/** 日键 → 展示文字（如 08/29）；跨年带年份（月日两位） */
export function fmtKey(key: number): string {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100);
  const d = key % 100;
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return now.getFullYear() === y ? `${p(m)}/${p(d)}` : `${y}/${p(m)}/${p(d)}`;
}

/** 日键 → 「08月29日 周六」（月日两位；详情标题用） */
export function fmtKeyLong(key: number): string {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100);
  const d = key % 100;
  const weekday = new Date(y, m - 1, d).getDay();
  const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(m)}月${p(d)}日 ${names[weekday]}`;
}

/** 毫秒 → 本地日期 yyyy-MM-dd（date input 用） */
export function toDateInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 毫秒 → 本地时间 HH:mm（time/datetime-local 用） */
export function toTimeInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** yyyy-MM-dd（或 yyyy/MM/dd）→ 本地 00:00 毫秒 */
export function fromDateInput(v: string): number {
  const [y, m, d] = v.split(/[-/]/).map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** 毫秒 → 本地 yyyy-MM-ddTHH:mm（datetime-local input 用） */
export function toDateTimeInput(ms: number): string {
  return `${toDateInput(ms)}T${toTimeInput(ms)}`;
}

/** ms_y → 本地 yyyy-MM-ddTHH:mm（datetime-local input 用） */
export function fromDateTimeInput(v: string): number {
  const [date, time] = v.split("T");
  const [y, m, d] = date.split(/[-/]/).map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

/** 毫秒 → HH:mm（展示） */
export function fmtHM(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 周/日视图时间轴布局（纯函数，可单测） ----------

// ---------- RRULE 表单模型（纯函数，可单测） ----------

export type RruleFreq = "none" | "daily" | "weekly" | "monthly" | "monthlyNth";

export interface RruleForm {
  freq: RruleFreq;
  /** weekly：选中的星期（周一=0..周日=6），空 = 起始日 */
  bydays: number[];
  /** monthlyNth：第几个星期几（1~5） */
  nth: number;
  /** monthlyNth：星期几（周一=0） */
  nthDay: number;
  /** 截止日期（本地日键；null=无限） */
  untilKey: number | null;
  /** 每隔 N 个周期（默认 1；>1 时输出 INTERVAL） */
  interval?: number;
}

const WEEK_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** rrule 字符串 → 表单模型（解析不了则返回 null，前端按「不重复」处理） */
export function parseRrule(rule: string): RruleForm | null {
  const parts = new Map<string, string>();
  for (const seg of rule.split(";")) {
    const [k, v] = seg.split("=");
    if (k) parts.set(k.toUpperCase(), v ?? "");
  }
  const freq = parts.get("FREQ");
  const dayRaw = parts.get("BYDAY");
  const untilRaw = parts.get("UNTIL");
  const untilKey = untilRaw ? untilToKey(untilRaw) : null;
  const bydays =
    dayRaw?.split(",")
      .map((s) => WEEK_CODES.indexOf(s.toUpperCase()))
      .filter((i) => i >= 0) ?? [];
  const iv = parts.get("INTERVAL");
  const interval = iv ? Math.max(1, parseInt(iv, 10) || 1) : 1;
  const base = { bydays, nth: 1 as number, nthDay: 0 as number, untilKey, interval };
  if (freq === "DAILY") return { freq: "daily", ...base, bydays: [] };
  if (freq === "MONTHLY") {
    if (dayRaw) {
      // 第 N 个星期 X（如 3MO / -1FR 取 1..5）
      const m = dayRaw.match(/^([+-]?\d+)([A-Z]{2})$/);
      if (m) {
        const n = Math.abs(parseInt(m[1], 10));
        return {
          freq: "monthlyNth",
          bydays: [],
          nth: n >= 1 && n <= 5 ? n : 1,
          nthDay: Math.max(0, WEEK_CODES.indexOf(m[2].toUpperCase())),
          untilKey,
          interval,
        };
      }
      return { freq: "monthly", bydays: [], nth: 1, nthDay: 0, untilKey, interval };
    }
    return { freq: "monthly", bydays: [], nth: 1, nthDay: 0, untilKey, interval };
  }
  if (freq === "WEEKLY") {
    return { freq: "weekly", bydays, nth: 1, nthDay: 0, untilKey, interval };
  }
  return null;
}

/** 表单模型 → rrule 字符串（null = 不重复；interval>1 时写 INTERVAL） */
export function buildRrule(f: RruleForm): string | null {
  if (f.freq === "none") return null;
  const interval = f.interval && f.interval > 1 ? f.interval : 1;
  const iv = interval > 1 ? `;INTERVAL=${interval}` : "";
  let rule: string;
  if (f.freq === "daily") rule = `FREQ=DAILY${iv}`;
  else if (f.freq === "weekly") {
    const days = f.bydays.length > 0 ? f.bydays : [];
    if (days.length === 0) return null; // 每周至少要选一天
    rule = `FREQ=WEEKLY${iv};BYDAY=${days.map((d) => WEEK_CODES[d]).join(",")}`;
  } else if (f.freq === "monthly") rule = `FREQ=MONTHLY${iv}`;
  else {
    // monthlyNth
    if (f.nthDay < 0 || f.nthDay > 6) return null;
    rule = `FREQ=MONTHLY${iv};BYDAY=${Math.max(1, f.nth)}${WEEK_CODES[f.nthDay]}`;
  }
  if (f.untilKey != null) {
    rule += `;UNTIL=${keyToUntil(f.untilKey)}`;
  }
  return rule;
}

/** UNTIL 字符串 → 本地日键（兼容 date-only 与 T160000Z 惯例） */
function untilToKey(raw: string): number | null {
  if (raw.length < 8) return null;
  const y = parseInt(raw.slice(0, 4), 10);
  const m = parseInt(raw.slice(4, 6), 10);
  const d = parseInt(raw.slice(6, 8), 10);
  return y * 10000 + m * 100 + d;
}

/** 本地日键 → 截止时刻 16:00Z（= 北京当日 24:00，保证截止日当天包含） */
function keyToUntil(key: number): string {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100);
  const d = key % 100;
  return `${String(y).padStart(4, "0")}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}T160000Z`;
}

/** 日键 → yyyy-MM-dd（表单 date input 用） */
export function keyToDateInput(key: number): string {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100);
  const d = key % 100;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 日键 → 所在周的周一（周一起始）；key 为本地日键 */
export function weekStartKey(key: number): number {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100) - 1;
  const d = key % 100;
  const dow = (new Date(y, m, d).getDay() + 6) % 7; // 周一=0
  const start = new Date(y, m, d - dow);
  return start.getFullYear() * 10000 + (start.getMonth() + 1) * 100 + start.getDate();
}

/** 周范围展示文字：days=7 整周、days=5 周一至周五（隐藏周末；月日两位）。
 * 同一月 "08月24日–30日"；跨月 "08月31日–09月06日"；跨年两端带年份 */
export function fmtWeekRange(key: number, days: number): string {
  const start = weekStartKey(key);
  const end = addDaysKey(start, days - 1);
  const sy = Math.floor(start / 10000);
  const ey = Math.floor(end / 10000);
  const sm = Math.floor((start % 10000) / 100);
  const em = Math.floor((end % 10000) / 100);
  const sd = start % 100;
  const ed = end % 100;
  const p = (n: number) => String(n).padStart(2, "0");
  if (sy === ey && sm === em) return `${p(sm)}月${p(sd)}日–${p(ed)}日`;
  if (sy === ey) return `${p(sm)}月${p(sd)}日–${p(em)}月${p(ed)}日`;
  return `${sy}年${p(sm)}月${p(sd)}日–${ey}年${p(em)}月${p(ed)}日`;
}

/** 月标题展示文字：2026年08月 */
export function fmtMonth(y: number, m0: number): string {
  return `${y}年${String(m0 + 1).padStart(2, "0")}月`;
}

/** RruleForm → 可读的重复规则摘要（如「每周一、三、五」「每月第 3 个周一」） */
export function fmtRruleSummary(f: RruleForm): string {
  const names = ["一", "二", "三", "四", "五", "六", "日"];
  switch (f.freq) {
    case "none":
      return "不重复";
    case "daily":
      return "每天";
    case "weekly":
      return f.bydays.length > 0 ? `每周${f.bydays.map((i) => "周" + names[i]).join("、")}` : "每周";
    case "monthly":
      return "每月同一天";
    case "monthlyNth":
      return `每月第 ${f.nth} 个周${names[f.nthDay] ?? "一"}`;
  }
}

/// 课程自动配色盘（饱和度适中、明度统一，白字清晰）
export const COURSE_COLORS = [
  "#4f8ef7", // 蓝
  "#22a06b", // 绿
  "#f5a524", // 琥珀
  "#ef6461", // 珊瑚红
  "#9b6ef3", // 紫
  "#0ea5b7", // 青
  "#e05fa8", // 玫红
  "#5b7bd5", // 藏蓝
  "#ea580c", // 橙
  "#64748b", // 灰蓝
];

/** 简单字符串 hash（稳定、确定性；供课程配色用） */
export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 按标题自动分配稳定的课程色（同一门课永远同色；可被用户自定义覆盖） */
export function courseColor(title: string): string {
  return COURSE_COLORS[hashStr(title) % COURSE_COLORS.length];
}

// ---------- 时间线视图（连续纵向时间轴，跨天/可缩放/可跳过空闲） ----------

export interface TlEventLike {
  id: number;
  title: string;
  location: string;
  notes: string;
  all_day: boolean;
  start_ms: number;
  end_ms: number;
  subscription_id: number | null;
  color: string | null;
}

/** 时间线每日的日期头高度（px） */
export const TL_HEADER_H = 30;

/** 簇与簇之间的分隔高度（px） */
export const TL_CLUSTER_GAP = 16;

/** 相邻事件间隔超过该小时数即拆成两个簇（跳过空闲用） */
export const TL_CLUSTER_GAP_H = 1.5;

export interface TlCluster<T> {
  startHour: number;
  endHour: number;
  top: number; // 相对当天 body 顶部的像素偏移
  height: number;
  events: T[];
}

export interface TlDay<T> {
  dayKey: number;
  top: number; // 相对时间轴顶部的像素偏移
  height: number;
  windowStartHour: number; // 首簇起点（兼容旧字段）
  events: T[]; // 当天所有分时事件
  allDay: T[];
  hasEvents: boolean;
  clusters: TlCluster<T>[];
}

/**
 * 由事件数组和缩放/跳过空闲构建时间线布局（纯函数）。返回各日分段与总高度。
 * hideEmpty=true：按「簇」打包（间隔≤1.5h 聚成一簇、紧凑排布，簇间留薄分隔），跳过无事件的天。
 * hideEmpty=false：每天 0-24 连续真实时间。泛型保留完整事件类型。
 */
export function buildTimeline<T extends TlEventLike>(
  events: T[],
  opts: { startMs: number; endMs: number; hourHeight: number; hideEmpty: boolean },
): { days: TlDay<T>[]; totalHeight: number } {
  const { startMs, endMs, hourHeight, hideEmpty } = opts;
  const byDay = new Map<number, { timed: T[]; allDay: T[] }>();
  for (const e of events) {
    const k = localDayKey(e.start_ms);
    if (e.start_ms > endMs || e.end_ms < startMs) continue;
    const bucket = byDay.get(k) ?? { timed: [], allDay: [] };
    (e.all_day ? bucket.allDay : bucket.timed).push(e);
    byDay.set(k, bucket);
  }

  const makeClusters = (timed: T[]): TlCluster<T>[] => {
    if (!hideEmpty) {
      return [{ startHour: 0, endHour: 24, top: 0, height: 24 * hourHeight, events: timed }];
    }
    if (timed.length === 0) return [];
    const sorted = [...timed].sort((a, b) => a.start_ms - b.start_ms);
    const raw: { startHour: number; endHour: number; events: T[] }[] = [];
    for (const e of sorted) {
      const dayMs = dayStartMs(localDayKey(e.start_ms));
      const sh = (e.start_ms - dayMs) / 3_600_000;
      const eh = Math.max((e.end_ms - dayMs) / 3_600_000, sh + 0.25);
      const last = raw[raw.length - 1];
      if (last && sh - last.endHour <= TL_CLUSTER_GAP_H) {
        last.endHour = Math.max(last.endHour, eh);
        last.events.push(e);
      } else {
        raw.push({ startHour: sh, endHour: eh, events: [e] });
      }
    }
    const out: TlCluster<T>[] = [];
    let top = 0;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      const start = Math.max(0, Math.floor(c.startHour) - 0.25);
      const end = Math.min(24, Math.ceil(c.endHour) + 0.25);
      const h = Math.max(30, (end - start) * hourHeight);
      out.push({ startHour: start, endHour: end, top, height: h, events: c.events });
      top += h + (i < raw.length - 1 ? TL_CLUSTER_GAP : 0);
    }
    return out;
  };

  const days: TlDay<T>[] = [];
  let top = 0;
  let cursor = dayStartMs(localDayKey(startMs));
  while (cursor <= endMs) {
    const k = localDayKey(cursor);
    const bucket = byDay.get(k);
    const timed = bucket?.timed ?? [];
    const allDay = bucket?.allDay ?? [];
    const hasEvents = timed.length > 0 || allDay.length > 0;
    if (hideEmpty && !hasEvents) {
      cursor += 86_400_000;
      continue;
    }
    const clusters = makeClusters(timed);
    const body = clusters.length > 0 ? clusters[clusters.length - 1].top + clusters[clusters.length - 1].height : 0;
    const height = TL_HEADER_H + body;
    days.push({
      dayKey: k,
      top,
      height,
      windowStartHour: clusters[0]?.startHour ?? 0,
      events: timed,
      allDay,
      hasEvents,
      clusters,
    });
    top += height;
    cursor += 86_400_000;
  }
  return { days, totalHeight: top };
}

/** 日键加减 N 天（正确处理跨月/跨年，如 8月31 +1 → 9月1） */
export function addDaysKey(key: number, n: number): number {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100) - 1;
  const d = key % 100;
  const dt = new Date(y, m, d + n);
  return dt.getFullYear() * 10000 + (dt.getMonth() + 1) * 100 + dt.getDate();
}

/** 日键 → 周一=0 .. 周日=6 */
export function weekdayOfKey(key: number): number {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100) - 1;
  const d = key % 100;
  return (new Date(y, m, d).getDay() + 6) % 7;
}

/** 时间轴布局输入的最小声明（事件子集） */
export interface TimedEventLike {
  start_ms: number;
  end_ms: number;
  all_day: boolean;
}

export interface PlacedBlock {
  top: number;
  height: number;
  left: number; // 百分比（0-100）
  width: number;
  index: number; // 对应输入 events 的下标
}

/**
 * 把某一天的非全天事件排成时间轴块：距开始时刻的像素偏移、时长高度、
 * 重叠簇内左右分列（贪心列分配）、窗口上下边缘钳制。
 * windowMinHour 前开始的事件从 0 起算；全部为全天 → 空数组。
 */
export function layoutDay(
  events: TimedEventLike[],
  opts: { startHour: number; endHour: number; hourHeight: number; minHeight?: number },
): PlacedBlock[] {
  const { startHour, endHour, hourHeight } = opts;
  const minHeight = opts.minHeight ?? 8;
  const windowMin = startHour * 60;
  const windowMax = endHour * 60;

  interface Slot {
    index: number;
    start: number;
    end: number;
    top: number;
    rawH: number;
    height: number;
  }
  const timed: Slot[] = [];
  events.forEach((e, index) => {
    if (e.all_day) return;
    const s = new Date(e.start_ms);
    const en = new Date(e.end_ms);
    const start = s.getHours() * 60 + s.getMinutes();
    const end = en.getHours() * 60 + en.getMinutes() || start + 60;
    if (end <= windowMin || start >= windowMax) return;
    const top = Math.max(0, ((Math.max(start, windowMin) - windowMin) / 60) * hourHeight);
    const rawH = ((Math.min(end, windowMax) - Math.max(start, windowMin)) / 60) * hourHeight;
    timed.push({ index, start, end, top, rawH, height: Math.max(minHeight, rawH) });
  });

  // 按开始时间排序后做重叠簇 → 贪心分列
  timed.sort((a, b) => a.start - b.start);
  const clusters: Slot[][] = [];
  for (const ev of timed) {
    const prev = clusters[clusters.length - 1];
    if (prev && prev.some((p) => p.end > ev.start)) {
      prev.push(ev);
    } else {
      clusters.push([ev]);
    }
  }
  // 每簇内贪心分配列
  const assigned: Map<number, { col: number; cols: number }> = new Map();
  for (const cluster of clusters) {
    const colEnd: number[] = [];
    let maxCols = 0;
    for (const ev of cluster) {
      let col = colEnd.findIndex((e) => e <= ev.start);
      if (col === -1) {
        col = colEnd.length;
        colEnd.push(0);
      }
      colEnd[col] = ev.end;
      maxCols = Math.max(maxCols, col + 1);
    }
    for (const ev of cluster) {
      assigned.set(ev.index, { col: 0, cols: 0 });
    }
    // 重新根据列结束时间排定每列的列号
    const colOf: Map<number, number> = new Map();
    const ends: number[] = [];
    for (const ev of cluster) {
      let col = ends.findIndex((e) => e <= ev.start);
      if (col === -1) {
        col = ends.length;
        ends.push(0);
      }
      ends[col] = ev.end;
      colOf.set(ev.index, col);
    }
    for (const ev of cluster) {
      assigned.set(ev.index, { col: colOf.get(ev.index) ?? 0, cols: maxCols });
    }
  }
  return timed.map((ev) => {
    const a = assigned.get(ev.index)!;
    const width = 100 / a.cols;
    return {
      index: ev.index,
      top: Math.round(ev.top),
      height: Math.round(ev.height),
      left: Math.round(a.col * width * 10) / 10,
      width: Math.round(width * 10) / 10,
    };
  });
}