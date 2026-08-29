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

/// 每日消费热图（类 Codex 26 周方格；借鉴 dsh-cost-meter 的用量热图形态）。
/// data 为升序 {date: "MM-DD", amount}，跨年由月份倒推年份。

/// 把升序 "MM-DD" 序列换算为带年份的 Date（倒推法：更早日期若月份更大则属上一年）
export function mdDatesAscending(list: string[], today: Date): Date[] {
  const out: Date[] = [];
  let cur = today;
  for (let i = list.length - 1; i >= 0; i--) {
    const [m, d] = list[i].split("-").map(Number);
    let year = cur.getFullYear();
    const md = m * 100 + d;
    const curMd = (cur.getMonth() + 1) * 100 + cur.getDate();
    if (md > curMd) year -= 1;
    out.unshift(new Date(year, m - 1, d));
    cur = new Date(year, m - 1, d);
  }
  return out;
}

export function SpendHeatmap({
  data,
  weeks = 26,
  className,
}: {
  data: { date: string; amount: number }[];
  weeks?: number;
  className?: string;
}) {
  if (!data.length) {
    return <div className={cn("text-center text-xs text-muted-foreground", className)}>暂无记录</div>;
  }
  const today = new Date();
  const dates = mdDatesAscending(data.map((d) => d.date), today);
  // 取最近 N 周（按今天所在周对齐：周日结束的一周）
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - ((today.getDay() + 6) % 7) - (weeks * 7 - 1));
  const filtered = dates.filter((d) => d.getTime() >= windowStart.getTime() && d.getTime() <= today.getTime());
  const byDate = new Map<number, number>();
  data.forEach((p, i) => {
    const d = dates[i];
    if (d) byDate.set(d.getTime() - (d.getTime() % 86400000), p.amount);
  });
  const max = Math.max(1, ...filtered.map((d) => byDate.get(dayStart(d)) ?? 0));
  // 周列划分：按周一开头分桶
  const cols: Date[][] = [];
  let curCol: Date[] = [];
  const sorted = [...filtered].sort((a, b) => a.getTime() - b.getTime());
  for (const d of sorted) {
    const dayStartIdx = (d.getDay() + 6) % 7; // 周一=0
    if (curCol.length === 0 || curCol.length === dayStartIdx) {
      // 新列起点：该日应位于列首
      if (dayStartIdx === 0 || curCol.length === 0) {
        if (curCol.length > 0) cols.push(curCol);
        curCol = [];
      }
    }
    if (curCol.length === 0) {
      cols.push([]);
    }
    cols[cols.length - 1].push(d);
  }
  if (curCol.length) cols.push([...curCol]);
  const opacity = (amt: number) => {
    if (amt <= 0) return 0.08;
    const r = amt / max;
    return 0.2 + 0.8 * Math.sqrt(r);
  };
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap gap-[3px]">
        {cols.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }, (_, row) => {
              const d = col[row];
              if (!d || d.getTime() > today.getTime()) {
                return <div key={row} className="size-2.5 rounded-[2px] bg-transparent" />;
              }
              const amt = byDate.get(dayStart(d)) ?? 0;
              return (
                <div
                  key={row}
                  className="size-2.5 rounded-[2px] bg-primary"
                  style={{ opacity: opacity(amt) }}
                  title={`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} · ¥${amt.toFixed(2)}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{weeks} 周每日消费</span>
        <span className="flex items-center gap-1">
          少
          {[0.08, 0.3, 0.55, 0.85].map((o) => (
            <span key={o} className="size-2.5 rounded-[2px] bg-primary" style={{ opacity: o }} />
          ))}
          多
        </span>
      </div>
    </div>
  );
}

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/// 余额三段进度条（蓝=余额 / 灰=已用，其中今日消费部分染橙；基准由 balanceMax 或 充值+赠送 决定）
export function SegmentBar({
  balance,
  today,
  used,
  max,
  className,
}: {
  balance: number;
  today: number;
  used: number;
  max: number;
  className?: string;
}) {
  if (max <= 0) return null;
  const bPct = Math.max(0, Math.min(100, (balance / max) * 100));
  const uPct = Math.max(0, Math.min(100 - bPct, (used / max) * 100));
  const tPct = Math.max(0, Math.min(uPct, (today / max) * 100));
  return (
    <div className={className}>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${bPct}%` }} title={`余额 ${bPct.toFixed(0)}%`} />
        <div
          className="absolute inset-y-0 bg-primary/30"
          style={{ left: `${bPct}%`, width: `${uPct}%` }}
          title={`已用 ${uPct.toFixed(0)}%`}
        />
        {tPct > 0 && (
          <div
            className="absolute inset-y-0 bg-orange-400/90"
            style={{ left: `${bPct + uPct - tPct}%`, width: `${tPct}%` }}
            title={`今日消费 ${tPct.toFixed(0)}%`}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>余额 {Math.round(bPct)}%</span>
        <span>今日 {Math.round(tPct)}%</span>
        <span>已用 {Math.round(uPct)}%</span>
      </div>
    </div>
  );
}
