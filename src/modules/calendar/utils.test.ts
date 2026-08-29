import { describe, expect, it } from "vitest";
import {
  localDayKey,
  monthGrid,
  daysInMonth,
  dayStartMs,
  fmtHM,
  toDateInput,
  weekStartKey,
  weekdayOfKey,
  layoutDay,
  parseRrule,
  buildRrule,
  keyToDateInput,
  type TimedEventLike,
} from "./utils";

describe("calendar utils", () => {
  it("localDayKey 本地日键", () => {
    expect(localDayKey(new Date(2026, 7, 29, 20, 0).getTime())).toBe(20260829);
    expect(localDayKey(new Date(2026, 0, 1, 0, 30).getTime())).toBe(20260101);
  });

  it("monthGrid 周一起始、42 格、首尾补前后月", () => {
    // 2026-08-01 是周六：周一开头应补 7 格（7/27-8/2）
    const cells = monthGrid(2026, 7);
    expect(cells.length).toBe(42);
    expect(cells[0].key).toBe(20260727);
    expect(cells[0].inMonth).toBe(false);
    expect(cells[6].key).toBe(20260802);
    expect(cells[6].inMonth).toBe(true);
    // 8 月 31 天 + 余下补齐
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth.length).toBe(31);
  });

  it("daysInMonth 闰年", () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2026, 7)).toBe(31);
  });

  it("dayStartMs / fmtHM / toDateInput 往返", () => {
    const ms = dayStartMs(20260829);
    expect(localDayKey(ms)).toBe(20260829);
    expect(toDateInput(ms)).toBe("2026-08-29");
    const t = new Date(2026, 7, 29, 9, 5).getTime();
    expect(fmtHM(t)).toBe("09:05");
  });

  it("weekStartKey / weekdayOfKey 周一开头", () => {
    // 2026-08-29 是周六 → 所在周周一为 8/24
    expect(weekdayOfKey(20260829)).toBe(5);
    expect(weekStartKey(20260829)).toBe(20260824);
    // 周一本身
    expect(weekStartKey(20260824)).toBe(20260824);
    expect(weekdayOfKey(20260824)).toBe(0);
  });

  it("layoutDay 基础排布与重叠分列", () => {
    const at = (h0: number, m0: number, h1: number, m1: number): TimedEventLike => ({
      start_ms: new Date(2026, 8, 15, h0, m0).getTime(),
      end_ms: new Date(2026, 8, 15, h1, m1).getTime(),
      all_day: false,
    });
    const evs = [at(9, 0, 10, 0), at(9, 30, 11, 0), at(14, 0, 15, 0), at(7, 0, 9, 30)];
    const blocks = layoutDay(evs, { startHour: 8, endHour: 18, hourHeight: 48 });
    expect(blocks.length).toBe(4);
    // 09:00-10:00 → top=48, height=48
    const b0 = blocks.find((b) => b.index === 0)!;
    expect(b0.top).toBe(48);
    expect(b0.height).toBe(48);
    // 09:30-11:00 与 09:00-10:00 重叠 → 各占半宽，不同 left
    const b1 = blocks.find((b) => b.index === 1)!;
    expect(Math.abs(b0.width - 50) < 0.1).toBe(true);
    expect(b1.left).not.toBe(b0.left);
    // 14:00-15:00 不重叠 → 全宽
    const b2 = blocks.find((b) => b.index === 2)!;
    expect(b2.width).toBe(100);
    // 07:00-09:30 在窗口(8点)前开始 → 钳制到顶部，显示到 9:30 的 90 分钟
    const b3 = blocks.find((b) => b.index === 3)!;
    expect(b3.top).toBe(0);
    expect(b3.height).toBe(72);
  });

  it("layoutDay 全天事件不参与排布", () => {
    const evs: TimedEventLike[] = [
      { start_ms: new Date(2026, 8, 15, 9, 0).getTime(), end_ms: new Date(2026, 8, 15, 10, 0).getTime(), all_day: false },
      { start_ms: new Date(2026, 8, 15, 9, 0).getTime(), end_ms: new Date(2026, 8, 15, 10, 0).getTime(), all_day: true },
      { start_ms: new Date(2026, 8, 16, 9, 0).getTime(), end_ms: new Date(2026, 8, 16, 10, 0).getTime(), all_day: false },
    ];
    // layoutDay 只按「时刻」排布，跨天/全天由调用方按日过滤；这里全天被排除、其余两条同刻排在列
    const blocks = layoutDay(evs, { startHour: 8, endHour: 18, hourHeight: 48 });
    expect(blocks.length).toBe(2);
    expect(blocks.some((b) => b.index === 0)).toBe(true);
    expect(blocks.some((b) => b.index === 2)).toBe(true);
  });

  it("parseRrule / buildRrule 往返", () => {
    // 每周一三五 + 截止
    const w = parseRrule("FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261228T160000Z")!;
    expect(w.freq).toBe("weekly");
    expect(w.bydays).toEqual([0, 2, 4]);
    expect(w.untilKey).toBe(20261228);
    expect(buildRrule(w)).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261228T160000Z");
    // 每天
    expect(buildRrule({ freq: "daily", bydays: [], nth: 1, nthDay: 0, untilKey: null })).toBe("FREQ=DAILY");
    // 每月同日
    expect(buildRrule({ freq: "monthly", bydays: [], nth: 1, nthDay: 0, untilKey: null })).toBe("FREQ=MONTHLY");
    // 每月第 3 个周一
    const nth = parseRrule("FREQ=MONTHLY;BYDAY=3MO")!;
    expect(nth.freq).toBe("monthlyNth");
    expect(nth.nth).toBe(3);
    expect(nth.nthDay).toBe(0);
    expect(buildRrule(nth)).toBe("FREQ=MONTHLY;BYDAY=3MO");
    // 不重复 / 非法
    expect(buildRrule({ freq: "none", bydays: [], nth: 1, nthDay: 0, untilKey: null })).toBe(null);
    expect(buildRrule({ freq: "weekly", bydays: [], nth: 1, nthDay: 0, untilKey: null })).toBe(null);
    expect(parseRrule("FREQ=YEARLY")).toBe(null);
    // 日期键 ↔ date input
    expect(keyToDateInput(20260829)).toBe("2026-08-29");
  });
});