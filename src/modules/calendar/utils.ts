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