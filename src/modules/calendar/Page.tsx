// 日程表页面（批次 1：月视图 + 当天面板 + 事件/待办表单 + 右键菜单）
// 交互参照手机日历：周一起始月格、今天高亮、选中圈出、右下语义化添加按钮

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ModuleHeader, HeaderButton } from "@/components/module-header";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ContextMenu } from "@/components/ui/context-menu";
import { ContextMenuItem } from "@/components/ui/context-menu-item";
import { ContextMenuDivider } from "@/components/ui/context-menu-divider";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import {
  dayEndMs,
  dayStartMs,
  fmtHM,
  fmtKeyLong,
  fromDateTimeInput,
  fromDateInput,
  localDayKey,
  monthGrid,
  toDateInput,
  toDateTimeInput,
  todayKey,
} from "./utils";

interface EventDto {
  id: number;
  title: string;
  location: string;
  notes: string;
  all_day: boolean;
  start_ms: number;
  end_ms: number;
  rrule: string | null;
}

interface TodoDto {
  id: number;
  title: string;
  notes: string;
  due_date: number | null;
  done: boolean;
  done_at_ms: number | null;
}

interface RangePayload {
  events: EventDto[];
  todos: TodoDto[];
}

type DrawerState =
  | { mode: "event"; editing: EventDto | null; dayKey: number }
  | { mode: "todo"; editing: TodoDto | null }
  | null;

