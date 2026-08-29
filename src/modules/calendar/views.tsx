// 周 / 日 / 待办 三个视图（月视图留在 Page）。
// 时间轴布局复用 utils.layoutDay 纯函数（重叠分列、窗口钳制），全部数据来自父组件。

import { useMemo, useState } from "react";
import { CalendarPlus, ChevronDown, ChevronRight, Clock, ListTodo, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fmtHM, fmtKeyLong, addDaysKey, layoutDay, localDayKey, todayKey, weekStartKey, weekdayOfKey } from "./utils";
import type { EventDto, TodoDto } from "./types";

const START_HOUR = 0; // 时间轴起点（0 点）
const END_HOUR = 24;
const HOUR_HEIGHT = 46;
const HOURS = END_HOUR - START_HOUR;

type EventClick = (e: EventDto) => void;
type EventMenu = (e: EventDto, x: number, y: number) => void;
type TodoToggle = (t: TodoDto) => void;
type TodoMenu = (t: TodoDto, x: number, y: number) => void;
/** 订阅 id → 颜色（只读着色用） */
export type SubColors = Record<number, string>;

function allDayOfDay(events: EventDto[], dayKey: number): EventDto[] {
  return events.filter((e) => e.all_day && localDayKey(e.start_ms) === dayKey);
}
function timedOfDay(events: EventDto[], dayKey: number): EventDto[] {
  return events.filter((e) => !e.all_day && localDayKey(e.start_ms) === dayKey);
}

