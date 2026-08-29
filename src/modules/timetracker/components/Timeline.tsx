import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { FileQuestion } from "lucide-react";
import { useFileIcons } from "@/hooks/useFileIcons";
import type { Event } from "../types";
import { formatDuration, formatDurationShort } from "../types";

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

/** 调色板：按 appId 升序稳定分配（同软件永远同色，进出时长排名不变色） */
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
/** 调色板用尽后的稳定扩展色：黄金角 HSL 按 appId 生成，色相保持分离 */
function genColor(appId: number): string {
  return `hsl(${((appId * 137.508) % 360).toFixed(1)} 70% 55%)`;
}
/** 柱满格 = 60 分钟（仅 hour 粒度） */
const FULL_MIN = 60;
/** 柱区右侧为 60m/30m 标签预留的宽度（pr-8），NowLine 换算用 */
const AXIS_PAD_PX = 32;

/** 本地时间字符串（兼容 "YYYY-MM-DD HH:mm:ss" 与 ISO "T" 分隔）→ Date */
function parseLocal(s: string): Date {
  const [d, t] = s.split(/[T ]/);
  const [y, m, dd] = d.split("-").map(Number);
  const [hh, mm, ss] = (t ?? "0:0:0").split(":").map(Number);
  return new Date(y, m - 1, dd, hh ?? 0, mm ?? 0, ss ?? 0);
}

const dayOf = (s: string) => s.slice(0, 10);

/**
 * 会话按小时切分：把整段时长分摊到跨过的每个小时。
 * 后端只按「活跃翻转/切换/跨天」切段，一条 10:00-13:00 的会话若不切分会被整段计到 10 点。
 * 进行中会话（end_time 为 NULL）按 start + duration_sec 估 end，切分总量与 duration_sec 一致。
 */
function splitByHour(e: Event): [number, number][] {
  const start = parseLocal(e.start_time);
  const end = e.end_time
    ? parseLocal(e.end_time)
    : new Date(start.getTime() + e.duration_sec * 1000);
  // 防御：end 早于 start（时钟回拨/脏数据）时整段归到开始小时
  if (end.getTime() <= start.getTime()) return [[start.getHours(), e.duration_sec]];
  const out: [number, number][] = [];
  let t = start;
  while (t < end) {
    const h = t.getHours();
    const next = new Date(t);
    next.setHours(h + 1, 0, 0, 0);
    const segEnd = next.getTime() < end.getTime() ? next : end;
    const sec = Math.round((segEnd.getTime() - t.getTime()) / 1000);
    if (sec > 0) out.push([h, sec]);
    t = segEnd;
  }
  return out;
}

interface Segment {
  appId: number;
  label: string;
  color: string;
  pct: number;
  sec: number;
}

interface Column {
  key: string;
  label: string;
  segments: Segment[];
  /** 离开（挂机）时长，秒 */
  idleSec: number;
  /** 离开时段占满格的百分比（灰块） */
  idlePct: number;
}

interface LegendItem {
  appId: number;
  name: string;
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

