// 周 / 日 / 待办 三个视图（月视图留在 Page）。
// 时间轴布局复用 utils.layoutDay 纯函数（重叠分列、窗口钳制），全部数据来自父组件。

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { CalendarPlus, ChevronDown, ChevronRight, ListTodo, MapPin, Plus, Repeat, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fmtHM, fmtKeyLong, addDaysKey, layoutDay, localDayKey, todayKey, weekStartKey, weekdayOfKey, dayStartMs, courseColor, groupTimelineDays, tintedSurface, tintedBorder, tintedStrip, tintedProgress, tintedPill, blockTier, eventStatusOf, pickNextEvent, type BlockTier, type EventStatus, type EventVisual } from "./utils";
import type { EventDto, TodoDto } from "./types";

const HOUR_HEIGHT = 46;
/** 无事件时的默认纵向窗口（早 8 晚 21） */
const DEF_START_HOUR = 8;
const DEF_END_HOUR = 21;

type EventClick = (e: EventDto) => void;
type EventMenu = (e: EventDto, x: number, y: number) => void;
type TodoToggle = (t: TodoDto) => void;
type TodoMenu = (t: TodoDto, x: number, y: number) => void;
/** 订阅 id → 颜色（只读着色用） */
export type SubColors = Record<number, string>;

/** 每分钟实时刷新的当前毫秒（红线 / 今天高亮跟随时钟走动） */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** 容器实测宽度（供事件块按宽度分档：窄列缩字号） */
function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) setW(en.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** 双击时间轴空白处 → 由视口位置换算为 30 分钟对齐的开始小时 */
function timeFromPointerY(el: HTMLElement, clientY: number, startHour: number, endHour: number): number | null {
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) return null;
  const hourPx = (clientY - rect.top) / HOUR_HEIGHT + startHour;
  return Math.max(startHour, Math.min(endHour - 0.5, Math.round(hourPx * 2) / 2));
}

/** 事件的有效颜色：订阅色 > 用户自定义色 > 按课程名自动配色（始终着色） */
function eventTint(e: EventDto, subColors: SubColors): string {
  if (e.subscription_id != null) return subColors[e.subscription_id];
  return e.color ?? courseColor(e.title);
}

/** 根据可见事件自动给出紧凑的纵向窗口（含 1 小时余量，至少 8 小时；无事件回退早 8 晚 21） */
function fitWindow(events: EventDto[]): { start: number; end: number } {
  const timed = events.filter((e) => !e.all_day);
  if (timed.length === 0) return { start: DEF_START_HOUR, end: DEF_END_HOUR };
  const toH = (ms: number) => new Date(ms).getHours() + new Date(ms).getMinutes() / 60;
  let min = Infinity;
  let max = -Infinity;
  for (const e of timed) {
    min = Math.min(min, toH(e.start_ms));
    max = Math.max(max, toH(e.end_ms));
  }
  let start = Math.max(0, Math.floor(min) - 1);
  let end = Math.min(24, Math.ceil(max) + 1);
  if (end - start < 8) {
    const mid = (start + end) / 2;
    start = Math.max(0, Math.floor(mid - 4));
    end = Math.min(24, start + 8);
  }
  return { start, end };
}

function allDayOfDay(events: EventDto[], dayKey: number): EventDto[] {
  return events.filter((e) => e.all_day && localDayKey(e.start_ms) === dayKey);
}
function timedOfDay(events: EventDto[], dayKey: number): EventDto[] {
  return events.filter((e) => !e.all_day && localDayKey(e.start_ms) === dayKey);
}

/** 时间轴背景：小时刻度线 */
function TimelineGrid({ startHour, endHour }: { startHour: number; endHour: number }) {
  const n = endHour - startHour;
  return (
    <>
      {Array.from({ length: n + 1 }, (_, i) => i).map((i) => (
        <div key={i} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_HEIGHT }} />
      ))}
    </>
  );
}

