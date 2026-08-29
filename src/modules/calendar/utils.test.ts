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
  addDaysKey,
  fmtWeekRange,
  fmtMonth,
  fmtRruleSummary,
  COURSE_COLORS,
  courseColor,
  buildTimeline,
  TL_HEADER_H,
  TL_CLUSTER_GAP,
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

  it("addDaysKey 跨月/跨年正确换位", () => {
    expect(addDaysKey(20260831, 1)).toBe(20260901);
    expect(addDaysKey(20260830, 3)).toBe(20260902);
    expect(addDaysKey(20260901, -1)).toBe(20260831);
    expect(addDaysKey(20261231, 1)).toBe(20270101);
    expect(addDaysKey(20260228, 1)).toBe(20260301); // 2026 平年
    expect(addDaysKey(20280228, 1)).toBe(20280229); // 闰年
    // 周视图窗口（月末跨月）：8/24 起 7 天
    expect(addDaysKey(20260824, 6)).toBe(20260830);
    expect(addDaysKey(20260831, 1)).not.toBe(20260832); // 不再出现 32
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

  it("fmtWeekRange / fmtMonth 时间段文字", () => {
    // 2026-08-29 是周六 → 所在周 8/24(一)–8/30(日)
    expect(fmtWeekRange(20260829, 7)).toBe("08月24日–30日");
    // 隐藏周末 → 周一至周五
    expect(fmtWeekRange(20260829, 5)).toBe("08月24日–28日");
    // 跨月：8/31 周一起 → 8/31–9/6
    expect(fmtWeekRange(20260831, 7)).toBe("08月31日–09月06日");
    // 跨年：2026-12-31(周四) 所在周 12/28–2027-01-03
    expect(fmtWeekRange(20261231, 7)).toBe("2026年12月28日–2027年01月03日");
    expect(fmtMonth(2026, 7)).toBe("2026年08月");
  });

  it("fmtRruleSummary 重复摘要", () => {
    const b = { bydays: [], nth: 1, nthDay: 0, untilKey: null as number | null };
    expect(fmtRruleSummary({ freq: "none", ...b })).toBe("不重复");
    expect(fmtRruleSummary({ freq: "daily", ...b })).toBe("每天");
    expect(fmtRruleSummary({ freq: "weekly", bydays: [0, 2, 4], nth: 1, nthDay: 0, untilKey: null })).toBe(
      "每周周一、周三、周五",
    );
    expect(fmtRruleSummary({ freq: "monthly", ...b })).toBe("每月同一天");
    expect(fmtRruleSummary({ freq: "monthlyNth", bydays: [], nth: 3, nthDay: 0, untilKey: null })).toBe(
      "每月第 3 个周一",
    );
  });

  it("courseColor 稳定且在调色盘内", () => {
    // 同一标题永远同色（确定性）
    expect(courseColor("大学物理实验")).toBe(courseColor("大学物理实验"));
    // 颜色一定在调色盘内
    expect(COURSE_COLORS).toContain(courseColor("高数"));
    // 不同标题（大概率）不同色
    const a = courseColor("大学物理实验");
    const b = courseColor("大学英语");
    expect(a).not.toBe(b);
    // 空标题也有稳定色
    expect(courseColor("")).toBe(COURSE_COLORS[0]);
  });

  it("buildTimeline 跳过空闲与真实连续", () => {
    const day = (y: number, m: number, d: number, h: number, mi = 0) => new Date(y, m - 1, d, h, mi, 0).getTime();
    const ev = (start: number, end: number) => ({
      id: 1, title: "课", location: "", notes: "", all_day: false, start_ms: start, end_ms: end, subscription_id: null, color: null,
    });
    const events = [
      ev(day(2026, 9, 15, 10, 0), day(2026, 9, 15, 11, 0)),
      ev(day(2026, 9, 15, 14, 0), day(2026, 9, 15, 15, 0)),
      ev(day(2026, 9, 17, 9, 0), day(2026, 9, 17, 10, 0)),
    ];
    // 跳过空闲（hideEmpty=true）：15 日有上午(10-11)与下午(14-15)两簇，16 日被跳过；17 日一簇
    const r = buildTimeline(events, { startMs: day(2026, 9, 14, 0, 0), endMs: day(2026, 9, 17, 12, 0), hourHeight: 48, hideEmpty: true });
    expect(r.days.length).toBe(2);
    expect(r.days[0].dayKey).toBe(20260915);
    expect(r.days[1].dayKey).toBe(20260917);
    expect(r.days[0].clusters.length).toBe(2); // 10-11 与 14-15 间隔>1.5h → 两簇
    expect(r.days[0].windowStartHour).toBe(9.75); // 首簇起点(10-0.25)
    // 15 日：头(30) + 簇0(1.5h*48=72) + 簇间隔(16) + 簇1(1.5h*48=72)
    expect(r.days[0].height).toBe(TL_HEADER_H + 72 + TL_CLUSTER_GAP + 72);
    // 真实连续（hideEmpty=false）：14~17 每天 24h
    const r2 = buildTimeline(events, { startMs: day(2026, 9, 14, 0, 0), endMs: day(2026, 9, 17, 12, 0), hourHeight: 48, hideEmpty: false });
    expect(r2.days.length).toBe(4);
    expect(r2.days[0].height).toBe(TL_HEADER_H + 24 * 48);
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