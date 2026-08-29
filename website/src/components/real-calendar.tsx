import { useState } from "react";
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight } from "lucide-react";

// 2026 年 9 月月视图（周一起始、6 行 42 格），事件配色取自真实模块 COURSE_COLORS
const BLUE = "#4f8ef7";
const ROSE = "#e05fa8";
const GREEN = "#22a06b";
const CORAL = "#ef6461";
const TODAY = 12;

function cellsOfSep2026(): { day: number; inMonth: boolean }[] {
  // 9/1 是周二 → 首行补 8/31；6 行 42 格，末尾补 10 月
  const lead = 1;
  const total = 42;
  const cells: { day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(2026, 8, 1 - lead + i);
    cells.push({ day: d.getDate(), inMonth: d.getMonth() === 8 });
  }
  return cells;
}

const CELLS = cellsOfSep2026();

// 事件定位：day → 课程色 / 全天标记（数字 = 月内日）
const DAY_EVENTS: Record<number, { text: string; color: string }[]> = {
  2: [{ text: "听力", color: ROSE }],
  4: [{ text: "健身", color: GREEN }],
  7: [{ text: "高数", color: BLUE }],
  9: [{ text: "听力", color: ROSE }],
  11: [{ text: "健身", color: GREEN }],
  12: [{ text: "交开题报告", color: CORAL }],
  14: [{ text: "高数", color: BLUE }],
  16: [{ text: "听力", color: ROSE }],
  18: [{ text: "健身", color: GREEN }],
  21: [{ text: "高数", color: BLUE }],
  23: [{ text: "听力", color: ROSE }],
  25: [{ text: "健身", color: GREEN }],
  28: [{ text: "高数", color: BLUE }],
  30: [{ text: "听力", color: ROSE }],
};

const TABS = ["时间线", "日", "周", "月", "待办"];

export function RealCalendar() {
  const [tab, setTab] = useState("月");
  const [sel, setSel] = useState<number | null>(TODAY);

  return (
    <div className="flex h-[480px] w-full max-w-xl flex-col overflow-hidden rounded-2xl border-2 border-white/10 bg-zinc-900 font-sans text-zinc-100 shadow-2xl shadow-black/40">
      {/* header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-emerald-500/15 p-1.5 text-emerald-400">
            <CalendarDays className="size-3.5" />
          </span>
          <span className="text-sm font-semibold">日程表</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-400">2026年9月</span>
          <button className="rounded-md border border-white/10 p-0.5 text-zinc-500 hover:text-zinc-300" type="button" aria-label="上个月">
            <ChevronLeft className="size-3.5" />
          </button>
          <button className="rounded-md border border-white/10 p-0.5 text-zinc-500 hover:text-zinc-300" type="button" aria-label="下个月">
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-1 border-b border-white/5 px-4 py-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors ${
              tab === t ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto rounded-md border border-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-400">今天</span>
      </div>

      {/* month grid */}
      <div className="flex-1 overflow-hidden p-2">
        <div className="grid grid-cols-7 gap-0.5 px-1">
          {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
            <span key={w} className="py-0.5 text-center text-[9px] text-zinc-600">
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {CELLS.map((c, i) => {
            const ev = DAY_EVENTS[c.day];
            const isToday = c.inMonth && c.day === TODAY;
            const isSel = c.inMonth && c.day === sel;
            return (
              <button
                key={i}
                onClick={() => c.inMonth && setSel(c.day)}
                className={`flex min-h-0 flex-col rounded-md border p-0.5 text-left transition-colors ${
                  isToday
                    ? "border-emerald-500/60 bg-emerald-500/10"
                    : isSel
                      ? "border-white/15 bg-white/[0.04]"
                      : "border-transparent"
                } ${c.inMonth ? "" : "opacity-35"}`}
              >
                <span className={`px-0.5 text-[8px] tabular-nums ${isToday ? "font-bold text-emerald-400" : "text-zinc-500"}`}>
                  {c.day}
                </span>
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {ev?.map((e, j) => (
                    <span
                      key={j}
                      className="truncate rounded-sm px-1 py-px text-[7px] font-medium leading-3 text-white"
                      style={{ backgroundColor: e.color }}
                    >
                      {e.text}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* todo strip */}
      <div className="space-y-1 border-t border-white/5 px-4 py-2.5">
        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
          <Bell className="size-3 text-amber-400" />
          待办 · 到期提醒
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5">
          <span className="flex size-3.5 items-center justify-center rounded-full bg-emerald-500 text-zinc-950">
            <Check className="size-2.5" />
          </span>
          <span className="text-[11px] text-zinc-400 line-through">交开题报告终稿</span>
          <span className="ml-auto text-[9px] text-zinc-600">9/12 已截止</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5">
          <span className="size-3.5 rounded-full border border-zinc-600" />
          <span className="text-[11px] text-zinc-300">复习线性代数</span>
          <span className="ml-auto text-[9px] text-zinc-600">今天到期</span>
        </div>
      </div>
    </div>
  );
}