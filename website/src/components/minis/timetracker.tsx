import { motion } from "motion/react";
import { useState } from "react";

type Row = { app: string; cat: string; hex: string; sec: number; icon: string };

const TABS = ["今日", "本周"];

const TODAY: Row[] = [
  { app: "Visual Studio Code", cat: "效率", hex: "#3b82f6", sec: 6420, icon: "💻" },
  { app: "浏览器", cat: "资源", hex: "#06b6d4", sec: 4180, icon: "🌐" },
  { app: "Claude", cat: "学习", hex: "#f97316", sec: 3360, icon: "🤖" },
  { app: "音乐", cat: "视听", hex: "#eab308", sec: 1820, icon: "🎵" },
  { app: "Krita", cat: "学习", hex: "#f97316", sec: 1260, icon: "🎨" },
];

const WEEK: Row[] = [
  { app: "Visual Studio Code", cat: "效率", hex: "#3b82f6", sec: 38100, icon: "💻" },
  { app: "浏览器", cat: "资源", hex: "#06b6d4", sec: 27400, icon: "🌐" },
  { app: "Claude", cat: "学习", hex: "#f97316", sec: 19000, icon: "🤖" },
  { app: "游戏", cat: "游戏", hex: "#a855f7", sec: 9300, icon: "🎮" },
  { app: "音乐", cat: "视听", hex: "#eab308", sec: 7600, icon: "🎵" },
];

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

export function MiniTimetracker() {
  const [tab, setTab] = useState(0);
  const [sel, setSel] = useState(0);
  const rows = tab === 0 ? TODAY : WEEK;
  const max = Math.max(...rows.map((r) => r.sec));
  const total = rows.reduce((s, r) => s + r.sec, 0);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {TABS.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(i);
                setSel(0);
              }}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                i === tab
                  ? "bg-emerald-500/15 font-medium text-emerald-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-zinc-500 tabular-nums">
          共 {fmt(total)}
        </span>
      </div>

      <div className="mt-3 space-y-1">
        {rows.map((r, i) => {
          const pct = (r.sec / max) * 100;
          const active = sel === i;
          return (
            <motion.button
              key={r.app}
              type="button"
              onClick={() => setSel(i)}
              whileTap={{ scale: 0.98 }}
              className={`group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                active ? "bg-white/5" : "hover:bg-white/[0.02]"
              }`}
            >
              <span className="grid w-4 shrink-0 place-items-center text-xs">{r.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] text-zinc-300">{r.app}</span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
                    {fmt(r.sec)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-700/60">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    style={{ backgroundColor: r.hex }}
                    className={`h-full rounded-full ${active ? "" : "opacity-75"}`}
                  />
                </div>
              </div>
              <span
                className="hidden shrink-0 rounded px-1 py-0.5 text-[9px] text-white sm:block"
                style={{ backgroundColor: `${r.hex}22`, color: r.hex }}
              >
                {r.cat}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