interface MenuState {
  x: number;
  y: number;
  kind: "event" | "todo";
  id: number;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export function CalendarPage() {
  const [ym, setYm] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState<number>(() => todayKey());
  const [range, setRange] = useState<RangePayload | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRange = useCallback(async () => {
    const cells = monthGrid(ym.y, ym.m);
    const startMs = dayStartMs(cells[0].key);
    const endMs = dayEndMs(cells[cells.length - 1].key);
    try {
      const r = await invoke<RangePayload>("calendar_get_range", { startMs, endMs });
      setRange(r);
    } catch (e) {
      console.error(e);
      setRange({ events: [], todos: [] });
    }
  }, [ym]);

  useEffect(() => {
    loadRange();
  }, [loadRange]);

  // 按日聚合（批次 1 事件为单次，按其开始日的本地日键归组）
  const eventsByDay = useMemo(() => {
    const map = new Map<number, EventDto[]>();
    for (const e of range?.events ?? []) {
      const key = localDayKey(e.start_ms);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return map;
  }, [range]);

  const overdueCount = useMemo(
    () => (range?.todos ?? []).filter((t) => !t.done && t.due_date != null && t.due_date < todayKey()).length,
    [range],
  );

  const moveMonth = (delta: number) => {
    setYm(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };
  const goToday = () => {
    const n = new Date();
    setYm({ y: n.getFullYear(), m: n.getMonth() });
    setSelectedKey(todayKey());
  };

  // ---------- ICS 导入 ----------

  const importIcs = async () => {
    const sel = await open({
      title: "选择 ICS 日历文件",
      filters: [{ name: "日历文件", extensions: ["ics"] }],
      multiple: false,
    });
    if (!sel) return;
    const path = Array.isArray(sel) ? sel[0] : sel;
    try {
      const r = await invoke<{
        events: number;
        instances: number;
        repeated: number;
        skipped: number;
        unsupported: number;
      }>("calendar_import_ics", { path });
      const parts = [`新增 ${r.instances} 条`];
      if (r.repeated > 0) parts.push(`含 ${r.repeated} 门重复课程（已展开成每次）`);
      if (r.unsupported > 0) parts.push(`${r.unsupported} 条规则暂不支持，仅保留首次`);
      if (r.skipped > 0) parts.push(`跳过 ${r.skipped} 条`);
      toast(`导入完成：${parts.join("，")}`);
      loadRange();
    } catch (e) {
      toast(`导入失败：${e}`);
    }
  };

  // ---------- 增删改 ----------

  const saveEvent = async (input: {
    title: string;
    location: string;
    notes: string;
    all_day: boolean;
    start_ms: number;
    end_ms: number;
    rrule: string | null;
  }) => {
    setBusy(true);
    try {
      const editing = drawer && drawer.mode === "event" ? drawer.editing : null;
      if (editing) {
        await invoke("calendar_update_event", { id: editing.id, input });
        toast("事件已更新");
      } else {
        await invoke("calendar_create_event", { input });
        toast("事件已添加");
      }
      setDrawer(null);
      loadRange();
    } catch (e) {
      toast(`保存失败：${e}`);
    } finally {
      setBusy(false);
    }
  };

  const saveTodo = async (input: { title: string; notes: string; due_date: number | null }) => {
    setBusy(true);
    try {
      const editing = drawer && drawer.mode === "todo" ? drawer.editing : null;
      if (editing) {
        await invoke("calendar_update_todo", { id: editing.id, input });
        toast("待办已更新");
      } else {
        await invoke("calendar_create_todo", { input });
        toast("待办已添加");
      }
      setDrawer(null);
      loadRange();
    } catch (e) {
      toast(`保存失败：${e}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleTodo = async (t: TodoDto) => {
    try {
      await invoke("calendar_toggle_todo", { id: t.id, done: !t.done });
      loadRange();
    } catch (e) {
      toast(`操作失败：${e}`);
    }
  };

  const removeItem = async (kind: "event" | "todo") => {
    const m = menu;
    if (!m) return;
    if (!window.confirm(kind === "event" ? "删除这个事件？" : "删除这条待办？")) return;
    try {
      if (kind === "event") await invoke("calendar_delete_event", { id: m.id });
      else await invoke("calendar_delete_todo", { id: m.id });
      toast("已删除");
      loadRange();
    } catch (e) {
      toast(`删除失败：${e}`);
    } finally {
      setMenu(null);
    }
  };

  const cells = monthGrid(ym.y, ym.m);
  const dayEvents = eventsByDay.get(selectedKey) ?? [];
  const dayTodos = (range?.todos ?? []).filter((t) => t.due_date === selectedKey);
  const monthTodoKeys = useMemo(() => {
    const s = new Set<number>();
    for (const t of range?.todos ?? []) {
      if (!t.done && t.due_date != null) s.add(t.due_date);
    }
    return s;
  }, [range]);

  return (
    <div className="flex h-full flex-col">
      <ModuleHeader
        title="日程表"
        meta={overdueCount > 0 ? `${overdueCount} 条待办已逾期` : "本地日历 · 数据存于本机"}
        actions={
          <>
            <HeaderButton title="上一月" onClick={() => moveMonth(-1)}>
              <ChevronLeft className="size-4" />
            </HeaderButton>
            <HeaderButton title="回到今天" onClick={goToday}>
              <span className="text-xs">今天</span>
            </HeaderButton>
            <HeaderButton title="下一月" onClick={() => moveMonth(1)}>
              <ChevronRight className="size-4" />
            </HeaderButton>
            <HeaderButton title="导入 ICS 日程文件（课程表/日历）" onClick={importIcs}>
              <Upload className="size-4" />
              <span className="text-xs">导入</span>
            </HeaderButton>
          </>
        }
      />

      {/* 星期表头（周一开头） */}
      <div className="grid shrink-0 grid-cols-7 border-b px-2 py-1 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      {/* 月网格 */}
      <div className="grid shrink-0 grid-cols-7 gap-px overflow-hidden border-b bg-border px-2 py-2">
        {cells.map((cell) => {
          const evs = eventsByDay.get(cell.key) ?? [];
          const hasTodo = monthTodoKeys.has(cell.key);
          const isToday = cell.key === todayKey();
          const selected = cell.key === selectedKey;
          return (
            <button
              key={cell.key}
              onClick={() => setSelectedKey(cell.key)}
              className={cn(
                "flex min-h-[62px] cursor-pointer flex-col gap-0.5 rounded-md p-1 text-left transition-colors",
                cell.inMonth ? "bg-card" : "bg-card/40 opacity-50",
                selected && "ring-2 ring-primary/60",
                isToday && "bg-primary/10",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]",
                  isToday ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground",
                )}
              >
                {cell.dayOfMonth}
              </span>
              {evs.slice(0, 3).map((e) => (
                <span
                  key={e.id}
                  title={`${e.all_day ? "全天" : fmtHM(e.start_ms)} · ${e.title}`}
                  className={cn(
                    "truncate rounded px-1 py-px text-[10px]",
                    e.all_day ? "bg-primary/25 text-primary" : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {e.all_day ? "" : `${fmtHM(e.start_ms)} `}
                  {e.title}
                </span>
              ))}
              {evs.length > 3 && (
                <span className="px-1 text-[10px] text-muted-foreground">+{evs.length - 3}</span>
              )}
              {hasTodo && <span className="mt-auto size-1.5 self-center rounded-full bg-orange-400" title="有待办" />}
            </button>
          );
        })}
      </div>

      {/* 当天面板 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{fmtKeyLong(selectedKey)}</h3>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDrawer({ mode: "event", editing: null, dayKey: selectedKey })}
              >
                <CalendarPlus className="size-3.5" />
                事件
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDrawer({ mode: "todo", editing: null })}
              >
                <ListTodo className="size-3.5" />
                待办
              </Button>
            </div>
          </div>

          {dayEvents.length === 0 && dayTodos.length === 0 ? (
            <div className="mt-2 flex h-16 items-center justify-center text-xs text-muted-foreground">
              这一天还没有安排，点上方按钮添加
            </div>
          ) : (
            <div className="mt-2 space-y-1">
              {dayEvents.map((e) => (
                <div
                  key={`e${e.id}`}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    setMenu({ x: ev.clientX, y: ev.clientY, kind: "event", id: e.id });
                  }}
                  className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                >
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                      e.all_day ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {e.all_day ? "全天" : fmtHM(e.start_ms)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
                  {e.location && (
                    <span className="shrink-0 truncate text-[11px] text-muted-foreground">📍 {e.location}</span>
                  )}
                </div>
              ))}
              {dayTodos.map((t) => (
                <div
                  key={`t${t.id}`}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    setMenu({ x: ev.clientX, y: ev.clientY, kind: "todo", id: t.id });
                  }}
                  className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                >
                  <button
                    onClick={() => toggleTodo(t)}
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border",
                      t.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/50",
                    )}
                    title={t.done ? "标记未完成" : "标记完成"}
                  >
                    {t.done && <span className="text-[10px]">✓</span>}
                  </button>
                  <span className={cn("min-w-0 flex-1 truncate text-sm", t.done && "text-muted-foreground line-through")}>
                    {t.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右键菜单 */}
      <ContextMenu visible={menu !== null} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(null)}>
        <ContextMenuItem
          icon={<Pencil className="size-3.5" />}
          label={menu?.kind === "event" ? "编辑事件" : "编辑待办"}
          onClick={() => {
            const m = menu;
            setMenu(null);
            if (!m) return;
            if (m.kind === "event") {
              setDrawer({ mode: "event", editing: eventsByDay.get(selectedKey)?.find((a) => a.id === m.id) ?? null, dayKey: selectedKey });
            } else {
              setDrawer({ mode: "todo", editing: (range?.todos ?? []).find((a) => a.id === m.id) ?? null });
            }
          }}
        />
        <ContextMenuDivider />
        <ContextMenuItem
          icon={<Trash2 className="size-3.5" />}
          label="删除"
          className="text-destructive hover:bg-destructive/15 hover:text-destructive"
          onClick={() => removeItem(menu?.kind ?? "event")}
        />
      </ContextMenu>

      {/* 表单抽屉 */}
      <Drawer
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        title={
          drawer?.mode === "event"
            ? drawer.editing
              ? "编辑事件"
              : "新建事件"
            : drawer?.mode === "todo"
              ? drawer.editing
                ? "编辑待办"
                : "新建待办"
              : ""
        }
      >
        {drawer?.mode === "event" ? (
          <EventForm
            key={drawer.editing?.id ?? `new-${drawer.dayKey}`}
            editing={drawer.editing}
            dayKey={drawer.dayKey}
            busy={busy}
            onSave={saveEvent}
            onCancel={() => setDrawer(null)}
          />
        ) : drawer?.mode === "todo" ? (
          <TodoForm
            key={drawer.editing?.id ?? "new-todo"}
            editing={drawer.editing}
            busy={busy}
            onSave={saveTodo}
            onCancel={() => setDrawer(null)}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

// ---------- 事件表单 ----------

function EventForm({
  editing,
  dayKey,
  busy,
  onSave,
  onCancel,
}: {
  editing: EventDto | null;
  dayKey: number;
  busy: boolean;
  onSave: (input: {
    title: string;
    location: string;
    notes: string;
    all_day: boolean;
    start_ms: number;
    end_ms: number;
    rrule: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [allDay, setAllDay] = useState(editing?.all_day ?? false);
  const [start, setStart] = useState(
    editing ? toDateTimeInput(editing.start_ms) : `${toDateInput(dayStartMs(dayKey))}T09:00`,
  );
  const [end, setEnd] = useState(
    editing ? toDateTimeInput(editing.end_ms) : `${toDateInput(dayStartMs(dayKey))}T10:00`,
  );
  const [dayStr, setDayStr] = useState(editing?.all_day ? toDateInput(editing.start_ms) : toDateInput(dayStartMs(dayKey)));
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const t = title.trim();
    if (!t) {
      setErr("标题不能为空");
      return;
    }
    if (allDay) {
      const ms = fromDateInput(dayStr);
      onSave({ title: t, location, notes, all_day: true, start_ms: ms, end_ms: dayEndMs(ms), rrule: null });
    } else {
      const startMs = fromDateTimeInput(start);
      const endMs = fromDateTimeInput(end);
      if (endMs < startMs) {
        setErr("结束时间不能早于开始时间");
        return;
      }
      onSave({ title: t, location, notes, all_day: false, start_ms: startMs, end_ms: endMs, rrule: null });
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="space-y-1.5">
        <Label>标题</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：看牙 / 周会" autoFocus />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">全天事件</div>
          <div className="text-xs text-muted-foreground">不区分具体时刻，只占一整天</div>
        </div>
        <Switch checked={allDay} onCheckedChange={setAllDay} />
      </div>
      {allDay ? (
        <div className="space-y-1.5">
          <Label>日期</Label>
          <Input type="date" value={dayStr} onChange={(e) => setDayStr(e.target.value)} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>开始</Label>
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>结束</Label>
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>地点（可选）</Label>
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="会议室 3F" />
      </div>
      <div className="space-y-1.5">
        <Label>备注（可选）</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="带什么、和谁" />
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button onClick={submit} disabled={busy}>
          {editing ? "保存修改" : "添加"}
        </Button>
      </div>
    </div>
  );
}

// ---------- 待办表单 ----------

function TodoForm({
  editing,
  busy,
  onSave,
  onCancel,
}: {
  editing: TodoDto | null;
  busy: boolean;
  onSave: (input: { title: string; notes: string; due_date: number | null }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [hasDue, setHasDue] = useState(editing?.due_date != null);
  const [dueStr, setDueStr] = useState(editing?.due_date != null ? toDateInput(dayStartMs(editing!.due_date!)) : toDateInput(Date.now()));
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const t = title.trim();
    if (!t) {
      setErr("标题不能为空");
      return;
    }
    onSave({
      title: t,
      notes,
      due_date: hasDue ? fromDateInput(dueStr) : null,
    });
  };

  return (
    <div className="space-y-4 p-6">
      <div className="space-y-1.5">
        <Label>标题</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：交周报" autoFocus />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">设置截止日期</div>
          <div className="text-xs text-muted-foreground">不设置则归为「长期待办」</div>
        </div>
        <Switch checked={hasDue} onCheckedChange={setHasDue} />
      </div>
      {hasDue && (
        <div className="space-y-1.5">
          <Label>截止日期</Label>
          <Input type="date" value={dueStr} onChange={(e) => setDueStr(e.target.value)} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>备注（可选）</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button onClick={submit} disabled={busy}>
          {editing ? "保存修改" : "添加"}
        </Button>
      </div>
    </div>
  );
}