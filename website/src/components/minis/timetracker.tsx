import { motion } from "motion/react";
import { Bot, Code2, Globe, Guitar, Paintbrush } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// 周热力：一周 7 天 × 4 档强度（分钟级，GitHub 贡献图风格）
const WEEK: number[] = [210, 340, 520, 0, 90, 180, 0];

// 今日排行（线性图标 + 中文紧凑时长）
const TODAY: { app: string; icon: LucideIcon; hex: string; label: string }[] = [
  { app: "Visual Studio Code", icon: Code2, hex: "#38bdf8", label: "1小时47分" },
  { app: "浏览器", icon: Globe, hex: "#22d3ee", label: "1小时10分" },
  { app: "Claude", icon: Bot, hex: "#fb923c", label: "56分钟" },
  { app: "音乐", icon: Guitar, hex: "#eab308", label: "30分钟" },
  { app: "Krita", icon: Paintbrush, hex: "#f472b6", label: "21分钟" },
];

function fmtDay(min: number): string {
  if (min === 0) return "休息";
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}小时${m}分` : `${h}小时`;
}

export function MiniTimetracker() {
  const max = Math.max(...WEEK);

  return (
    <div>
      {/* 周热力带 */}
      <div className="flex items-end gap-1.5">
        {WEEK.map((min, i) => {
          const h = min === 0 ? 0 : Math.max(10, (min / max) * 56);
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1" title={`周${"一二三四五六日"[i]} ${fmtDay(min)}`}>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: h }}
                transition={{ duration: 0.7, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                className={`w-full rounded-sm ${min === 0 ? "bg-white/5" : "bg-emerald-500/70"}`}
              />
              <span className="text-[8px] text-zinc-600">{"一二三四五六日"[i]}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-zinc-500">近 7 天使用分布 · 共 22小时20分</p>

      {/* 今日排行 */}
      <div className="mt-3 space-y-1">
        {TODAY.map((r) => (
          <div
            key={r.app}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1 transition-colors hover:bg-white/[0.03]"
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-md bg-white/5">
              <r.icon className="size-3" style={{ color: r.hex }} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{r.app}</span>
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px]" style={{ backgroundColor: `${r.hex}1a`, color: r.hex }}>
              {r.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}