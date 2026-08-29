import { describe, expect, it } from "vitest";
import { tierAt, nextBoundary, isWeekend } from "./pricing";

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

/// 构造「北京时间 (y,mo,d,h,mi)」对应的真实 Date
function bj(y: number, mo: number, d: number, h: number, mi = 0): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - BEIJING_OFFSET_MS);
}

describe("pricing tierAt", () => {
  it("工作日峰谷窗口", () => {
    expect(tierAt(bj(2026, 8, 19, 10, 0))).toBe("peak"); // 峰窗内
    expect(tierAt(bj(2026, 8, 19, 8, 0))).toBe("valley");
    expect(tierAt(bj(2026, 8, 19, 12, 30))).toBe("valley");
    expect(tierAt(bj(2026, 8, 19, 15, 0))).toBe("peak");
    expect(tierAt(bj(2026, 8, 19, 18, 30))).toBe("valley");
  });

  it("周末全天谷价", () => {
    expect(isWeekend(bj(2026, 8, 22, 12, 0))).toBe(true); // 周六
    expect(isWeekend(bj(2026, 8, 23, 12, 0))).toBe(true); // 周日
    expect(tierAt(bj(2026, 8, 22, 14, 0))).toBe("valley"); // 峰窗口内但周末
    expect(tierAt(bj(2026, 8, 23, 10, 0))).toBe("valley");
  });

  it("工作日日界", () => {
    expect(isWeekend(bj(2026, 8, 19, 12, 0))).toBe(false); // 周三
  });
});

describe("pricing nextBoundary", () => {
  it("工作日当天边界", () => {
    const b1 = nextBoundary(bj(2026, 8, 19, 10, 0));
    expect(b1.tier).toBe("valley");
    expect(b1.ts).toBe(bj(2026, 8, 19, 12, 0).getTime());

    const b2 = nextBoundary(bj(2026, 8, 19, 15, 0));
    expect(b2.tier).toBe("valley");
    expect(b2.ts).toBe(bj(2026, 8, 19, 18, 0).getTime());
  });

  it("日落后到次日 09:00", () => {
    const b = nextBoundary(bj(2026, 8, 19, 18, 30));
    expect(b.tier).toBe("peak");
    expect(b.ts).toBe(bj(2026, 8, 20, 9, 0).getTime());
  });

  it("周五傍晚跳过周末到下周一", () => {
    const b = nextBoundary(bj(2026, 8, 21, 18, 30)); // 周五
    expect(b.tier).toBe("peak");
    expect(b.ts).toBe(bj(2026, 8, 24, 9, 0).getTime());
  });

  it("周末到下周一 09:00", () => {
    const b = nextBoundary(bj(2026, 8, 22, 20, 0)); // 周六晚
    expect(b.tier).toBe("peak");
    expect(b.ts).toBe(bj(2026, 8, 24, 9, 0).getTime());
  });
});