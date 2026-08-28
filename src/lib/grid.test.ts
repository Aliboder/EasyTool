import { describe, expect, it } from "vitest";
import { gridFontScale, gridIconSize, gridPadding, gridVerticalTarget } from "./grid";

describe("grid 尺寸公式", () => {
  it("图标尺寸不小于最小可读 24", () => {
    expect(gridIconSize(80)).toBe(40);
    expect(gridIconSize(40)).toBe(24);
    expect(gridIconSize(24)).toBe(24);
  });

  it("字号不小于最小可读 10", () => {
    expect(gridFontScale(80)).toBe(12);
    expect(gridFontScale(20)).toBe(10);
  });

  it("内边距为格子的 10%", () => {
    expect(gridPadding(80)).toBe(8);
  });
});

describe("gridVerticalTarget 键盘跨行步进", () => {
  it("无选中时：向下选第一个、向上选最后一个", () => {
    expect(gridVerticalTarget(-1, 1, 100, 8)).toBe(0);
    expect(gridVerticalTarget(-1, -1, 100, 8)).toBe(99);
  });

  it("按列数跨行并钳制边界", () => {
    expect(gridVerticalTarget(0, 1, 100, 8)).toBe(8);
    expect(gridVerticalTarget(99, 1, 100, 8)).toBe(99);
    expect(gridVerticalTarget(0, -1, 100, 8)).toBe(0);
    expect(gridVerticalTarget(12, -1, 100, 8)).toBe(4);
  });

  it("Isolated edge: 单列时上下移动一格", () => {
    expect(gridVerticalTarget(3, 1, 10, 1)).toBe(4);
    expect(gridVerticalTarget(3, -1, 10, 1)).toBe(2);
  });
});