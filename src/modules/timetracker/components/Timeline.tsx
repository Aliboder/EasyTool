import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Event } from "../types";
import { formatDuration } from "../types";

interface Props {
  events: Event[];
  onSelect: (appId: number) => void;
  /** 是否正在查看今天（决定是否显示当前时刻指示线） */
  isToday?: boolean;
  /** 标题栏标签（如日期或周期） */
  date?: string;
  /** 分组粒度：hour=今日 24 根柱（小时），day=周/月按天 */
  granularity?: "hour" | "day";
  /** day 粒度下要渲染的日期序列（YYYY-MM-DD，升序），空日/未来日也显示 */
  dayKeys?: string[];
}

/** 调色板：按 appId 升序前 TOP_N 稳定分配（同软件永远同色，进出时长排名不变色） */
const PALETTE = [
  "#3b82f6",
  "#22c55e",
  "#eab308",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
];
const OTHER_COLOR = "#9ca3af";
const TOP_N = 8;
/** 柱满格 = 60 分钟（仅 hour 粒度） */
const FULL_MIN = 60;

function hourOf(s: string): number {
  return Number(s.split(" ")[1]?.split(":")[0] ?? 0);
}

interface Segment {
  appId: number | null; // null = 「其他」
  label: string;
  color: string;
  pct: number;
  sec: number;
}

interface Column {
  key: string;
  label: string;
  segments: Segment[];
  /** 离开（挂机）时长，秒（仅 hour 粒度有意义） */
  idleSec: number;
  /** 离开时段占满格的百分比（hour 粒度灰块） */
  idlePct: number;
}

interface LegendItem {
  appId: number; // -1 = 其他
  name: string;
  color: string;
  totalSec: number;
}

