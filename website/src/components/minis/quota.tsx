import { motion } from "motion/react";
import { useState } from "react";

type Account = {
  name: string;
  balance: string;
  used: string;
  points: number[];
};

const ACCOUNTS: Account[] = [
  {
    name: "DeepSeek",
    balance: "¥ 42.17",
    used: "本月消费 ¥ 156.30",
    points: [8, 12, 10, 16, 14, 22, 19, 26, 24, 31, 28, 34],
  },
  {
    name: "OpenCode Go",
    balance: "73%",
    used: "本月额度已用 27%",
    points: [30, 32, 31, 35, 38, 36, 42, 45, 43, 48, 52, 55],
  },
];

const W = 120;
const H = 40;

function toPath(points: number[]) {
  const max = Math.max(...points) * 1.15;
  const stepX = W / (points.length - 1);
  return points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${(H - (p / max) * (H - 4) - 2).toFixed(1)}`,
    )
    .join(" ");
}

export function MiniQuota() {
  const [active, setActive] = useState(0);
  const acc = ACCOUNTS[active];
  const path = toPath(acc.points);
  const last = acc.points[acc.points.length - 1];
  const max = Math.max(...acc.points) * 1.15;
  const endX = W;
  const endY = H - (last / max) * (H - 4) - 2;

  return (
    <div>
      <div className="flex gap-1.5">
        {ACCOUNTS.map((a, i) => (
          <button
            key={a.name}
            type="button"
            onClick={() => setActive(i)}
            className={`rounded-full px-3 py-1 font-display text-xs transition-colors ${
              i === active
                ? "bg-emerald-500/15 font-semibold text-emerald-600 dark:text-emerald-400"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>

      <p className="mt-4 font-display text-3xl font-bold tabular-nums">{acc.balance}</p>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{acc.used}</p>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-16 w-full" aria-hidden>
        <motion.path
          key={acc.name}
          d={path}
          fill="none"
          stroke="currentColor"
          className="text-emerald-500"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: false, amount: 0.5 }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
        <circle cx={endX - 1} cy={endY} r="2.5" className="fill-emerald-500" />
      </svg>
    </div>
  );
}