  // 图例图标：按 app 取 exe 图标（useFileIcons 内部按路径缓存去重）
  const { icons, loadIcon } = useFileIcons();
  const pathOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of events) if (e.exe_path && !m.has(e.app_id)) m.set(e.app_id, e.exe_path);
    return m;
  }, [events]);
  useEffect(() => {
    for (const p of pathOf.values()) loadIcon(p).catch(() => {});
  }, [pathOf, loadIcon]);

  const { columns, legend } = useMemo(() => {
    // 柱高只计活跃时长；按 app 累计（hour/day 两种粒度都活跃优先）
    const byAppTotal = new Map<number, { name: string; sec: number }>();
    for (const e of events) {
      if (e.duration_sec <= 0 || e.is_active !== 1) continue;
      const t = byAppTotal.get(e.app_id) ?? { name: e.app_name, sec: 0 };
      t.sec += e.duration_sec;
      byAppTotal.set(e.app_id, t);
    }

    // 颜色稳定：按 appId 升序分配调色板，用尽后黄金角 HSL 扩展
    const colorOf = new Map<number, string>();
    [...byAppTotal.keys()]
      .sort((a, b) => a - b)
      .forEach((id, i) => colorOf.set(id, PALETTE[i] ?? genColor(id)));

    // 某列：把该列的各 app 时长转成堆叠段（段高按归一化基准）
    const makeSegments = (
      appSec: Map<number, number>,
      unitSec: number,
    ): { segments: Segment[]; scale: number } => {
      const entries = [...appSec.entries()].sort(
        (a, b) => (byAppTotal.get(b[0])?.sec ?? 0) - (byAppTotal.get(a[0])?.sec ?? 0),
      );
      // 每个应用独立成段，不做合并
      const raw: { appId: number; sec: number; pct: number }[] = entries.map(
        ([appId, sec]) => ({ appId, sec, pct: (sec / unitSec) * 100 }),
      );
      // 列总时长超满格（如某小时活跃 > 60 分钟）时按比例缩放而非截断，
      // 否则排名靠后的段会被钳到 0% 而完全消失；scale 供挂机灰块同步缩放
      let scale = 1;
      const totalPct = raw.reduce((s, r) => s + r.pct, 0);
      if (totalPct > 100) {
        scale = 100 / totalPct;
        for (const r of raw) r.pct *= scale;
      }
      const segments: Segment[] = raw.map((r) => ({
        appId: r.appId,
        label: byAppTotal.get(r.appId)?.name ?? "未知",
        color: colorOf.get(r.appId)!,
        pct: r.pct,
        sec: r.sec,
      }));
      return { segments, scale };
    };

    let columns: Column[];
    if (granularity === "day") {
      // 按日聚合：柱高归一化到「当日最多」，确保整段时长分布可见
      const dayApp = new Map<string, Map<number, number>>();
      const dayIdle = new Map<string, number>();
      for (const e of events) {
        if (e.duration_sec <= 0) continue;
        const day = dayOf(e.start_time);
        if (e.is_active !== 1) {
          dayIdle.set(day, (dayIdle.get(day) ?? 0) + e.duration_sec);
          continue;
        }
        if (!dayApp.has(day)) dayApp.set(day, new Map());
        const m = dayApp.get(day)!;
        m.set(e.app_id, (m.get(e.app_id) ?? 0) + e.duration_sec);
      }
      const dayTotal = new Map(
        [...dayApp.entries()].map(([day, m]) => [day, [...m.values()].reduce((s, v) => s + v, 0)]),
      );
      const maxDay = Math.max(...dayTotal.values(), 1);
      const keys = dayKeys ?? [...dayTotal.keys()].sort();
      columns = keys.map((day) => {
        const { segments, scale } = dayApp.get(day)?.size
          ? makeSegments(dayApp.get(day)!, maxDay)
          : { segments: [] as Segment[], scale: 1 };
        const usedPct = segments.reduce((s, sg) => s + sg.pct, 0);
        const idlePct = Math.min(
          ((dayIdle.get(day) ?? 0) / maxDay) * 100 * scale,
          Math.max(100 - usedPct, 0),
        );
        return {
          key: day,
          label: day.slice(5), // MM-DD
          segments,
          idleSec: dayIdle.get(day) ?? 0,
          idlePct,
        };
      });
    } else {
      // 按小时聚合：满格 = 60 分钟（绝对刻度）；长会话切分到跨过的每个小时
      const hourApp: Map<number, number>[] = Array.from({ length: 24 }, () => new Map());
      const hourIdle = new Array<number>(24).fill(0);
      for (const e of events) {
        if (e.duration_sec <= 0) continue;
        for (const [h, sec] of splitByHour(e)) {
          if (h < 0 || h > 23) continue;
          if (e.is_active !== 1) {
            hourIdle[h] += sec; // 离开：只累计，不占柱高
            continue;
          }
          hourApp[h].set(e.app_id, (hourApp[h].get(e.app_id) ?? 0) + sec);
        }
      }
      columns = hourApp.map((apps, hour) => {
        const { segments, scale } = makeSegments(apps, 60 * FULL_MIN);
        const usedPct = segments.reduce((s, sg) => s + sg.pct, 0);
        const idlePct = Math.min(
          (hourIdle[hour] / 60 / FULL_MIN) * 100 * scale,
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

    // 图例 = 全部应用（每个应用独立成段，不合并）
    const ranked = [...byAppTotal.entries()].sort((a, b) => b[1].sec - a[1].sec);
    const legend: LegendItem[] = ranked.map(([id, v]) => ({
      appId: id,
      name: v.name,
      totalSec: v.sec,
    }));
    return { columns, legend };
  }, [events, granularity, dayKeys]);

  // 悬停状态跨渲染保留；columns/legend 重建（切粒度、数据刷新）后旧值可能越界/失配，
  // 用前钳制，避免 columns[hoverIndex] 越界崩溃、悬停无匹配导致全部段变灰
  const idx = hoverIndex !== null && hoverIndex < columns.length ? hoverIndex : null;
  const hovLegend =
    hoverLegend !== null && legend.some((l) => l.appId === hoverLegend) ? hoverLegend : null;

  // 图例高亮匹配
  const matchLegend = (segAppId: number): boolean => {
    if (hovLegend === null) return true;
    return segAppId === hovLegend;
  };

  const hovered = idx !== null ? columns[idx].segments.filter((s) => s.sec > 0) : [];
  const hoveredIdle = idx !== null ? columns[idx].idleSec : 0;
  const isHour = granularity === "hour";
  // 日粒度柱多时抽稀横轴标签，避免重叠
  const labelEvery = isHour ? 1 : columns.length > 14 ? 5 : 1;

  return (
    <div>
      <ChartHeader
        hoverIndex={idx}
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
                      {idx === i && (
                        <div className="pointer-events-none absolute inset-0 rounded-t-sm ring-1 ring-inset ring-primary/50" />
                      )}
                      {segments.map((s) => {
                        const match = matchLegend(s.appId);
                        return (
                          <div
                            key={s.appId}
                            onClick={() => onSelect(s.appId)}
                            style={{
                              height: `${s.pct}%`,
                              minHeight: isHour ? undefined : 3, // 日视图小柱保底可见
                              backgroundColor: s.color,
                            }}
                            className={cn(
                              "transition-opacity duration-100",
                              match
                                ? hovLegend !== null
                                  ? "opacity-100"
                                  : "cursor-pointer hover:opacity-80"
                                : "opacity-20",
                            )}
                          />
                        );
                      })}
                      {/* 离开时段灰块：渲染在段上方（柱顶），活跃段保持底部锚定、与参考线对齐 */}
                      {idlePct > 0 && (
                        <div
                          className="w-full bg-muted-foreground/20"
                          style={{ height: `${idlePct}%` }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {/* 当前时刻指示线（仅今天小时视图） */}
              {isHour && isToday && legend.length > 0 && <NowLine />}
            </div>
            {/* X 轴标签 */}
            <div className="relative mt-1 flex gap-[2px] pr-8 text-[9px] tabular-nums text-muted-foreground">
              {columns.map((col, i) => (
                <span
                  key={col.key}
                  className="flex-1 text-center"
                >
                  {isHour || i % labelEvery === 0 ? col.label : ""}
                </span>
              ))}
              {/* 小时轴尾端刻度 24:00：左缘对齐柱区右缘（pr-8 预留区），不占 flex 份额 */}
              {isHour && (
                <span
                  className="absolute"
                  style={{ left: "calc(100% - 2rem)" }}
                >
                  24
                </span>
              )}
            </div>
          </>
        )}
        {/* 图例：图标 + 短时长；悬停联动高亮柱段，点击打开应用详情 */}
        <LegendRow
          legend={legend}
          hovered={hovLegend}
          onHover={setHoverLegend}
          onSelect={onSelect}
          icons={icons}
          pathOf={pathOf}
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
            <span>满格 = 60 分钟 · 灰块 = 挂机时长</span>
          ) : (
            <span>柱高 = 当日活跃时长 · 灰块 = 挂机时长</span>
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
  // 柱区比外层窄 AXIS_PAD_PX（右侧 60m/30m 标签留位）：按柱区实际宽度换算 left，越靠右越偏的问题消除
  return (
    <div
      className="pointer-events-none absolute bottom-0 top-0 w-px bg-red-500/70"
      style={{ left: `calc(${pct}% - ${(pct * AXIS_PAD_PX) / 100}px)` }}
    />
  );
}

function LegendRow({
  legend,
  hovered,
  onHover,
  onSelect,
  icons,
  pathOf,
}: {
  legend: LegendItem[];
  hovered: number | null;
  onHover: (appId: number | null) => void;
  onSelect: (appId: number) => void;
  icons: Record<string, string>;
  pathOf: Map<number, string>;
}) {
  if (legend.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-start gap-x-2 gap-y-2">
      {legend.map((item) => {
        const active = hovered === item.appId;
        const path = pathOf.get(item.appId);
        const icon = path ? icons[path] : undefined;
        return (
          <button
            key={item.appId}
            onMouseEnter={() => onHover(item.appId)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect(item.appId)}
            title={`${item.name} · ${formatDuration(item.totalSec)} · 悬停联动高亮，点击查看详情`}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded px-1.5 py-1",
              active ? "bg-accent" : "hover:bg-accent",
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center">
              {icon ? (
                <img
                  src={`data:image/png;base64,${icon}`}
                  alt=""
                  className="size-6 object-contain"
                />
              ) : (
                <FileQuestion className="size-4 text-muted-foreground" />
              )}
            </span>
            <span className="text-[10px] leading-none tabular-nums text-muted-foreground">
              {formatDurationShort(item.totalSec)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