export function Timeline({
  events,
  onSelect,
  isToday = true,
  date,
  granularity = "hour",
  dayKeys,
}: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // 图例联动：悬停某软件时高亮它在所有柱段的颜色
  const [hoverLegend, setHoverLegend] = useState<number | null>(null);

  const { columns, legend } = useMemo(() => {
    // 柱高只计活跃时长；按 app 累计（hour/day 两种粒度都活跃优先）
    const byAppTotal = new Map<number, { name: string; sec: number }>();
    for (const e of events) {
      if (e.duration_sec <= 0 || e.is_active !== 1) continue;
      const t = byAppTotal.get(e.app_id) ?? { name: e.app_name, sec: 0 };
      t.sec += e.duration_sec;
      byAppTotal.set(e.app_id, t);
    }

    // 颜色稳定：按 appId 升序取前 TOP_N 分配调色板
    const colorOf = new Map<number, string>();
    [...byAppTotal.keys()]
      .sort((a, b) => a - b)
      .slice(0, TOP_N)
      .forEach((id, i) => colorOf.set(id, PALETTE[i]));

    // 某列：把该列的各 app 时长转成堆叠段（段高按归一化基准）
    const makeSegments = (
      appSec: Map<number, number>,
      unitSec: number,
    ): Segment[] => {
      const entries = [...appSec.entries()].sort(
        (a, b) => (byAppTotal.get(b[0])?.sec ?? 0) - (byAppTotal.get(a[0])?.sec ?? 0),
      );
      const segments: Segment[] = [];
      let otherSec = 0;
      let usedPct = 0;
      for (const [appId, sec] of entries) {
        const color = colorOf.get(appId);
        if (!color) {
          otherSec += sec; // 非 Top N → 并入「其他」
          continue;
        }
        const pct = Math.min((sec / unitSec) * 100, 100 - usedPct);
        usedPct += pct;
        segments.push({
          appId,
          label: byAppTotal.get(appId)?.name ?? "未知",
          color,
          pct,
          sec,
        });
      }
      if (otherSec > 0 && usedPct < 100) {
        const pct = Math.min((otherSec / unitSec) * 100, 100 - usedPct);
        segments.push({ appId: null, label: "其他", color: OTHER_COLOR, pct, sec: otherSec });
      }
      return segments;
    };

    let columns: Column[];
    if (granularity === "day") {
      // 按日聚合：柱高归一化到「当日最多」，确保整段时长分布可见
      const dayApp = new Map<string, Map<number, number>>();
      const dayTotal = new Map<string, number>();
      for (const e of events) {
        if (e.duration_sec <= 0 || e.is_active !== 1) continue;
        const day = e.start_time.split(" ")[0];
        if (!dayApp.has(day)) dayApp.set(day, new Map());
        const m = dayApp.get(day)!;
        m.set(e.app_id, (m.get(e.app_id) ?? 0) + e.duration_sec);
        dayTotal.set(day, (dayTotal.get(day) ?? 0) + e.duration_sec);
      }
      const maxDay = Math.max(...dayTotal.values(), 1);
      const keys = dayKeys ?? [...dayTotal.keys()].sort();
      columns = keys.map((day) => {
        const segments = dayApp.get(day)?.size
          ? makeSegments(dayApp.get(day)!, maxDay)
          : [];
        return {
          key: day,
          label: day.slice(5), // MM-DD
          segments,
          idleSec: 0,
          idlePct: 0,
        };
      });
    } else {
      // 按小时聚合：满格 = 60 分钟（绝对刻度）
      const hourApp: Map<number, number>[] = Array.from({ length: 24 }, () => new Map());
      const hourIdle = new Array<number>(24).fill(0);
      for (const e of events) {
        if (e.duration_sec <= 0) continue;
        const h = hourOf(e.start_time);
        if (!Number.isInteger(h) || h < 0 || h > 23) continue;
        if (e.is_active !== 1) {
          hourIdle[h] += e.duration_sec; // 离开：只累计，不占柱高
          continue;
        }
        hourApp[h].set(e.app_id, (hourApp[h].get(e.app_id) ?? 0) + e.duration_sec);
      }
      columns = hourApp.map((apps, hour) => {
        const segments = makeSegments(apps, 60 * FULL_MIN);
        const usedPct = segments.reduce((s, sg) => s + sg.pct, 0);
        const idlePct = Math.min(
          (hourIdle[hour] / 60 / FULL_MIN) * 100,
          Math.max(100 - usedPct, 0),
        );
        return {
          key: String(hour),
          label: String(hour),
          segments,
          idleSec: hourIdle[hour],
          idlePct,
        };
      });
    }

    const ranked = [...byAppTotal.entries()].sort((a, b) => b[1].sec - a[1].sec);
    const legend: LegendItem[] = ranked.map(([id, v]) => ({
      appId: id,
      name: v.name,
      color: colorOf.get(id) ?? OTHER_COLOR,
      totalSec: v.sec,
    }));
    const otherTotal = ranked
      .filter(([id]) => !colorOf.has(id))
      .reduce((s, [, v]) => s + v.sec, 0);
    if (otherTotal > 0) {
      legend.push({ appId: -1, name: "其他", color: OTHER_COLOR, totalSec: otherTotal });
    }
    return { columns, legend };
  }, [events, granularity, dayKeys]);

  // 图例高亮匹配：hoverLegend = -1 表示「其他」（对应 appId=null 的段）
  const matchLegend = (segAppId: number | null): boolean => {
    if (hoverLegend === null) return true;
    if (hoverLegend === -1) return segAppId === null;
    return segAppId === hoverLegend;
  };

  const hovered = hoverIndex !== null ? columns[hoverIndex].segments.filter((s) => s.sec > 0) : [];
  const hoveredIdle = hoverIndex !== null ? columns[hoverIndex].idleSec : 0;
  const isHour = granularity === "hour";
  // 日粒度柱多时抽稀横轴标签，避免重叠
  const labelEvery = isHour ? 1 : columns.length > 14 ? 5 : 1;

  return (
    <div>
      <ChartHeader
        hoverIndex={hoverIndex}
        hovered={hovered}
        idleSec={hoveredIdle}
        hasData={legend.length > 0}
        date={date}
        isHour={isHour}
      />
      <div className="pt-3">
        {legend.length === 0 ? (
          <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
            {isHour ? "这一天没有活跃使用记录" : "这段时间没有活跃使用记录"}
          </div>
        ) : (
          <>
            <div className="relative">
              {/* 满格/半格参考线（仅小时粒度） */}
              {isHour && (
                <>
                  <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-1/2 border-t border-dashed border-border/60" />
                  <span className="pointer-events-none absolute -top-1 right-0 bg-background px-1 text-[9px] leading-none text-muted-foreground">
                    60m
                  </span>
                  <span className="pointer-events-none absolute bottom-1/2 right-0 translate-y-1/2 bg-background px-1 text-[9px] leading-none text-muted-foreground">
                    30m
                  </span>
                </>
              )}
              {/* 堆叠柱 */}
              <div className="flex h-36 items-end gap-[2px] pr-8">
                {columns.map((col, i) => {
                  const { key, segments, idleSec, idlePct, label } = col;
                  return (
                    <div
                      key={key}
                      onMouseEnter={() => setHoverIndex(i)}
                      onMouseLeave={() => setHoverIndex((cur) => (cur === i ? null : cur))}
                      title={
                        segments.length > 0 || idleSec > 0
                          ? `${isHour ? `${String(key).padStart(2, "0")}:00-${String((Number(key) + 1) % 24).padStart(2, "0")}:00` : label} · ` +
                            segments.map((s) => `${s.label} ${formatDuration(s.sec)}`).join(" / ") +
                            (idleSec > 0 ? (segments.length > 0 ? " · " : "") + `挂机 ${formatDuration(idleSec)}` : "")
                          : undefined
                      }
                      className="group relative flex h-full flex-1 cursor-default flex-col justify-end rounded-t-sm bg-muted/30"
                    >
                      {hoverIndex === i && (
                        <div className="pointer-events-none absolute inset-0 rounded-t-sm ring-1 ring-inset ring-primary/50" />
                      )}
                      {/* 离开时段灰块：占该小时剩余空间 */}
                      {isHour && idlePct > 0 && (
                        <div
                          className="w-full bg-muted-foreground/20"
                          style={{ height: `${idlePct}%` }}
                        />
                      )}
                      {segments.map((s) => {
                        const match = matchLegend(s.appId);
                        return (
                          <div
                            key={s.label}
                            onClick={() => s.appId !== null && onSelect(s.appId)}
                            style={{
                              height: `${s.pct}%`,
                              backgroundColor: s.color,
                            }}
                            className={cn(
                              "transition-opacity duration-100",
                              match
                                ? hoverLegend !== null
                                  ? "opacity-100"
                                  : "cursor-pointer hover:opacity-80"
                                : "opacity-20",
                            )}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              {/* 当前时刻指示线（仅今天小时视图） */}
              {isHour && isToday && legend.length > 0 && <NowLine />}
            </div>
            {/* X 轴标签 */}
            <div className="mt-1 flex gap-[2px] pr-8 text-center text-[9px] tabular-nums text-muted-foreground">
              {columns.map((col, i) => (
                <span key={col.key} className="flex-1">
                  {isHour || i % labelEvery === 0 ? col.label : ""}
                </span>
              ))}
            </div>
          </>
        )}
        {/* 图例：悬停联动高亮柱段，点击打开应用详情 */}
        <LegendRow
          legend={legend}
          hovered={hoverLegend}
          onHover={setHoverLegend}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

/** 标题行：默认说明文案；悬停某柱时切换为该柱明细（含挂机） */
function ChartHeader({
  hoverIndex,
  hovered,
  idleSec,
  hasData,
  date,
  isHour,
}: {
  hoverIndex: number | null;
  hovered: Segment[];
  idleSec: number;
  hasData: boolean;
  date?: string;
  isHour: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b pb-2">
      <h3 className="text-sm font-medium">
        时间线{date ? ` · ${date}` : ""}
      </h3>
      <div className="max-w-[70%] truncate text-right text-[11px] text-muted-foreground">
        {hoverIndex !== null && (hovered.length > 0 || idleSec > 0) ? (
          <span>
            {hovered.map((s) => `${s.label} ${formatDuration(s.sec)}`).join(" / ")}
            {idleSec > 0 && (hovered.length > 0 ? " · " : "") + `挂机 ${formatDuration(idleSec)}`}
          </span>
        ) : hasData ? (
          isHour ? (
            <span>满格 = 60 分钟 · 只计活跃 · 灰块 = 挂机时长</span>
          ) : (
            <span>柱高 = 当日活跃时长 · 只计活跃</span>
          )
        ) : isHour ? (
          <span>这一天没有活跃使用记录</span>
        ) : (
          <span>这段时间没有活跃使用记录</span>
        )}
      </div>
    </div>
  );
}

/** 当前时刻竖线：精确到分钟定位在图表区内 */
function NowLine() {
  const now = new Date();
  const pct = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
  return (
    <div
      className="pointer-events-none absolute bottom-0 top-0 w-px bg-red-500/70"
      style={{ left: `${pct}%` }}
      title="当前时刻"
    />
  );
}

function LegendRow({
  legend,
  hovered,
  onHover,
  onSelect,
}: {
  legend: LegendItem[];
  hovered: number | null;
  onHover: (appId: number | null) => void;
  onSelect: (appId: number) => void;
}) {
  if (legend.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      {legend.map((item) => {
        const active = hovered === item.appId;
        return (
          <button
            key={item.name}
            onMouseEnter={() => item.appId >= 0 && onHover(item.appId)}
            onMouseLeave={() => onHover(null)}
            onClick={() => item.appId >= 0 && onSelect(item.appId)}
            disabled={item.appId < 0}
            title={item.appId >= 0 ? "悬停联动高亮 · 点击查看详情" : undefined}
            className={cn(
              "flex items-center gap-1 rounded px-1 py-0.5 text-xs",
              item.appId >= 0
                ? active
                  ? "bg-accent"
                  : "hover:bg-accent"
                : "text-muted-foreground",
            )}
          >
            <span
              className="inline-block size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: item.color }}
            />
            <span className="max-w-28 truncate">{item.name}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatDuration(item.totalSec)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
