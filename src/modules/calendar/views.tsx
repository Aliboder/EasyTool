// 周 / 日 / 待办 三个视图（月视图留在 Page）。
// 时间轴布局复用 utils.layoutDay 纯函数（重叠分列、窗口钳制），全部数据来自父组件。

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, ChevronDown, ChevronRight, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fmtHM, fmtKeyLong, addDaysKey, layoutDay, localDayKey, todayKey, weekStartKey, weekdayOfKey, dayStartMs } from "./utils";
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

/** 双击时间轴空白处 → 由视口位置换算为 30 分钟对齐的开始小时 */
function timeFromPointerY(el: HTMLElement, clientY: number, startHour: number, endHour: number): number | null {
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) return null;
  const hourPx = (clientY - rect.top) / HOUR_HEIGHT + startHour;
  return Math.max(startHour, Math.min(endHour - 0.5, Math.round(hourPx * 2) / 2));
}

/** 事件的有效颜色：订阅色 > 事件自定义色 > 默认（透传 undefined 走默认主题色） */
function eventTint(e: EventDto, subColors: SubColors): string | undefined {
  if (e.subscription_id != null) return subColors[e.subscription_id];
  return e.color ?? undefined;
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
  onClick,
  onMenu,
}: {
  event: EventDto;
  top: number;
  height: number;
  left: number;
  width: number;
  subColors: SubColors;
  onClick: EventClick;
  onMenu: EventMenu;
}) {
  const compact = height < 34;
  const tint = eventTint(event, subColors);
  // 空间分配：标题永远优先完整显示（不截断）；时间/地点只在卡片够高时出现；高卡片补备注填充
  const showMeta = height >= 54;
  const notesLines = height >= 110 ? 3 : height >= 80 ? 2 : 0;
  const showNotes = notesLines > 0 && !!event.notes;
  return (
    <div
      className={cn(
        "absolute overflow-hidden rounded-xl border border-black/15 bg-primary px-2 py-1.5 text-primary-foreground shadow-sm transition-all hover:z-20 hover:shadow-md",
        !tint && "hover:bg-primary/95",
      )}
      style={{
        top: top + 1,
        height: height - 2,
        left: `${left}%`,
        width: `${width}%`,
        ...(tint ? { backgroundColor: tint, color: "#ffffff" } : {}),
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22)",
      }}
      title={`${fmtHM(event.start_ms)}–${fmtHM(event.end_ms)} ${event.title}${event.subscription_id != null ? " · 订阅" : ""}${event.location ? " · " + event.location : ""}`}
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
      {/* 标题：不截断，自动换行，优先保证完整展示 */}
      <div
        className={cn(
          "break-words leading-snug",
          compact ? "text-[11px] font-semibold" : "text-xs font-semibold",
        )}
      >
        {event.title}
      </div>
      {/* 时间 + 地点（卡片够高才显示） */}
      {showMeta && (
        <div className="mt-1 flex items-center gap-1 text-[10px] leading-none text-white/90">
          <span className="size-1 flex-none rounded-full bg-white/90" />
          <span className="truncate font-medium tabular-nums">{fmtHM(event.start_ms)}–{fmtHM(event.end_ms)}</span>
          {event.location && (
            <>
              <span className="flex-none text-white/50">·</span>
              <span className="truncate opacity-90">{event.location}</span>
            </>
          )}
        </div>
      )}
      {/* 高卡片：备注填充空档 */}
      {showNotes && (
        <div
          className={cn(
            "mt-1 text-[10px] leading-snug text-white/75",
            notesLines === 3 ? "line-clamp-3" : "line-clamp-2",
          )}
        >
          {event.notes}
        </div>
      )}
    </div>
  );
}