/** 时间轴背景：小时刻度线 */
function TimelineGrid() {
  return (
    <>
      {Array.from({ length: HOURS + 1 }, (_, i) => i).map((i) => (
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
  const subColor =
    event.subscription_id != null ? subColors[event.subscription_id] : undefined;
  return (
    <div
      className="absolute overflow-hidden rounded-md border border-primary/15 border-l-2 border-l-primary bg-primary/10 px-1.5 py-1 shadow-sm ring-1 ring-primary/5 transition-colors hover:bg-primary/20 hover:ring-primary/25"
      style={{
        top: top + 1,
        height: height - 2,
        left: `${left}%`,
        width: `${width}%`,
        ...(subColor ? { borderLeftColor: subColor } : {}),
      }}
      title={`${fmtHM(event.start_ms)}–${fmtHM(event.end_ms)} ${event.title}${event.subscription_id != null ? " · 订阅" : ""}${event.location ? " · " + event.location : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(event, e.clientX, e.clientY);
      }}
    >
      <div className="truncate text-[11px] font-semibold leading-tight text-foreground">{event.title}</div>
      {!compact && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] leading-none text-muted-foreground">
          <Clock className="size-2.5" />
          <span className="truncate">
            {fmtHM(event.start_ms)}–{fmtHM(event.end_ms)}
          </span>
        </div>
      )}
      {!compact && event.location && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] leading-none text-muted-foreground">
          <MapPin className="size-2.5" />
          <span className="truncate">{event.location}</span>
        </div>
      )}
      {height > 8 && height < 34 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0.5 text-center text-[9px] text-muted-foreground/70">
          {fmtHM(event.start_ms)}
        </div>
      )}
    </div>
  );
}

/** 左侧 0–24 小时刻度列 */
function HourAxis() {
  return (
    <div className="relative w-10 shrink-0" style={{ height: HOURS * HOUR_HEIGHT }}>
      {Array.from({ length: HOURS + 1 }, (_, i) => i).map((i) => (
        <span
          key={i}
          className="absolute -top-1.5 right-1.5 text-[10px] tabular-nums text-muted-foreground"
          style={{ top: i * HOUR_HEIGHT }}
        >
          {i}:00
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
  onSelectDay,
  onEventClick,
  onEventMenu,
}: {
  events: EventDto[];
  selectedKey: number;
  showWeekend: boolean;
  subColors: SubColors;
  onSelectDay: (k: number) => void;
  onEventClick: EventClick;
  onEventMenu: EventMenu;
}) {
  const days = useMemo(() => {
    const start = weekStartKey(selectedKey);
    const count = showWeekend ? 7 : 5;
    return Array.from({ length: count }, (_, i) => addDaysKey(start, i)).filter((k) =>
      showWeekend ? true : weekdayOfKey(k) < 5,
    );
  }, [selectedKey, showWeekend]);

  const today = todayKey();
  const nowPos = useMemo(() => {
    const d = new Date();
    return ((d.getHours() * 60 + d.getMinutes() - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 列头 */}
      <div className="flex shrink-0 border-b">
        <div className="w-10 shrink-0" />
        {days.map((k) => (
          <button
            key={k}
            onClick={() => onSelectDay(k)}
            className={cn(
              "flex flex-1 flex-col items-center py-1.5",
              k === today ? "rounded-t-md bg-primary/10" : "hover:bg-accent",
            )}
          >
            <span className="text-[10px] text-muted-foreground">周{["一", "二", "三", "四", "五", "六", "日"][weekdayOfKey(k)]}</span>
            <span
              className={cn(
                "mt-0.5 flex size-5 items-center justify-center rounded-full text-[11px]",
                k === today ? "bg-primary font-semibold text-primary-foreground" : "text-foreground",
              )}
            >
              {k % 100}
            </span>
          </button>
        ))}
      </div>
      {/* 全天条带 */}
      <div className="flex shrink-0 border-b bg-muted/30">
        <div className="flex w-10 shrink-0 items-center px-1 text-[9px] text-muted-foreground">全天</div>
        {days.map((k) => (
          <div key={k} className="flex flex-1 flex-col gap-px px-0.5 py-1">
            {allDayOfDay(events, k).map((e) => (
              <div
                key={e.id}
                className="truncate rounded bg-primary/25 px-1 text-[10px] text-primary"
                title={e.title}
                onClick={() => onEventClick(e)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  onEventMenu(e, ev.clientX, ev.clientY);
                }}
              >
                {e.title}
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* 时间轴主体 */}
      <div className="relative flex flex-1 overflow-y-auto">
        <HourAxis />
        {days.map((k) => {
          const blocks = layoutDay(
            timedOfDay(events, k).map((e) => ({ start_ms: e.start_ms, end_ms: e.end_ms, all_day: false })),
            { startHour: START_HOUR, endHour: END_HOUR, hourHeight: HOUR_HEIGHT },
          );
          return (
            <div
              key={k}
              className={cn("relative flex-1 border-l", k === today && "bg-primary/[0.03]")}
              style={{ height: HOURS * HOUR_HEIGHT }}
              onClick={() => onSelectDay(k)}
            >
              <TimelineGrid />
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
              {k === today && nowPos >= 0 && nowPos <= HOURS * HOUR_HEIGHT && (
                <div className="absolute inset-x-0 z-10" style={{ top: nowPos }}>
                  <div className="h-px bg-red-500" />
                  <span className="absolute -top-2 -right-0 rounded bg-red-500 px-1 text-[9px] text-white">
                    {nowTime()}
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

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 日视图：单列时间轴 + 当日待办 */
export function DayView({
  events,
  todos,
  dayKey,
  subColors,
  onEventClick,
  onEventMenu,
  onToggleTodo,
  onTodoMenu,
  onAddEvent,
  onAddTodo,
}: {
  events: EventDto[];
  todos: TodoDto[];
  dayKey: number;
  subColors: SubColors;
  onEventClick: EventClick;
  onEventMenu: EventMenu;
  onToggleTodo: TodoToggle;
  onTodoMenu: TodoMenu;
  onAddEvent: () => void;
  onAddTodo: () => void;
}) {
  const allDay = allDayOfDay(events, dayKey);
  const timed = timedOfDay(events, dayKey);
  const dayTodos = todos.filter((t) => t.due_date === dayKey);
  const today = todayKey();
  const isToday = dayKey === today;
  const nowPos = useMemo(() => {
    const d = new Date();
    return ((d.getHours() * 60 + d.getMinutes() - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  }, []);

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

      <div className="flex-1 overflow-y-auto p-3">
        {/* 全天事件 */}
        {allDay.length > 0 && (
          <div className="mb-2 space-y-1">
            {allDay.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 rounded-md bg-primary/15 px-2 py-1 text-xs text-primary"
                onClick={() => onEventClick(e)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  onEventMenu(e, ev.clientX, ev.clientY);
                }}
              >
                <span className="rounded bg-primary/25 px-1 text-[10px]">全天</span>
                <span className="truncate">{e.title}</span>
                {e.location && <span className="ml-auto truncate text-[10px] opacity-70">📍 {e.location}</span>}
              </div>
            ))}
          </div>
        )}
        {/* 时间轴 */}
        <div className="relative ml-10" style={{ height: HOURS * HOUR_HEIGHT }}>
          <div className="absolute inset-y-0 -left-10 w-9 border-r" />
          <div className="absolute inset-x-0" style={{ height: HOURS * HOUR_HEIGHT }}>
            {Array.from({ length: HOURS + 1 }, (_, i) => i).map((i) => (
              <div key={i} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_HEIGHT }}>
                <span className="absolute -top-2 -left-10 w-9 text-right text-[10px] text-muted-foreground">
                  {String(i).padStart(2, "0")}:00
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
              { startHour: START_HOUR, endHour: END_HOUR, hourHeight: HOUR_HEIGHT },
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
            {isToday && nowPos >= 0 && nowPos <= HOURS * HOUR_HEIGHT && (
              <div className="absolute inset-x-0 z-10" style={{ top: nowPos }}>
                <div className="h-px bg-red-500" />
                <span className="absolute -top-2 -right-0 rounded bg-red-500 px-1 text-[9px] text-white">{nowTime()}</span>
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