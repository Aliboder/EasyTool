import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useEffect, useState } from "react";

type Account = {
  name: string;
  balance: number;
  unit: string;
  used: number;
  badge: string;
  badgeColor: string;
  windowLabel: string;
  trend: number[]; // 近 14 次采样（% 用量），画趋势线
};

const ACCOUNTS: Account[] = [
  {
    name: "DeepSeek",
    balance: 42.17,
    unit: "¥",
    used: 35,
    badge: "正常",
    badgeColor: "bg-emerald-500/15 text-emerald-400",
    windowLabel: "按近期日均消费可用约 12 天",
    trend: [18, 22, 20, 26, 24, 30, 28, 33, 31, 36, 34, 37, 35, 35],
  },
  {
    name: "OpenCode Go",
    balance: 73,
    unit: "%",
    used: 27,
    badge: "正常",
    badgeColor: "bg-emerald-500/15 text-emerald-400",
    windowLabel: "滚动用量 · 重置：3 天 14 小时",
    trend: [8, 12, 10, 16, 15, 19, 22, 20, 24, 23, 26, 25, 26, 27],
  },
];

function BalanceNumber({ value, unit }: { value: number; unit: string }) {
  const reduce = useReducedMotion();
  const raw = useMotionValue(0);
  const spring = useSpring(raw, { stiffness: 80, damping: 24 });
  const [text, setText] = useState("0");
  useEffect(() => spring.on("change", (v) => setText(v.toFixed(2))), [spring]);
  useEffect(() => {
    if (!reduce) raw.set(value);
    else setText(value.toFixed(2));
  }, [value, reduce, raw]);
  return (
    <span className="font-display text-2xl font-bold tabular-nums">
      {unit}
      {text}
    </span>
  );
}

export function MiniQuota() {
  const [active, setActive] = useState(0);
  const acc = ACCOUNTS[active];
  const maxTrend = Math.max(...acc.trend, 1);

  return (
    <div>
      {/* 账户切换 */}
      <div className="flex gap-1.5">
        {ACCOUNTS.map((a, i) => (
          <button
            key={a.name}
            type="button"
            onClick={() => setActive(i)}
            className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${i === active ? "bg-emerald-500/15 font-medium text-emerald-400" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {a.name}
          </button>
        ))}
      </div>

      {/* 仪表盘卡片 */}
      <div className="mt-3 rounded-xl border border-white/10 bg-zinc-800/60 p-4">
        <div className="flex items-start justify-between">
          <div>
            <BalanceNumber value={acc.balance} unit={acc.unit} />
            <p className="mt-1 text-[10px] text-zinc-500">{acc.windowLabel}</p>
          </div>
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${acc.badgeColor}`}>{acc.badge}</span>
        </div>

        {/* 用量进度 */}
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
              className="h-full rounded-full bg-emerald-500"
            />
          </div>
        </div>

        {/* 消费趋势线 */}
        <svg viewBox="0 0 120 28" className="mt-3 w-full" aria-hidden>
          <path
            d={acc.trend
              .map((v, i) => `${i === 0 ? "M" : "L"}${(i / (acc.trend.length - 1)) * 120} ${28 - (v / maxTrend) * 26}`)
              .join(" ")}
            fill="none"
            stroke="rgba(16,185,129,0.55)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle
            cx={120}
            cy={28 - (acc.trend[acc.trend.length - 1] / maxTrend) * 26}
            r="2"
            className="fill-emerald-500"
          />
        </svg>
        <p className="mt-1 text-[9px] text-zinc-600">近 14 次采样 · 跌破阈值自动弹系统通知</p>
      </div>
    </div>
  );
}