import { useState } from "react";

// 2026 年 9 月迷你月视图（周一起始，与真实模块一致）
// 事件配色直接取自 src/modules/calendar/utils.ts 的 COURSE_COLORS
const BLUE = "#4f8ef7"; // 高数
const ROSE = "#e05fa8"; // 英语听力
const GREEN = "#22a06b"; // 健身
const CORAL = "#ef6461"; // 截止

// 5 行网格：首行从 8/31（周一）起，最后一行 28-30 + 10 月补格
const ROWS: { day: number; inMonth: boolean; events?: { text?: string; color?: string; allDay?: boolean }[] }[][] = [
  [
    { day: 31, inMonth: false },
    { day: 1, inMonth: true },
    { day: 2, inMonth: true, events: [{ color: ROSE }] },
    { day: 3, inMonth: true },
    { day: 4, inMonth: true, events: [{ color: GREEN }] },
    { day: 5, inMonth: true },
    { day: 6, inMonth: true },
  ],
  [
    { day: 7, inMonth: true, events: [{ color: BLUE }] },
    { day: 8, inMonth: true },
    { day: 9, inMonth: true, events: [{ color: ROSE }] },
    { day: 10, inMonth: true },
    { day: 11, inMonth: true, events: [{ color: GREEN }] },
    { day: 12, inMonth: true, events: [{ text: "交稿", color: CORAL, allDay: true }] },
    { day: 13, inMonth: true },
  ],
  [
    { day: 14, inMonth: true, events: [{ color: BLUE }] },
    { day: 15, inMonth: true },
    { day: 16, inMonth: true, events: [{ color: ROSE }] },
    { day: 17, inMonth: true },
    { day: 18, inMonth: true, events: [{ color: GREEN }] },
    { day: 19, inMonth: true },
    { day: 20, inMonth: true },
  ],
  [
    { day: 21, inMonth: true, events: [{ color: BLUE }] },
    { day: 22, inMonth: true },
    { day: 23, inMonth: true, events: [{ color: ROSE }] },
    { day: 24, inMonth: true },
    { day: 25, inMonth: true, events: [{ color: GREEN }] },
    { day: 26, inMonth: true },
    { day: 27, inMonth: true },
  ],
  [
    { day: 28, inMonth: true, events: [{ color: BLUE }] },
    { day: 29, inMonth: true },
    { day: 30, inMonth: true, events: [{ color: ROSE }] },
    { day: 1, inMonth: false },
    { day: 2, inMonth: false },
    { day: 3, inMonth: false },
    { day: 4, inMonth: false },
  ],
];

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function MiniCalendar() {
  const [sel, setSel] = useState<number | null>(12);

  return (
    <div>
      {/* 月视图：周一起始，事件格子带课程色 */}
      <div className="grid grid-cols-7 gap-x-1 gap-y-1">
        {WEEK_LABELS.map((w) => (
          <span key={w} className="text-center text-[8px] text-zinc-600">
            {w}
          </span>
        ))}
        {ROWS.flat().map((c, i) => (
          <button
            key={i}
            onClick={() => c.inMonth && setSel(c.day)}
            className={cnCell(c, sel)}
          >
            <span className={`text-center text-[8px] tabular-nums ${c.inMonth ? "text-zinc-400" : "text-zinc-700"}`}>
              {c.day}
            </span>
            <div className="flex h-1 items-center gap-0.5">
              {c.events?.map((e, j) =>
                e.allDay ? (
                  <span
                    key={j}
                    className="truncate rounded-sm px-0.5 text-[6px] leading-3 text-white"
                    style={{ backgroundColor: e.color, width: "100%" }}
                  >
                    {e.text}
                  </span>
                ) : (
                  <span key={j} className="size-1 rounded-full" style={{ backgroundColor: e.color }} />
                ),
              )}
            </div>
          </button>
        ))}
      </div>

      {/* 重复规则：按星期几自动重复，同一天同色 */}
      <div className="mt-2 flex flex-wrap gap-1">
        {[
          { dot: BLUE, text: "周一 · 高等数学" },
          { dot: ROSE, text: "周三 · 英语听力" },
          { dot: GREEN, text: "周五 · 健身" },
        ].map((r) => (
          <span
            key={r.text}
            className="inline-flex items-center gap-1 rounded-full border border-white/5 bg-white/[0.03] px-2 py-0.5 text-[9px] text-zinc-400"
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: r.dot }} />
            {r.text}
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-[9px] text-zinc-600">点任意日期试试 — 重复事件只存一条规则，自动展开每一天</p>
    </div>
  );
}

function cnCell(c: { day: number; inMonth: boolean }, sel: number | null) {
  const base = "flex h-6 flex-col rounded-md border border-transparent pt-0.5 transition-colors";
  if (!c.inMonth) return `${base} cursor-default`;
  if (c.day === 12) return `${base} cursor-pointer border-emerald-500/50 bg-emerald-500/10`;
  if (c.day === sel) return `${base} cursor-pointer border-white/20 bg-white/[0.04]`;
  return `${base} cursor-pointer hover:border-white/10 hover:bg-white/[0.03]`;
}