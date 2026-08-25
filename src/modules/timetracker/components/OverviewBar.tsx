import { Loader2, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { DayOverview } from "../types";
import { formatDuration, formatDurationShort } from "../types";

interface Props {
  overview: DayOverview | null;
  appCount: number;
  loading: boolean;
  /** 近 7 天每日总时长（升序），迷你趋势图数据 */
  dailyTotals?: [string, number][];
  /** 周期标签（今日/本周/本月） */
  label?: string;
  /** 对比周期标签（昨日/上周/上月） */
  diffLabel?: string;
}

function DiffBadge({ current, prev, label }: { current: number; prev: number; label: string }) {
  // 前一日无数据时不显示对比，避免「比空多 6h」的无意义文案
  if (prev <= 0) return null;
  const diff = current - prev;
  const abs = Math.abs(diff);
  // 差异小于 5 分钟视为持平
  if (abs < 300) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" />
        与{label}持平
      </span>
    );
  }
  const more = diff > 0;
  return (
    <span
      className={`flex items-center gap-1 text-xs ${more ? "text-orange-500" : "text-emerald-500"}`}
    >
      {more ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      较{label}{more ? "多" : "少"} {formatDurationShort(abs)}
    </span>
  );
}

/**
 * 概览横条：主窗口/弹窗顶部的一行关键数字，替代原卡片式统计。
 * 浅色底条（非边框卡片），总时长放大为视觉焦点，活跃占比、应用数、趋势并排。
 * label/diffLabel 按今日/本周/本月切换文案。
 */
export function OverviewBar({
  overview,
  appCount,
  loading,
  dailyTotals,
  label = "今日使用",
  diffLabel = "昨日",
}: Props) {
  const activePct =
    overview && overview.total_sec > 0
      ? Math.round((overview.active_sec / overview.total_sec) * 100)
      : 0;

  return (
    <div className="flex items-center justify-between gap-5 rounded-xl bg-secondary/40 px-4 py-3">
      {/* 总时长（视觉焦点） */}
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        {overview ? (
          <>
            <div className="mt-0.5 text-3xl font-semibold leading-none tabular-nums">
              {formatDuration(overview.total_sec)}
            </div>
            <div className="mt-1.5 h-4">
              <DiffBadge current={overview.total_sec} prev={overview.prev_total_sec} label={diffLabel} />
            </div>
          </>
        ) : loading ? (
          <Loader2 className="mt-1 size-6 animate-spin text-muted-foreground" />
        ) : (
          <div className="mt-0.5 text-3xl font-semibold leading-none tabular-nums">—</div>
        )}
      </div>

      <div className="h-10 w-px shrink-0 bg-border" />

      {/* 活跃时长 + 占比条 */}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">活跃使用</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums">
            {overview ? formatDuration(overview.active_sec) : "—"}
          </span>
          {overview && overview.total_sec > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">{activePct}%</span>
          )}
        </div>
        <div className="mt-1.5 h-1.5 max-w-40 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${activePct}%` }}
          />
        </div>
      </div>

      <div className="h-10 w-px shrink-0 bg-border" />

      {/* 应用数 */}
      <div className="shrink-0">
        <div className="text-xs text-muted-foreground">应用</div>
        <div className="mt-0.5 text-xl font-semibold tabular-nums">
          {overview ? overview.app_count : loading ? "—" : appCount}
        </div>
      </div>

      {/* 近 7 天迷你趋势（窄窗口隐藏） */}
      {dailyTotals && dailyTotals.length > 1 && (
        <>
          <div className="hidden h-10 w-px shrink-0 bg-border sm:block" />
          <div className="hidden shrink-0 sm:block">
            <div className="mb-1 text-right text-xs text-muted-foreground">近 7 天</div>
            <Sparkline data={dailyTotals} />
          </div>
        </>
      )}
    </div>
  );
}

/** 近 7 日迷你趋势条：最后一根（今天）高亮，悬停显示具体日期与时长 */
function Sparkline({ data }: { data: [string, number][] }) {
  const max = Math.max(...data.map(([, v]) => v), 1);
  return (
    <div
      title={data.map(([d, v]) => `${d.slice(5)} ${formatDuration(v)}`).join("\n")}
      className="flex h-6 items-end gap-[3px]"
    >
      {data.map(([date, sec], i) => {
        const isToday = i === data.length - 1;
        const h = Math.max((sec / max) * 100, 6);
        return (
          <span
            key={date}
            className={`w-full flex-1 rounded-sm ${isToday ? "bg-primary" : "bg-primary/30"}`}
            style={{ height: `${h}%` }}
          />
        );
      })}
    </div>
  );
}
