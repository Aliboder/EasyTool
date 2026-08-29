import { describe, expect, it, vi } from "vitest";
import { fmtRecent, extractKeywords, fmtSize } from "./search-utils";

describe("fmtRecent", () => {
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  vi.useFakeTimers();
  vi.setSystemTime(now);

  it("0（未记录）→ 空串", () => {
    expect(fmtRecent(0)).toBe("");
  });

  it("今天启动 → 今天", () => {
    expect(fmtRecent(now - 60 * 1000)).toBe("今天");
  });

  it("昨天启动 → 昨天", () => {
    expect(fmtRecent(now - DAY - 60 * 1000)).toBe("昨天");
  });

  it("三天前 → N天前", () => {
    expect(fmtRecent(now - 3 * DAY)).toBe("3天前");
  });

  vi.useRealTimers();
});

describe("extractKeywords", () => {
  it("过滤 Everything 功能前缀", () => {
    expect(extractKeywords('ext:pdf 报告 folder:D:\\')).toEqual(["报告"]);
  });

  it("普通词保留", () => {
    expect(extractKeywords("  git  提交 ")).toEqual(["git", "提交"]);
  });
});

describe("fmtSize", () => {
  it("字节 → B / KB / MB 分级", () => {
    expect(fmtSize(512)).toBe("512 B");
    expect(fmtSize(2048)).toBe("2.0 KB");
    expect(fmtSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("null → 空串", () => {
    expect(fmtSize(null)).toBe("");
  });
});