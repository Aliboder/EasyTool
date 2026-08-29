import { describe, expect, it } from "vitest";
import { dayKey, dayLabel } from "./date-group";

function tsDaysAgo(days: number, hour = 12): number {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

describe("dayKey", () => {
  it("同一天返回相同键，跨天返回不同键", () => {
    const now = Date.now();
    expect(dayKey(now)).toBe(dayKey(now + 1000));
    expect(dayKey(tsDaysAgo(0))).not.toBe(dayKey(tsDaysAgo(1)));
  });
});

describe("dayLabel", () => {
  it("今天 → 今天", () => {
    expect(dayLabel(tsDaysAgo(0))).toBe("今天");
  });

  it("昨天 → 昨天", () => {
    expect(dayLabel(tsDaysAgo(1))).toBe("昨天");
  });

  it("昨天之后的日期 → MM/DD 周X", () => {
    const label = dayLabel(tsDaysAgo(3));
    expect(label).toMatch(/^\d{2}\/\d{2} 周[一二三四五六日]$/);
  });

  it("极端边界：明天（未来时间戳）按今天处理", () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    expect(dayLabel(d.getTime())).toBe("今天");
  });

  it("dayKey 与 dayLabel 对同日零点边界一致", () => {
    const today = new Date();
    // 今天 23:59 与明天 00:01 分属不同天
    const late = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59);
    const early = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 0, 1);
    expect(dayKey(late.getTime())).not.toBe(dayKey(early.getTime()));
    expect(dayLabel(early.getTime())).toBe("今天");
  });
});