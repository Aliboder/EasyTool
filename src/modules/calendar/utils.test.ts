import { describe, expect, it } from "vitest";
import {
  localDayKey,
  monthGrid,
  daysInMonth,
  dayStartMs,
  fmtHM,
  toDateInput,
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
});