function EventBlock({
  event,
  top,
  height,
  left,
  width,
  subColors,
  dimmed,
  status,
  pct = 0,
  isNext = false,
  tier,
  noteDot = false,
  badge = true,
  onClick,
  onMenu,
}: {
  event: EventDto;
  top: number;
  height: number;
  left: number;
  width: number;
  subColors: SubColors;
  dimmed?: boolean;
  /** 视觉状态；不传 = 保持原有静态色块（向后兼容） */
  status?: EventStatus;
  /** 进行中进度 0-100（仅 status="ongoing" 时有意义） */
  pct?: number;
  /** 今天「下一节课」高亮 */
  isNext?: boolean;
  /** 文字分档；不传 = 按高度推算（等价于旧行为） */
  tier?: BlockTier;
  /** 右下角备注圆点 */
  noteDot?: boolean;
  /** 是否显示「进行中 / 已结束」状态标（周视图卡片太小，关掉只留填色） */
  badge?: boolean;
  onClick: EventClick;
  onMenu: EventMenu;
}) {
  const t = tier ?? blockTier(Number.POSITIVE_INFINITY, height);
  const isPast = status === "past";
  const isOngoing = status === "ongoing";
  const tint = eventTint(event, subColors);
  const strip = tintedStrip(tint, isPast);
  const [hover, setHover] = useState(false);
  const [rect, setRect] = useState<{ x: number; y: number } | null>(null);
  // 空间分配：标题永远优先完整显示（不截断）；时间/地点只在卡片够高时出现；高卡片补备注填充
  const showMeta = t.showMeta;
  const notesLines = t.notesLines;
  const showNotes = notesLines > 0 && !!event.notes;
  // 状态标：卡片够高才显示（太矮只留进度填色，避免挤掉标题）；周视图可整体关掉
  const showBadge = badge && (isOngoing || isPast) && height >= 34;
  const enter = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setRect({ x: r.left, y: r.bottom });
    setHover(true);
  };
  const leave = () => {
    setHover(false);
    setRect(null);
  };
  // 悬停浮层定位：卡片下方 8px，左右钳制在视口内
  const tipStyle = rect
    ? {
        top: Math.min(rect.y + 8, window.innerHeight - 130),
        left: Math.max(8, Math.min(rect.x - 4, window.innerWidth - 236)),
      }
    : undefined;
  // 底色：事件色只做「柔和底 + 左侧色条」，文字走主题前景色（深色实心块压白字可读性差）；
  // 进行中 → 按进度填色；已结束 → 中性灰 + 去色（不整体降透明度，避免对比度掉到读不清）
  const blockStyle: CSSProperties = {
    top: top + 1,
    height: height - 2,
    left: `${left}%`,
    width: `${width}%`,
    background: isPast
      ? "var(--muted)"
      : tint
        ? isOngoing
          ? tintedProgress(tint, pct)
          : tintedSurface(tint)
        : "color-mix(in srgb, var(--primary) 12%, var(--card))",
    borderColor: tintedBorder(tint, isPast),
    borderLeft: `3px solid ${strip}`,
  };
  return (
    <div
      className={cn(
        "absolute overflow-hidden rounded-lg border px-2 py-1.5 shadow-sm transition-all hover:z-20 hover:shadow-md",
        dimmed && "opacity-40 saturate-[0.6]",
        isNext && "ring-2 ring-primary/70",
      )}
      style={blockStyle}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(event, e.clientX, e.clientY);
      }}
    >
      {/* 状态标（进行中 / 已结束）：右上角，卡片够高才显示 */}
      {showBadge && (
        <span
          className={cn(
            "absolute right-1 top-1 z-10 rounded-full px-1 py-px text-[9px] font-medium leading-none",
            isPast ? "bg-muted text-muted-foreground" : "bg-primary/20 text-primary",
          )}
        >
          {isOngoing ? "进行中" : "已结束"}
        </span>
      )}
      {/* 标题：不截断，自动换行，优先保证完整展示（极窄卡片才允许 2 行截断） */}
      <div
        className={cn(
          "break-words leading-snug font-semibold",
          isPast ? "text-muted-foreground" : "text-foreground",
          t.titlePx === 11 ? "text-[11px]" : "text-xs",
          t.titleClamp === 2 && "line-clamp-2",
          showBadge && "pr-9",
        )}
      >
        {event.title}
      </div>
      {/* 时间 + 地点：正常文档流，位于标题正下方，永不与标题重叠（卡片不够高时自动让位） */}
      {showMeta && (
        <div className="mt-1 flex items-center gap-1 text-[10px] leading-none text-muted-foreground">
          <span className={cn("flex-none rounded-full", isNext ? "size-1.5" : "size-1")} style={{ backgroundColor: strip }} />
          <span className={cn("truncate font-medium tabular-nums", isNext && "font-semibold text-primary")}>
            {fmtHM(event.start_ms)}–{fmtHM(event.end_ms)}
          </span>
          {event.location && (
            <>
              <span className="flex-none opacity-50">·</span>
              <span className={cn("truncate", isNext && "font-semibold text-primary")}>{event.location}</span>
            </>
          )}
        </div>
      )}
      {/* 高卡片：备注填充空档 */}
      {showNotes && (
        <div className={cn("mt-1 text-[10px] leading-snug text-muted-foreground", notesLines === 3 ? "line-clamp-3" : "line-clamp-2")}>
          {event.notes}
        </div>
      )}
      {/* 备注圆点：右下角（周视图用，不占文字空间） */}
      {noteDot && <span className="absolute bottom-1 right-1 size-1 rounded-full" style={{ backgroundColor: strip }} />}
      {/* 悬停浮层：置顶展示完整信息，避免被截断 */}
      {hover && rect && tipStyle
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[70] w-56 rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-xl"
              style={tipStyle}
            >
              <div
                className={cn("break-words text-xs font-semibold", event.subscription_id != null && "text-primary")}
              >
                {event.title}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {event.all_day ? "全天" : `${fmtHM(event.start_ms)}–${fmtHM(event.end_ms)}`}
                {event.subscription_id != null && " · 订阅"}
              </div>
              {event.location && <div className="mt-0.5 text-[11px] text-muted-foreground">📍 {event.location}</div>}
              {event.notes && (
                <div className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-muted-foreground">
                  {event.notes}
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** 左侧小时刻度列（窗口自适应）；nowPos 有值时在轴上挂一枚红色时间胶囊（对着实时线） */
function HourAxis({
  startHour,
  endHour,
  nowPos,
  nowLabel,
}: {
  startHour: number;
  endHour: number;
  nowPos?: number;
  nowLabel?: string;
}) {
  const n = endHour - startHour;
  return (
    <div className="relative w-10 shrink-0" style={{ height: n * HOUR_HEIGHT }}>
      {Array.from({ length: n + 1 }, (_, i) => i).map((i) => (
        <span
          key={i}
          className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
          style={{ top: i * HOUR_HEIGHT }}
        >
          {startHour + i}:00
        </span>
      ))}
      {/* 实时线胶囊：单独一列盖在刻度上，跟着当前时刻走 */}
      {nowPos != null && nowPos >= 0 && nowPos <= n * HOUR_HEIGHT && (
        <span
          className="absolute right-0 z-10 -translate-y-1/2 rounded-full bg-red-500 px-1 py-px text-[9px] font-medium tabular-nums text-white shadow-sm"
          style={{ top: nowPos }}
        >
          {nowLabel}
        </span>
      )}
      <div className="absolute inset-y-0 right-0 w-px bg-border" />
    </div>
  );
}

/** 周视图：课表样 7 列时间轴（周一起始），全天事件顶部条带，今天列红时刻线 */
export function WeekView({
  events,
  selectedKey,
  showWeekend,
  subColors,
  nowFocus,
  focusTitle,
  onFocusTitle,
  onSelectDay,
  onEventClick,
  onEventMenu,
  onCreateAt,
  onToggleWeekend,
}: {
  events: EventDto[];
  selectedKey: number;
  showWeekend: boolean;
  subColors: SubColors;
  /** 点「今天」时自增：触发时间轴滚动到当前时刻 */
  nowFocus: number;
  /** 只看某门课聚焦（null=全部） */
  focusTitle: string | null;
  onFocusTitle: (t: string | null) => void;
  onSelectDay: (k: number) => void;
  onEventClick: EventClick;
  onEventMenu: EventMenu;
  onCreateAt?: (startMs: number) => void;
  /** 5 列 / 7 列切换（写在模块配置里持久化） */
  onToggleWeekend: (v: boolean) => void;
}) {
  const days = useMemo(() => {
    const start = weekStartKey(selectedKey);
    const count = showWeekend ? 7 : 5;
    return Array.from({ length: count }, (_, i) => addDaysKey(start, i)).filter((k) =>
      showWeekend ? true : weekdayOfKey(k) < 5,
    );
  }, [selectedKey, showWeekend]);

  // 课程图例：本视图内出现的课程名 → 颜色（去重）
  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events) {
      if (e.all_day || seen.has(e.title)) continue;
      seen.set(e.title, eventTint(e, subColors));
    }
    return [...seen.entries()];
  }, [events, subColors]);

  const now = useNow();
  const today = localDayKey(now);
  // 今天「下一节课」（用于地点高亮）
  const nextEv = useMemo(() => pickNextEvent(events, now, today), [events, now, today]);
  // 网格实测宽度（px）：供事件块按实际宽度分档缩字号
  const [bodyRef, bodyW] = useElementWidth<HTMLDivElement>();
  const colWpx = bodyW > 0 ? Math.max(0, bodyW - 40) / days.length : 0;
  // 图例默认收起；展开才显示课程色块
  const [legendOpen, setLegendOpen] = useState(false);
  const { start: sH, end: eH } = useMemo(() => fitWindow(events), [events]);
  const spanH = eH - sH;
  const nowPos = ((new Date(now).getHours() * 60 + new Date(now).getMinutes() - sH * 60) / 60) * HOUR_HEIGHT;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nowPosRef = useRef(nowPos);
  nowPosRef.current = nowPos;
  useEffect(() => {
    if (nowFocus <= 0) return;
    const c = scrollRef.current;
    if (c) c.scrollTo({ top: Math.max(0, nowPosRef.current - c.clientHeight / 2) });
  }, [nowFocus]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 视图内工具条：列数切换 + 轴范围（对齐参照项目的「7 列 / 08:00 – 21:00」） */}
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <button
          onClick={() => onToggleWeekend(!showWeekend)}
          title={showWeekend ? "只显示周一到周五" : "连周末一起显示"}
          className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/25"
        >
          {showWeekend ? "7 列" : "5 列"}
        </button>
        <span className="text-[10px] text-muted-foreground">
          {showWeekend ? "含周末" : "工作日"}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {String(sH).padStart(2, "0")}:00 – {String(eH).padStart(2, "0")}:00
        </span>
      </div>
      {/* 课程图例：可收起，默认收起；点开可点击只看某一门课（再点一次清除） */}
      {legend.length > 0 && (
        <div className="shrink-0 border-b">
          <button
            onClick={() => setLegendOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent"
            title="课程图例"
          >
            <span className="size-2 rounded-full bg-primary/50" />
            <span>课程图例 · {legend.length}</span>
            <ChevronDown className={cn("size-3 transition-transform", legendOpen && "rotate-180")} />
            {focusTitle && (
              <span className="ml-auto truncate text-primary">只看「{focusTitle}」</span>
            )}
          </button>
          {legendOpen && (
            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5 pt-0.5">
              {legend.slice(0, 14).map(([title, color]) => {
                const active = focusTitle === title;
                return (
                  <button
                    key={title}
                    onClick={() => onFocusTitle(active ? null : title)}
                    className={cn(
                      "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors",
                      active
                        ? "border-foreground/60 bg-accent text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                    title={`只看「${title}」`}
                  >
                    <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className="max-w-16 truncate">{title}</span>
                  </button>
                );
              })}
              {focusTitle && (
                <button
                  onClick={() => onFocusTitle(null)}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  清除
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {/* 列头：第一行 MM/DD 日期（浅灰小字），第二行 星期（主文字），今天用主色 + 小横杠标记
          今天那一列不画底边线 → 与下方网格的今日列连成一根贯通高亮 */}
      <div className="flex shrink-0">
        <div className="w-10 shrink-0 border-b" />
        {days.map((k) => {
          const d = k % 100;
          const mth = Math.floor((k % 10000) / 100);
          const dateStr = `${String(mth).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
          const isToday = k === today;
          return (
            <button
              key={k}
              onClick={() => onSelectDay(k)}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-1.5",
                isToday ? "bg-muted/40" : "border-b hover:bg-accent",
              )}
            >
              <span className={cn("text-[10px] tabular-nums", isToday ? "font-semibold text-primary" : "text-muted-foreground")}>
                {dateStr}
              </span>
              <span
                className={cn(
                  "text-[11px] font-semibold",
                  isToday
                    ? "text-primary"
                    : weekdayOfKey(k) >= 5
                      ? "text-muted-foreground"
                      : "text-foreground",
                )}
              >
                周{["一", "二", "三", "四", "五", "六", "日"][weekdayOfKey(k)]}
              </span>
              <span className={cn("h-0.5 w-4 rounded-full", isToday ? "bg-primary" : "bg-transparent")} />
            </button>
          );
        })}
      </div>
      {/* 全天条带（今天列同样不画底边线，保持高亮贯通） */}
      <div className="flex shrink-0 bg-muted/20">
        <div className="flex w-10 shrink-0 items-center border-b px-1 text-[9px] text-muted-foreground">全天</div>
        {days.map((k) => (
          <div key={k} className={cn("flex flex-1 flex-col gap-px px-0.5 py-1", k === today ? "bg-muted/40" : "border-b")}>
            {allDayOfDay(events, k).map((e) => {
            const tint = eventTint(e, subColors);
            const pill = tint ? tintedPill(tint) : undefined;
            return (
              <div
                key={e.id}
                className={cn(
                  "flex min-w-0 items-center gap-1 truncate rounded-full border px-1.5 py-0.5 text-[10px] font-medium shadow-sm",
                  focusTitle != null && e.title !== focusTitle && "opacity-40 saturate-[0.6]",
                )}
                style={pill ? { ...pill, borderColor: tintedBorder(tint) } : undefined}
                title={e.title}
                onClick={() => onEventClick(e)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  onEventMenu(e, ev.clientX, ev.clientY);
                }}
              >
                <span className="size-1 flex-none rounded-full" style={{ backgroundColor: tint ?? "var(--primary)" }} />
                <span className="truncate">{e.title}</span>
              </div>
            );
          })}
          </div>
        ))}
      </div>
      {/* 时间轴主体 */}
      <div
        className="relative flex flex-1 overflow-y-auto"
        ref={(el) => {
          scrollRef.current = el;
          bodyRef.current = el;
        }}
      >
        <HourAxis
          startHour={sH}
          endHour={eH}
          nowPos={days.includes(today) && nowPos >= 0 && nowPos <= spanH * HOUR_HEIGHT ? nowPos : undefined}
          nowLabel={nowTime(now)}
        />
        {days.map((k) => {
          const blocks = layoutDay(
            timedOfDay(events, k).map((e) => ({ start_ms: e.start_ms, end_ms: e.end_ms, all_day: false })),
            { startHour: sH, endHour: eH, hourHeight: HOUR_HEIGHT },
          );
          return (
            <div
              key={k}
              className={cn(
                "relative flex-1 border-l",
                // 今日列：中性灰底 + 一条灰右边缘（不带色相，避免与同色系卡片糊在一起）
                k === today && "border-r border-border/70 bg-muted/40",
              )}
              style={{ height: spanH * HOUR_HEIGHT }}
              onClick={() => onSelectDay(k)}
              onDoubleClick={(e) => {
                const s = timeFromPointerY(e.currentTarget, e.clientY, sH, eH);
                if (s != null) onCreateAt?.(dayStartMs(k) + s * 3_600_000);
              }}
            >
              <TimelineGrid startHour={sH} endHour={eH} />
              {blocks.map((b) => {
                const ev = timedOfDay(events, k)[b.index];
                // 周视图只在「今天」这一列做状态表达（进度 + 已结束变灰）；翻到别的日子保持课程色，避免整屏灰
                const vis = eventStatusOf(ev, now, k);
                return (
                  <EventBlock
                    key={ev.id}
                    event={ev}
                    top={b.top}
                    height={b.height}
                    left={b.left}
                    width={b.width}
                    subColors={subColors}
                    dimmed={focusTitle != null && ev.title !== focusTitle}
                    status={k === today ? vis.status : undefined}
                    pct={k === today ? vis.pct : 0}
                    badge={false}
                    isNext={nextEv != null && ev.id === nextEv.id && localDayKey(ev.start_ms) === k}
                    tier={blockTier((colWpx * b.width) / 100, b.height)}
                    noteDot={!!ev.notes}
                    onClick={onEventClick}
                    onMenu={onEventMenu}
                  />
                );
              })}
              {k === today && nowPos >= 0 && nowPos <= spanH * HOUR_HEIGHT && (
                <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowPos }}>
                  <div className="h-[1.5px] bg-red-500" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function nowTime(now: number): string {
  const d = new Date(now);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 日视图：单列时间轴 + 当日待办 */
export function DayView({
  events,
  todos,
  dayKey,
  subColors,
  nowFocus,
  focusTitle,
  onEventClick,
  onEventMenu,
  onToggleTodo,
  onTodoMenu,
  onAddEvent,
  onAddTodo,
  onCreateAt,
}: {
  events: EventDto[];
  todos: TodoDto[];
  dayKey: number;
  subColors: SubColors;
  nowFocus: number;
  focusTitle: string | null;
  onEventClick: EventClick;
  onEventMenu: EventMenu;
  onToggleTodo: TodoToggle;
  onTodoMenu: TodoMenu;
  onAddEvent: () => void;
  onAddTodo: () => void;
  onCreateAt?: (startMs: number) => void;
}) {
  const allDay = allDayOfDay(events, dayKey);
  const timed = timedOfDay(events, dayKey);
  const dayTodos = todos.filter((t) => t.due_date === dayKey);
  const now = useNow();
  const today = localDayKey(now);
  const isToday = dayKey === today;
  // 今天「下一节课」（仅当天为今天时才高亮）
  const nextEv = useMemo(() => pickNextEvent(events, now, today), [events, now, today]);
  const { start: sH, end: eH } = useMemo(() => fitWindow(timed), [timed]);
  const spanH = eH - sH;
  const nowPos = ((new Date(now).getHours() * 60 + new Date(now).getMinutes() - sH * 60) / 60) * HOUR_HEIGHT;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nowPosRef = useRef(nowPos);
  nowPosRef.current = nowPos;
  useEffect(() => {
    if (nowFocus <= 0) return;
    const c = scrollRef.current;
    if (c) c.scrollTo({ top: Math.max(0, nowPosRef.current - c.clientHeight / 2) });
  }, [nowFocus]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5">
        <h3 className={cn("text-sm font-semibold", isToday && "text-primary")}>
          {fmtKeyLong(dayKey)}
          {isToday && " · 今天"}
        </h3>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={onAddEvent}>
            <CalendarPlus className="size-3.5" />
            事件
          </Button>
          <Button variant="outline" size="sm" onClick={onAddTodo}>
            <ListTodo className="size-3.5" />
            待办
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3" ref={scrollRef}>
        {/* 全天事件 */}
        {allDay.length > 0 && (
          <div className="mb-2 space-y-1">
            {allDay.map((e) => {
              const tint = eventTint(e, subColors);
              const pill = tint ? tintedPill(tint) : undefined;
              return (
                <div
                  key={e.id}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium shadow-sm",
                    focusTitle != null && e.title !== focusTitle && "opacity-40 saturate-[0.6]",
                  )}
                  style={pill ? { ...pill, borderColor: tintedBorder(tint) } : undefined}
                  onClick={() => onEventClick(e)}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    onEventMenu(e, ev.clientX, ev.clientY);
                  }}
                >
                  <span className="size-1.5 flex-none rounded-full" style={{ backgroundColor: tint ?? "var(--primary)" }} />
                  <span className="truncate">{e.title}</span>
                  {e.location && (
                    <span className="ml-auto flex min-w-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                      <MapPin className="size-3 flex-none" />
                      <span className="truncate">{e.location}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {/* 时间轴 */}
        <div
          className="relative ml-10"
          style={{ height: spanH * HOUR_HEIGHT }}
          onDoubleClick={(e) => {
            const s = timeFromPointerY(e.currentTarget, e.clientY, sH, eH);
            if (s != null) onCreateAt?.(dayStartMs(dayKey) + s * 3_600_000);
          }}
        >
          <div className="absolute inset-y-0 -left-10 w-9 border-r" />
          <div className="absolute inset-x-0" style={{ height: spanH * HOUR_HEIGHT }}>
            {Array.from({ length: spanH + 1 }, (_, i) => i).map((i) => (
              <div key={i} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_HEIGHT }}>
                <span className="absolute -top-2 -left-10 w-9 text-right text-[10px] text-muted-foreground">
                  {String(sH + i).padStart(2, "0")}:00
                </span>
              </div>
            ))}
            {timed.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                点击时间轴任意处即可添加事件
              </div>
            )}
            {layoutDay(
              timed.map((e) => ({ start_ms: e.start_ms, end_ms: e.end_ms, all_day: false })),
              { startHour: sH, endHour: eH, hourHeight: HOUR_HEIGHT },
            ).map((b) => {
              const ev = timed[b.index];
              const vis = eventStatusOf(ev, now, dayKey);
              return (
                <EventBlock
                  key={ev.id}
                  event={ev}
                  top={b.top}
                  height={b.height}
                  left={b.left}
                  width={b.width}
                  subColors={subColors}
                  dimmed={focusTitle != null && ev.title !== focusTitle}
                  status={vis.status}
                  pct={vis.pct}
                  badge={isToday}
                  isNext={isToday && nextEv != null && ev.id === nextEv.id}
                  noteDot={!!ev.notes}
                  onClick={onEventClick}
                  onMenu={onEventMenu}
                />
              );
            })}
            {isToday && nowPos >= 0 && nowPos <= spanH * HOUR_HEIGHT && (
              <div className="absolute inset-x-0 z-10" style={{ top: nowPos }}>
                <div className="h-px bg-red-500" />
                <span className="absolute -top-2 -right-0 rounded bg-red-500 px-1 text-[9px] text-white">{nowTime(now)}</span>
              </div>
            )}
          </div>
        </div>

        {/* 当日待办 */}
        <div className="mt-3 rounded-lg border p-2">
          <div className="mb-1 text-[11px] text-muted-foreground">当日待办 · {dayTodos.length}</div>
          {dayTodos.length === 0 ? (
            <div className="py-2 text-center text-xs text-muted-foreground">没有待办</div>
          ) : (
            dayTodos.map((t) => <TodoRow key={t.id} todo={t} onToggle={onToggleTodo} onMenu={onTodoMenu} />)
          )}
        </div>
      </div>
    </div>
  );
}

/** 「现在 HH:mm」标线：主色圆点 + 左实右淡的渐变线 + 右侧时间（插在今天最后一条已结束的卡片之后） */
function NowLine({ now }: { now: number }) {
  return (
    <div className="flex items-center gap-2 pl-0.5">
      <span
        className="size-2 flex-none rounded-full bg-primary"
        style={{ boxShadow: "0 0 0 3px color-mix(in srgb, var(--primary) 16%, transparent)" }}
      />
      <span className="h-[1.5px] flex-1 bg-gradient-to-r from-primary/85 to-primary/10" />
      <span className="flex-none text-[10px] font-bold tabular-nums text-primary">现在 {nowTime(now)}</span>
    </div>
  );
}

/**
 * 时间线卡片（对齐参照项目的时间线页）：
 * 最左时间列（开始胶囊 → 虚线 → 结束胶囊，全天只一个胶囊）+ 事件色竖条 + 内容列。
 * 底色是「事件色混主题卡底」的柔和底，文字走主题前景色，因此深浅主题都成立。
 */
function TlCard({
  event,
  vis,
  subColors,
  isNext,
  onClick,
  onMenu,
}: {
  event: EventDto;
  vis: EventVisual;
  subColors: SubColors;
  isNext: boolean;
  onClick: EventClick;
  onMenu: EventMenu;
}) {
  const past = vis.status === "past";
  const tint = eventTint(event, subColors);
  const strip = tintedStrip(tint, past);
  const pill = tint
    ? tintedPill(tint)
    : { background: "var(--muted)", color: "var(--muted-foreground)" };
  const ongoing = vis.status === "ongoing";
  return (
    <div
      className={cn(
        "relative flex min-h-[52px] cursor-pointer items-stretch rounded-xl border py-2 pl-[62px] pr-2.5 shadow-sm transition-shadow hover:shadow-md",
      )}
      style={{
        background: ongoing && tint ? tintedProgress(tint, vis.pct) : tintedSurface(tint, { past }),
        borderColor: tintedBorder(tint, past),
      }}
      onClick={() => onClick(event)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(event, e.clientX, e.clientY);
      }}
    >
      {/* 事件色竖条：卡片身份的唯一载体，已结束时去色 */}
      <span
        className="absolute bottom-1.5 left-[52px] top-1.5 w-[3px] rounded-full"
        style={{ backgroundColor: strip }}
      />
      {/* 最左时间列 */}
      <div className="absolute left-1.5 top-1/2 flex w-[46px] -translate-y-1/2 flex-col items-start">
        {event.all_day ? (
          <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold leading-tight text-muted-foreground">
            全天
          </span>
        ) : (
          <>
            <span
              className="rounded-full px-1.5 py-px text-[10px] font-semibold leading-tight tabular-nums"
              style={{ background: past ? "var(--muted)" : pill.background, color: past ? "var(--muted-foreground)" : pill.color }}
            >
              {fmtHM(event.start_ms)}
            </span>
            <span className="my-0.5 ml-3 h-2 border-l border-dashed border-border" />
            <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold leading-tight tabular-nums text-muted-foreground">
              {fmtHM(event.end_ms)}
            </span>
          </>
        )}
      </div>
      {/* 内容列 */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className={cn("truncate text-[13px] font-semibold", past ? "text-muted-foreground" : "text-foreground")}>
            {event.title}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {ongoing && (
              <span className="rounded-full bg-primary/20 px-1.5 py-px text-[10px] font-semibold leading-tight text-primary">
                进行中
              </span>
            )}
            {past && (
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold leading-tight text-muted-foreground">
                已结束
              </span>
            )}
            {event.subscription_id != null && (
              <span className="rounded-full bg-violet-500/15 px-1.5 py-px text-[10px] font-semibold leading-tight text-violet-700 dark:text-violet-300">
                订阅
              </span>
            )}
          </div>
        </div>
        {(event.location || event.notes || event.rrule) && (
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
            {event.location && (
              <span className={cn("flex min-w-0 items-center gap-0.5", isNext && "font-semibold text-primary")}>
                <MapPin className="size-3 flex-none" />
                <span className="truncate">{event.location}</span>
              </span>
            )}
            {event.location && event.notes && <span className="flex-none opacity-50">·</span>}
            {event.notes && (
              <span className="flex min-w-0 flex-1 items-center gap-0.5">
                <StickyNote className="size-3 flex-none" />
                <span className="truncate">{event.notes}</span>
              </span>
            )}
            {event.rrule && (
              <span className="ml-auto flex flex-none items-center gap-0.5">
                <Repeat className="size-3" />
                重复
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 时间线视图：按天分组的事件卡片流（对齐参照项目的时间线页）。
 * 不做时间比例轴——卡片高度由内容决定，比的是「一眼看清这一天有什么」；
 * 跳过空闲只影响「没有事件的日子要不要露出来」，今天永远保留。
 */
export function TimeLineView({
  events,
  subColors,
  loadedStart,
  loadedEnd,
  loading,
  hideEmpty,
  nowFocus,
  onHideEmptyChange,
  onLoadEdge,
  onEventClick,
  onEventMenu,
  onCreateAt,
}: {
  events: EventDto[];
  subColors: SubColors;
  loadedStart: number;
  loadedEnd: number;
  loading: boolean;
  hideEmpty: boolean;
  nowFocus: number;
  onHideEmptyChange: (v: boolean) => void;
  onLoadEdge: (dir: "up" | "down") => void;
  onEventClick: EventClick;
  onEventMenu: EventMenu;
  onCreateAt?: (startMs: number) => void;
}) {
  const now = useNow();
  const today = localDayKey(now);
  // 今天「下一节课」（仅今天的分时事件参与；用于地点高亮）
  const nextEv = useMemo(() => pickNextEvent(events, now, today), [events, now, today]);
  const days = useMemo(
    () => groupTimelineDays(events, { startMs: loadedStart, endMs: loadedEnd, hideEmpty, todayKey: today }),
    [events, loadedStart, loadedEnd, hideEmpty, today],
  );
  const totalCards = useMemo(
    () => days.reduce((n, d) => n + d.allDay.length + d.timed.length, 0),
    [days],
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadBusy = useRef(false);
  const centeredRef = useRef(false);

  // 数据就绪后首次定位到「今天」所在处
  useEffect(() => {
    if (centeredRef.current) return;
    const c = scrollRef.current;
    if (!c) return;
    const el = c.querySelector<HTMLElement>(`[data-daykey="${today}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    centeredRef.current = true;
  }, [days, today]);

  // 点「今天」按钮：重新定位到当前时刻所在的那一天
  useEffect(() => {
    if (nowFocus <= 0) return;
    const c = scrollRef.current;
    if (!c) return;
    const el = c.querySelector<HTMLElement>(`[data-daykey="${today}"]`);
    if (el) el.scrollIntoView({ block: "center" });
  }, [nowFocus, today]);

  const onScroll = () => {
    const c = scrollRef.current;
    if (!c) return;
    if (loadBusy.current) return;
    if (c.scrollTop < 240) {
      loadBusy.current = true;
      onLoadEdge("up");
      window.setTimeout(() => (loadBusy.current = false), 500);
    } else if (c.scrollTop + c.clientHeight > c.scrollHeight - 240) {
      loadBusy.current = true;
      onLoadEdge("down");
      window.setTimeout(() => (loadBusy.current = false), 500);
    }
  };

  // 内容不足一屏时自动向下填充，保证可继续滚动（历史/未来）
  useEffect(() => {
    const c = scrollRef.current;
    if (c && c.scrollHeight <= c.clientHeight + 40 && !loading) onLoadEdge("down");
  }, [days, loading, onLoadEdge]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <button
          onClick={() => onHideEmptyChange(!hideEmpty)}
          title={hideEmpty ? "把没有安排的日子也显示出来" : "只显示有安排的日子"}
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors",
            hideEmpty ? "bg-primary/15 text-primary hover:bg-primary/25" : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {hideEmpty ? "跳过空闲" : "显示全部"}
        </button>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {days.length} 天 · {totalCards} 条安排
        </span>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
        {days.map((d) => {
          const isToday = d.dayKey === today;
          const weekend = weekdayOfKey(d.dayKey) >= 5;
          const m = Math.floor((d.dayKey % 10000) / 100);
          const dd = d.dayKey % 100;
          const items: { e: EventDto; vis: EventVisual }[] = [
            ...d.allDay.map((e) => ({ e, vis: eventStatusOf(e, now, d.dayKey) })),
            ...d.timed.map((e) => ({ e, vis: eventStatusOf(e, now, d.dayKey) })),
          ];
          // 「现在」标线插在今天最后一条已结束的卡片之后；今天没有卡片则不显示
          const nowIdx = isToday && items.length > 0 ? items.filter((it) => it.vis.status === "past").length : -1;
          return (
            <section key={d.dayKey} data-daykey={d.dayKey} className="border-b border-border/50 last:border-b-0">
              {/* 日期头：日期（粗）→ 星期（灰）→「今天」胶囊；右侧条数 + 新建 */}
              <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border/50 bg-background/95 px-3 py-1.5 backdrop-blur">
                <span
                  className={cn(
                    "text-sm font-bold",
                    isToday ? "text-primary" : weekend ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {m}月{dd}日
                </span>
                <span className="text-[11px] text-muted-foreground">
                  周{["一", "二", "三", "四", "五", "六", "日"][weekdayOfKey(d.dayKey)]}
                </span>
                {isToday && (
                  <span className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-semibold leading-tight text-primary">
                    今天
                  </span>
                )}
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                  {items.length > 0 ? `${items.length} 项` : ""}
                </span>
                <button
                  title="在这天新建事件"
                  onClick={() => onCreateAt?.(dayStartMs(d.dayKey) + 9 * 3_600_000)}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <div className="flex flex-col gap-1.5 px-3 py-2">
                {items.length === 0 ? (
                  <div className="rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
                    这天没有安排
                  </div>
                ) : (
                  <>
                    {items.map((it, i) => (
                      <Fragment key={`${it.e.id}-${it.e.instance_date ?? it.e.start_ms}`}>
                        {i === nowIdx && <NowLine now={now} />}
                        <TlCard
                          event={it.e}
                          vis={it.vis}
                          subColors={subColors}
                          isNext={isToday && nextEv != null && it.e.id === nextEv.id}
                          onClick={onEventClick}
                          onMenu={onEventMenu}
                        />
                      </Fragment>
                    ))}
                    {nowIdx === items.length && <NowLine now={now} />}
                  </>
                )}
              </div>
            </section>
          );
        })}
        {loading && (
          <div className="pointer-events-none sticky bottom-2 z-20 flex justify-center">
            <span className="rounded bg-popover px-2 py-0.5 text-[10px] text-muted-foreground shadow">加载中…</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TodoRow({ todo, onToggle, onMenu }: { todo: TodoDto; onToggle: TodoToggle; onMenu: TodoMenu }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(todo, e.clientX, e.clientY);
      }}
    >
      <button
        onClick={() => onToggle(todo)}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          todo.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/50",
        )}
      >
        {todo.done && <span className="text-[10px]">✓</span>}
      </button>
      <span className={cn("min-w-0 flex-1 truncate text-sm", todo.done && "text-muted-foreground line-through")}>
        {todo.title}
      </span>
    </div>
  );
}

/** 待办清单页：未完成（含逾期醒目）/ 长期 / 已完成（可折叠） */
export function TodoView({
  todos,
  onToggle,
  onMenu,
  onAdd,
}: {
  todos: TodoDto[];
  onToggle: TodoToggle;
  onMenu: TodoMenu;
  onAdd: () => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const today = todayKey();
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const overdue = open.filter((t) => t.due_date != null && t.due_date < today).sort((a, b) => (a.due_date ?? 0) - (b.due_date ?? 0));
  const upcoming = open
    .filter((t) => t.due_date != null && t.due_date >= today)
    .sort((a, b) => (a.due_date ?? 0) - (b.due_date ?? 0));
  const longTerm = open.filter((t) => t.due_date == null);

  const section = (title: string, items: TodoDto[], cls?: string) =>
    items.length > 0 && (
      <div className="mb-1">
        <div className="mb-0.5 text-[11px] text-muted-foreground">
          {title} · {items.length}
        </div>
        {items.map((t) => (
          <div key={t.id} className={cn(cls)}>
            <TodoRow todo={t} onToggle={onToggle} onMenu={onMenu} />
          </div>
        ))}
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-1.5">
        <span className="text-sm font-semibold">待办清单</span>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <ListTodo className="size-3.5" />
          新建待办
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {open.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
            全部完成，干得漂亮 🎉
          </div>
        ) : (
          <>
            {section("已逾期", overdue, "text-red-500")}
            {section("未完成", upcoming)}
            {section("长期待办", longTerm)}
          </>
        )}
        {done.length > 0 && (
          <div className="mt-2">
            <button onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {showDone ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              已完成 · {done.length}
            </button>
            {showDone &&
              done
                .sort((a, b) => (b.done_at_ms ?? 0) - (a.done_at_ms ?? 0))
                .map((t) => (
                  <div key={t.id} className="opacity-60">
                    <TodoRow todo={t} onToggle={onToggle} onMenu={onMenu} />
                  </div>
                ))}
          </div>
        )}
      </div>
    </div>
  );
}