/** 左侧小时刻度列（窗口自适应） */
function HourAxis({ startHour, endHour }: { startHour: number; endHour: number }) {
  const n = endHour - startHour;
  return (
    <div className="relative w-10 shrink-0" style={{ height: n * HOUR_HEIGHT }}>
      {Array.from({ length: n + 1 }, (_, i) => i).map((i) => (
        <span
          key={i}
          className="absolute -top-1.5 right-1.5 text-[10px] tabular-nums text-muted-foreground"
          style={{ top: i * HOUR_HEIGHT }}
        >
          {startHour + i}:00
        </span>
      ))}
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
  onSelectDay,
  onEventClick,
  onEventMenu,
  onCreateAt,
}: {
  events: EventDto[];
  selectedKey: number;
  showWeekend: boolean;
  subColors: SubColors;
  /** 点「今天」时自增：触发时间轴滚动到当前时刻 */
  nowFocus: number;
  onSelectDay: (k: number) => void;
  onEventClick: EventClick;
  onEventMenu: EventMenu;
  onCreateAt?: (startMs: number) => void;
}) {
  const days = useMemo(() => {
    const start = weekStartKey(selectedKey);
    const count = showWeekend ? 7 : 5;
    return Array.from({ length: count }, (_, i) => addDaysKey(start, i)).filter((k) =>
      showWeekend ? true : weekdayOfKey(k) < 5,
    );
  }, [selectedKey, showWeekend]);

  const now = useNow();
  const today = localDayKey(now);
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
      {/* 列头：第一行 MM/DD 日期（今天主题圆底色），第二行 星期（周一~周日） */}
      <div className="flex shrink-0 border-b">
        <div className="w-10 shrink-0" />
        {days.map((k) => {
          const d = k % 100;
          const mth = Math.floor((k % 10000) / 100);
          const dateStr = `${String(mth).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
          return (
            <button
              key={k}
              onClick={() => onSelectDay(k)}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-1.5",
                k === today ? "rounded-t-md bg-primary/10" : "hover:bg-accent",
              )}
            >
              <span
                className={cn(
                  "flex min-w-9 items-center justify-center rounded-full px-1 py-0.5 text-[11px] tabular-nums",
                  k === today ? "bg-primary font-semibold text-primary-foreground" : "text-foreground",
                )}
              >
                {dateStr}
              </span>
              <span
                className={cn("text-[10px]", k === today ? "font-medium text-primary" : "text-muted-foreground")}
              >
                周{["一", "二", "三", "四", "五", "六", "日"][weekdayOfKey(k)]}
              </span>
            </button>
          );
        })}
      </div>
      {/* 全天条带 */}
      <div className="flex shrink-0 border-b bg-muted/30">
        <div className="flex w-10 shrink-0 items-center px-1 text-[9px] text-muted-foreground">全天</div>
        {days.map((k) => (
          <div key={k} className="flex flex-1 flex-col gap-px px-0.5 py-1">
            {allDayOfDay(events, k).map((e) => {
            const tint = eventTint(e, subColors);
            return (
              <div
                key={e.id}
                className={cn(
                  "flex min-w-0 items-center gap-1 truncate rounded-full border border-black/10 bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm",
                  !tint && "hover:bg-primary/95",
                )}
                style={tint ? { backgroundColor: tint, color: "#ffffff" } : undefined}
                title={e.title}
                onClick={() => onEventClick(e)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  onEventMenu(e, ev.clientX, ev.clientY);
                }}
              >
                <span className="size-1 flex-none rounded-full bg-white/80" />
                <span className="truncate">{e.title}</span>
              </div>
            );
          })}
          </div>
        ))}
      </div>
      {/* 时间轴主体 */}
      <div className="relative flex flex-1 overflow-y-auto" ref={scrollRef}>
        <HourAxis startHour={sH} endHour={eH} />
        {days.map((k) => {
          const blocks = layoutDay(
            timedOfDay(events, k).map((e) => ({ start_ms: e.start_ms, end_ms: e.end_ms, all_day: false })),
            { startHour: sH, endHour: eH, hourHeight: HOUR_HEIGHT },
          );
          return (
            <div
              key={k}
              className={cn("relative flex-1 border-l", k === today && "bg-primary/[0.03]")}
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
                return (
                  <EventBlock
                    key={ev.id}
                    event={ev}
                    top={b.top}
                    height={b.height}
                    left={b.left}
                    width={b.width}
                    subColors={subColors}
                    onClick={onEventClick}
                    onMenu={onEventMenu}
                  />
                );
              })}
              {k === today && nowPos >= 0 && nowPos <= spanH * HOUR_HEIGHT && (
                <div className="absolute inset-x-0 z-10" style={{ top: nowPos }}>
                  <div className="h-px bg-red-500" />
                  <span className="absolute -top-2 -right-0 rounded bg-red-500 px-1 text-[9px] text-white">
                    {nowTime(now)}
                  </span>
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
              return (
                <div
                  key={e.id}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border border-black/10 bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-sm",
                    !tint && "hover:bg-primary/95",
                  )}
                  style={tint ? { backgroundColor: tint, color: "#ffffff" } : undefined}
                  onClick={() => onEventClick(e)}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    onEventMenu(e, ev.clientX, ev.clientY);
                  }}
                >
                  <span className="size-1.5 flex-none rounded-full bg-white/80" />
                  <span className="truncate">{e.title}</span>
                  {e.location && <span className="ml-auto truncate text-[10px] opacity-80">📍 {e.location}</span>}
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
                这一天没有分时事件
              </div>
            )}
            {layoutDay(
              timed.map((e) => ({ start_ms: e.start_ms, end_ms: e.end_ms, all_day: false })),
              { startHour: sH, endHour: eH, hourHeight: HOUR_HEIGHT },
            ).map((b) => {
              const ev = timed[b.index];
              return (
                <EventBlock
                  key={ev.id}
                  event={ev}
                  top={b.top}
                  height={b.height}
                  left={b.left}
                  width={b.width}
                  subColors={subColors}
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