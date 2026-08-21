import { motion } from "motion/react";
import { useState } from "react";

type Account = {
  name: string;
  balance: string;
  badge: string;
  badgeColor: string;
  used: number;
  usedColor: string;
  windowLabel: string;
  resetIn: string;
};

const ACCOUNTS: Account[] = [
  { name: "DeepSeek", balance: "¥42.17", badge: "正常", badgeColor: "bg-emerald-500/15 text-emerald-400", used: 35, usedColor: "bg-emerald-500", windowLabel: "按近期日均消费可用约 12 天", resetIn: "" },
  { name: "OpenCode Go", balance: "73%", badge: "正常", badgeColor: "bg-emerald-500/15 text-emerald-400", used: 27, usedColor: "bg-emerald-500", windowLabel: "滚动用量 · 重置：3 天 14 小时", resetIn: "3d 14h" },
];

export function MiniQuota() {
  const [active, setActive] = useState(0);
  const acc = ACCOUNTS[active];

  return (
    <div>
      {/* account tabs */}
      <div className="flex gap-1.5">
        {ACCOUNTS.map((a, i) => (
          <button
            key={a.name}
            type="button"
            onClick={() => setActive(i)}
            className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${i === active ? "bg-emerald-500/15 text-emerald-400 font-medium" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {a.name}
          </button>
        ))}
      </div>

      {/* card */}
      <div className="mt-3 rounded-xl border border-white/10 bg-zinc-800/50 p-4">
        <div className="flex items-center justify-between">
          <span className="font-display text-2xl font-bold tabular-nums">{acc.balance}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${acc.badgeColor}`}>{acc.badge}</span>
        </div>

        {/* progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>已用 {acc.used}%</span>
            <span>剩余 {100 - acc.used}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-700">
            <motion.div
              key={`${acc.name}-${acc.used}`}
              initial={{ width: 0 }}
              animate={{ width: `${acc.used}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className={`h-full rounded-full ${acc.usedColor}`}
            />
          </div>
        </div>

        <p className="mt-2 text-[10px] text-zinc-500">{acc.windowLabel}</p>
      </div>
    </div>
  );
}
