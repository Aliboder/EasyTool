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

/** 面积趋势图（消费/用量随时间的上升趋势） */
export function AreaTrend({
  points,
  height = 56,
  className,
}: {
  points: { x: number; y: number }[];
  height?: number;
  className?: string;
}) {
  if (!points.length) {
    return (
      <div className={cn("flex items-center justify-center text-[10px] text-muted-foreground", className)} style={{ height }}>
        暂无趋势数据
      </div>
    );
  }
  if (points.length === 1) {
    return (
      <div className={cn("flex items-center justify-center text-[10px] text-muted-foreground", className)} style={{ height }}>
        新周期开始后出现趋势
      </div>
    );
  }
  const W = 300;
  const H = height;
  const ys = points.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = Math.max(1, hi - lo);
  const step = W / (points.length - 1);
  const pts = points.map(
    (p, i) => `${(i * step).toFixed(1)},${(H - ((p.y - lo) / span) * H * 0.9 - H * 0.05).toFixed(1)}`,
  );
  const path = `M ${pts.join(" L ")}`;
  const area = `${path} L ${W},${H} L 0,${H} Z`;
  const last = { x: W, y: H - ((ys[ys.length - 1] - lo) / span) * H * 0.9 - H * 0.05 };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-auto w-full", className)} preserveAspectRatio="none">
      <defs>
        <linearGradient id="areatrend" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity=".35" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#areatrend)" />
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <circle cx={last.x} cy={last.y} r={2.5} fill="var(--primary)" />
    </svg>
  );
}

/** 环形用量（single numeric percent）—— 用于 Go 每个窗口的视觉主位数 */
export function Ring({
  percent,
  size = 56,
  className,
}: {
  percent: number;
  size?: number;
  className?: string;
}) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, percent)) / 100 * c;
  const color =
    percent >= 90
      ? "var(--destructive)"
      : percent >= 70
        ? "oklch(0.72 0.17 65)"
        : "oklch(0.72 0.18 155)";
  const track = "var(--muted)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={5}
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
