import { describe, expect, it } from "vitest";
import {
  CATEGORY_HEX,
  CATEGORY_LABELS,
  categoryColor,
  formatDuration,
  formatDurationShort,
} from "./types";

describe("时长分类常量", () => {
  it("分类标签与色值一一对应", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual(Object.keys(CATEGORY_HEX).sort());
  });

  it("6 类齐全", () => {
    expect(Object.keys(CATEGORY_LABELS)).toHaveLength(6);
    expect(CATEGORY_LABELS.game).toBe("游戏");
  });
});

describe("categoryColor", () => {
  it("已知分类返回其色值，未知返回灰色兜底", () => {
    expect(categoryColor("efficiency")).toBe(CATEGORY_HEX.efficiency);
    expect(categoryColor("unknown")).toBe("#9ca3af");
  });
});

describe("时长格式化", () => {
  it("formatDurationShort：紧凑格式", () => {
    expect(formatDurationShort(45)).toBe("45秒");
    expect(formatDurationShort(3600)).toBe("1h");
    expect(formatDurationShort(5400)).toBe("1h30m");
    expect(formatDurationShort(1500)).toBe("25m");
  });

  it("formatDuration：完整格式", () => {
    expect(formatDuration(30)).toBe("30秒");
    expect(formatDuration(5400)).toBe("1小时30分钟");
    expect(formatDuration(7200)).toBe("2小时");
    expect(formatDuration(600)).toBe("10分钟");
  });
});