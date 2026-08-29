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

/** 某月第一天的日键 */
export function monthStartKey(year: number, month0: number): number {
  return year * 10000 + (month0 + 1) * 100 + 1;
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

/** 日键 → 展示文字（如 8/29）；跨年带年份 */
export function fmtKey(key: number): string {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100);
  const d = key % 100;
  const now = new Date();
  return now.getFullYear() === y ? `${m}/${d}` : `${y}/${m}/${d}`;
}

/** 日键 → 「M月D日 周X」（详情标题用） */
export function fmtKeyLong(key: number): string {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100);
  const d = key % 100;
  const weekday = new Date(y, m - 1, d).getDay();
  const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${m}月${d}日 ${names[weekday]}`;
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

/** yyyy-MM-dd → 本地 00:00 毫秒 */
export function fromDateInput(v: string): number {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** 毫秒 → 本地 yyyy-MM-ddTHH:mm（datetime-local input 用） */
export function toDateTimeInput(ms: number): string {
  return `${toDateInput(ms)}T${toTimeInput(ms)}`;
}

/** yyyy-MM-ddTHH:mm → 本地毫秒 */
export function fromDateTimeInput(v: string): number {
  const [date, time] = v.split("T");
  const [y, m, d] = date.split("-").map(Number);
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

/** 日键 → 所在周的周一（周一起始）；key 为本地日键 */
export function weekStartKey(key: number): number {
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100) - 1;
  const d = key % 100;
  const dow = (new Date(y, m, d).getDay() + 6) % 7; // 周一=0
  const start = new Date(y, m, d - dow);
  return start.getFullYear() * 10000 + (start.getMonth() + 1) * 100 + start.getDate();
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