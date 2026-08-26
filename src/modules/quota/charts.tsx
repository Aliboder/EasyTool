// 通用 SVG 图表组件，供额度监控复用。纯函数渲染，无外部依赖。
// 主色取自软件 --primary 家族；用量颜色按告警程度分级。

import { cn } from "@/lib/utils";

/** 每日消费柱状图（近 N 天）；amount 为当日消费额 */
export function DailyBars({
  data,
  days = 14,
  className,
}: {
  data: { date: string; amount: number }[];
  days?: number;
  className?: string;
}) {
  const frame = data.slice(-days);
  if (!frame.length) {
    return (
      <div className={cn("flex h-16 items-center justify-center text-xs text-muted-foreground", className)}>
        {days > 0 ? "正在加载..." : "暂无数据"}
      </div>
    );
  }
  const max = Math.max(1, ...frame.map((d) => d.amount));
  return (
    <div className={cn("flex h-16 items-end gap-0.5", className)}>
      {frame.map((d, i) => (
        <div
          key={`${d.date}-${i}`}
          className="min-w-0 flex-1 rounded-t bg-primary/25 transition-colors hover:bg-primary/45"
          style={{ height: `${Math.max(4, (d.amount / max) * 100)}%` }}
          title={`${d.date} · ¥${d.amount.toFixed(2)}`}
        />
      ))}
    </div>
  );
}

/** 环形用量（single numeric percent）—— 用于 Go 每个窗口的视觉主位数 */
export function Ring({
  percent,
  size = 56,
  className,
  colorPercent = percent,
}: {
  percent: number;
  size?: number;
  className?: string;
  /** 颜色告警按此值判断（默认与 percent 一致；展示剩余量时可传已用量，保证剩余越少越红） */
  colorPercent?: number;
}) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, percent)) / 100 * c;
  const color =
    colorPercent >= 90
      ? "var(--destructive)"
      : colorPercent >= 70
        ? "oklch(0.72 0.17 65)"
        : "oklch(0.72 0.18 155)";
  const track = "var(--muted)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={7} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c - filled}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="51%"
        dominantBaseline="middle"
        textAnchor="middle"
        className="fill-foreground"
        style={{ fontSize: size * 0.24, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
      >
        {percent}%
      </text>
    </svg>
  );
}
