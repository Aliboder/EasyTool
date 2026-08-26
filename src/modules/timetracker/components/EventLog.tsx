import { useEffect, useMemo } from "react";
import type { Event } from "../types";
import { CATEGORY_LABELS, categoryColor, formatDuration, formatDurationShort } from "../types";
import { cn } from "@/lib/utils";
import { useFileIcons } from "@/hooks/useFileIcons";

interface Props {
  events: Event[];
  /** 该记录是否是今天 */
  isToday?: boolean;
  /** 点击行打开应用详情 */
  onSelect?: (appId: number) => void;
}

/** 取 "HH:MM" */
function hhmm(s: string): string {
  return s.split(" ")[1]?.slice(0, 5) ?? s;
}

interface Group {
  appId: number;
  name: string;
  time: string;
  /** 段结束时间（进行中会话为 null，显示时退化为只有起点） */
  end: string | null;
  dur: number;
  idleDur: number;
  /** 该段开始时离开的应用（链式：离开 X → 打开 Y） */
  left: string | null;
  /** exe 路径（取图标用） */
  path?: string;
  category: string;
}

/**
 * 使用记录：按时间顺序的「切换流水」——时间轴（状态圆点 + 连接线）、应用图标、
 * 时长条（绿=活跃/黄=挂机）、状态徽章。
 * 相邻两条会话是「上一条离开、这一条打开」；同应用内部窗口变化/活跃-挂机分割
 * 会拆出多条同 app 事件（看似 A→A），这里按 app 合并成一条，让流水只有真实的应用切换。
 */
export function EventLog({ events, isToday = false, onSelect }: Props) {
  const groups = useMemo(() => {
    const out: Group[] = [];
    for (const e of events) {
      const g = out[out.length - 1];
      if (g && g.appId === e.app_id) {
        g.dur += e.duration_sec;
        g.idleDur += e.is_active !== 1 ? e.duration_sec : 0;
        g.end = e.end_time;
      } else {
        out.push({
          appId: e.app_id,
          name: e.app_name,
          time: e.start_time,
          end: e.end_time,
          dur: e.duration_sec,
          idleDur: e.is_active !== 1 ? e.duration_sec : 0,
          left: out.length > 0 ? out[out.length - 1].name : null,
          path: e.exe_path ?? undefined,
          category: e.category,
        });
      }
    }
    return out;
  }, [events]);

  // 应用图标（useFileIcons 内部按路径缓存去重）
  const { icons, loadIcon } = useFileIcons();
  useEffect(() => {
    for (const g of groups) if (g.path) loadIcon(g.path).catch(() => {});
  }, [groups, loadIcon]);

  if (groups.length === 0) return null;

  // 最新在最上面：倒序显示，链式「离开 X → 打开 Y」仍指向它开始前的那个应用
  const display = [...groups].reverse();
  const maxDur = Math.max(...display.map((g) => g.dur), 1);

  return (
    <div className="rounded-lg border bg-secondary/10 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-medium">
          使用记录{isToday ? "" : `（${groups[0].time.slice(0, 10)}）`}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          共 {display.length} 次切换 · 绿=活跃 黄=挂机
        </span>
      </div>
      <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
        {display.map((g, i) => {
          const activeDur = g.dur - g.idleDur;
          const status =
            g.idleDur === 0
              ? {
                  label: "活跃",
                  dot: "bg-emerald-500",
                  ring: "ring-emerald-500/10",
                  cls: "bg-emerald-500/15 text-emerald-600",
                }
              : activeDur === 0
                ? {
                    label: "挂机",
                    dot: "bg-muted-foreground/50",
                    ring: "ring-muted-foreground/10",
                    cls: "bg-muted text-muted-foreground",
                  }
                : {
                    label: `含挂机 ${formatDurationShort(g.idleDur)}`,
                    dot: "bg-amber-500",
                    ring: "ring-amber-500/10",
                    cls: "bg-amber-500/15 text-amber-600",
                  };
          const isLast = i === display.length - 1;
          const icon = g.path ? icons[g.path] : undefined;
          const catColor = categoryColor(g.category);
          return (
            <div
              key={`${g.appId}-${g.time}`}
              onClick={() => onSelect?.(g.appId)}
              className="flex cursor-pointer gap-2 rounded-md px-2 py-2 text-xs transition-colors hover:bg-accent/50"
              title={`${g.time} · ${g.left ? `离开 ${g.left} → ` : ""}${g.name} · 时长 ${formatDuration(g.dur)}`}
            >
              {/* 时间轴：状态圆点 + 向下连接线 */}
              <div className="flex shrink-0 flex-col items-center">
                <span
                  className={cn(
                    "relative mt-2 size-2 shrink-0 rounded-full ring-4",
                    status.dot,
                    status.ring,
                  )}
                >
                  {/* 最新一条（正在使用）脉冲提示，仅今天 */}
                  {isToday && i === 0 && g.idleDur === 0 && (
                    <span className="absolute -inset-1 animate-ping rounded-full bg-emerald-500/30" />
                  )}
                </span>
                {!isLast && <span className="mt-0.5 w-px flex-1 bg-border/60" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-[4.5rem] shrink-0 tabular-nums text-muted-foreground">
                    {g.end ? `${hhmm(g.time)}–${hhmm(g.end)}` : hhmm(g.time)}
                  </span>
                  {icon ? (
                    <img
                      src={`data:image/png;base64,${icon}`}
                      alt=""
                      className="size-4 shrink-0 object-contain"
                    />
                  ) : (
                    /* 无图标兜底：分类色首字母块 */
                    <span
                      className="flex size-4 shrink-0 items-center justify-center rounded text-[9px] font-bold"
                      style={{ backgroundColor: `${catColor}22`, color: catColor }}
                    >
                      {g.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-white"
                    style={{ backgroundColor: catColor }}
                  >
                    {CATEGORY_LABELS[g.category] ?? g.category}
                  </span>
                  {/* 纯活跃行由绿点表达，徽章只在含挂机时出现，避免全绿噪音 */}
                  {g.idleDur > 0 && (
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", status.cls)}>
                      {status.label}
                    </span>
                  )}
                </div>
                {/* 时长条：满宽灰轨道 + 彩色填充（相对组内最长），绿=活跃、黄=挂机；最短 12px 保证短会话可见 */}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="flex h-full overflow-hidden rounded-full"
                      style={{ width: `${(g.dur / maxDur) * 100}%`, minWidth: 12 }}
                    >
                      {activeDur > 0 && (
                        <span
                          className="h-full bg-emerald-500"
                          style={{ width: `${(activeDur / g.dur) * 100}%` }}
                        />
                      )}
                      {g.idleDur > 0 && (
                        <span
                          className="h-full bg-amber-500/70"
                          style={{ width: `${(g.idleDur / g.dur) * 100}%` }}
                        />
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatDuration(g.dur)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
