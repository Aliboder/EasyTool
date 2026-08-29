import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Settings2,
  TrendingUp,
} from "lucide-react";

type Row = { name: string; cat: string; hex: string; total: number; active: number; icon: string };

const ROWS: Row[] = [
  { name: "Visual Studio Code", cat: "效率", hex: "#3b82f6", total: 1 * 3600 + 47, active: 1 * 3600 + 30, icon: "💻" },
  { name: "浏览器", cat: "资源", hex: "#06b6d4", total: 1 * 3600 + 9, active: 42 * 60, icon: "🌐" },
  { name: "Claude", cat: "学习", hex: "#f97316", total: 56, active: 52, icon: "🤖" },
  { name: "音乐", cat: "视听", hex: "#eab308", total: 30, active: 12, icon: "🎵" },
  { name: "steam", cat: "游戏", hex: "#a855f7", total: 21, active: 21, icon: "🎮" },
];

const TABS = ["今日", "本周", "本月"];
const HOURS = Array.from({ length: 12 }, (_, i) => `${String(i * 2).padStart(2, "0")}:00`);

export function RealTimetracker() {
  const [tab, setTab] = useState(0);
  const [sortByTotal, setSortByTotal] = useState(true);
  const [sel, setSel] = useState<number | null>(null);

  const max = Math.max(...ROWS.map((r) => r.total));

  return (
    <div className="flex h-[480px] w-full max-w-xl flex-col overflow-hidden rounded-2xl border-2 border-white/10 bg-zinc-950 font-sans text-zinc-100 shadow-2xl shadow-black/40">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-white/5 bg-zinc-900 px-3 py-2.5">
        <GripVertical className="size-4 shrink-0 text-zinc-600" />
        <div className="flex flex-1 items-center gap-1 text-sm font-medium">
          <span className="text-zinc-400">时长统计</span>
          <span className="text-zinc-600">·</span>
          <span className="text-emerald-400">今日</span>
        </div>
        <div className="flex items-center gap-0.5">
          <ChevronLeft className="size-3.5 text-zinc-500" />
          <ChevronRight className="size-3.5 text-zinc-600" />
        </div>
        <Settings2 className="size-4 text-zinc-500" />
      </div>

      {/* tabs */}
      <div className="flex gap-1 border-b border-white/5 px-3 py-2">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
              i === tab
                ? "bg-emerald-500/15 font-medium text-emerald-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* overview bar */}
      <div className="flex items-center justify-between gap-3 bg-secondary/30 px-4 py-3">
        <div>
          <div className="text-[11px] text-zinc-500">今日使用</div>
          <div className="text-2xl font-semibold tabular-nums leading-none">3小时57分</div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-orange-400">
            <TrendingUp className="size-3" />
            较昨日多 48分
          </div>
        </div>
        <div className="h-9 w-px bg-white/5" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-zinc-500">活跃使用</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-semibold tabular-nums">3小时31分</span>
            <span className="text-[11px] text-zinc-500">89%</span>
          </div>
          <div className="mt-1.5 h-1.5 max-w-32 overflow-hidden rounded-full bg-zinc-700">
            <div className="h-full w-[89%] rounded-full bg-emerald-500" />
          </div>
        </div>
        <div className="h-9 w-px bg-white/5" />
        <div>
          <div className="text-[11px] text-zinc-500">应用</div>
          <div className="text-lg font-semibold tabular-nums">5</div>
        </div>
      </div>

      {/* ranking */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs text-zinc-400">应用排行</span>
          <button
            onClick={() => setSortByTotal(!sortByTotal)}
            className="text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            按{sortByTotal ? "总时长" : "活跃"}排序
          </button>
        </div>
        <div className="divide-y divide-white/5">
          {ROWS.map((r, i) => {
            const pct = (r.total / max) * 100;
            const active = sel === i;
            return (
              <button
                key={r.name}
                onClick={() => setSel(active ? null : i)}
                className={`flex w-full items-center gap-2.5 px-2 py-2 text-left transition-colors ${
                  active ? "bg-white/5" : "hover:bg-white/[0.02]"
                }`}
              >
                <span className="w-4 shrink-0 text-center text-xs text-zinc-500 tabular-nums">
                  {i + 1}
                </span>
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white/5 text-xs">
                  {r.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium">{r.name}</span>
                    <span
                      className="shrink-0 rounded px-1 py-px text-[9px]"
                      style={{ backgroundColor: `${r.hex}22`, color: r.hex }}
                    >
                      {r.cat}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-700/70">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: r.hex }}
                    />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs tabular-nums">{fmt(r.total)}</div>
                  {r.active < r.total && (
                    <div className="text-[10px] text-zinc-500">活跃 {fmt(r.active)}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* timeline */}
        <div className="mt-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-zinc-400">今日时间线</span>
            <span className="font-mono text-[9px] text-zinc-600">08-26 · 24h</span>
          </div>
          <div className="flex items-end gap-1">
            {HOURS.map((h, i) => {
              const active = [1, 2, 3].includes(i) || [5, 6].includes(i);
              return (
                <div key={h} className="flex flex-1 flex-col items-center gap-1">
                  <div className={active ? "h-4 w-full rounded-sm bg-emerald-500/60" : "h-2 w-full rounded-sm bg-white/5"} />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[8px] text-zinc-600">
            <span>00:00</span>
            <span>08:00</span>
            <span>16:00</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${m}m`;
}
