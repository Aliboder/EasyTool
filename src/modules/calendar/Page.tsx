// 日程表页面（批次 2）：月/周/日/待办 四 Tab。
// 月视图交互：点日期跳日视图；周/日视图复用 layoutDay 时间轴；待办分组清单。
// 数据窗口按当前视图需求一次性拉取（并集），增删改后整窗刷新。

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
import { ChevronLeft, ChevronRight, Pencil, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { useModuleConfig } from "@/hooks/useModuleConfig";
import { CALENDAR_DEFAULTS, type CalendarConfig } from "./config";
import type { EventDto, TodoDto, ViewKey } from "./types";
import { DayView, TodoView, WeekView } from "./views";
import {
  dayEndMs,
  dayStartMs,
  fmtHM,
  fromDateTimeInput,
  fromDateInput,
  localDayKey,
  monthGrid,
  toDateInput,
  toDateTimeInput,
  todayKey,
  weekStartKey,
} from "./utils";

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
const TABS: { id: ViewKey; label: string }[] = [
  { id: "month", label: "月" },
  { id: "week", label: "周" },
  { id: "day", label: "日" },
  { id: "todo", label: "待办" },
];

/// 当前视图需要的数据窗口（日键范围，含边界）
function viewWindow(tab: ViewKey, ym: { y: number; m: number }, selectedKey: number): { start: number; end: number } {
  if (tab === "week") {
    const ws = weekStartKey(selectedKey);
    return { start: ws, end: ws + 6 };
  }
  if (tab === "day") {
    return { start: selectedKey, end: selectedKey };
  }
  // month / todo：用当前月网格覆盖（含首尾补格）
  const cells = monthGrid(ym.y, ym.m);
  return { start: cells[0].key, end: cells[cells.length - 1].key };
}

export function CalendarPage() {
  const { cfg } = useModuleConfig<CalendarConfig>("calendar", CALENDAR_DEFAULTS);
  const [tab, setTab] = useState<ViewKey>("month");
  const [configApplied, setConfigApplied] = useState(false);
  const [ym, setYm] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState<number>(() => todayKey());
  const [range, setRange] = useState<RangePayload | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [busy, setBusy] = useState(false);

  // 启动后按配置的默认视图落地
  useEffect(() => {
    if (!configApplied && cfg) {
      setTab(cfg.defaultView);
      setConfigApplied(true);
    }
  }, [cfg, configApplied]);

  const loadRange = useCallback(async () => {
    const w = viewWindow(tab, ym, selectedKey);
    try {
      const r = await invoke<RangePayload>("calendar_get_range", {
        startMs: dayStartMs(w.start),
        endMs: dayEndMs(w.end),
      });
      setRange(r);
    } catch (e) {
      console.error(e);
      setRange({ events: [], todos: [] });
    }
  }, [tab, ym, selectedKey]);

  useEffect(() => {
    loadRange();
  }, [loadRange]);

  // ---------- 数据视图 ----------

  const eventsByDay = useMemo(() => {
    const map = new Map<number, EventDto[]>();
    for (const e of range?.events ?? []) {
      const key = localDayKey(e.start_ms);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return map;
  }, [range]);

  const monthTodoKeys = useMemo(() => {
    const s = new Set<number>();
    for (const t of range?.todos ?? []) {
      if (!t.done && t.due_date != null) s.add(t.due_date);
    }
    return s;
  }, [range]);

  const overdueCount = useMemo(
    () => (range?.todos ?? []).filter((t) => !t.done && t.due_date != null && t.due_date < todayKey()).length,
    [range],
  );

  // ---------- 导航 ----------

  const switchTab = (id: ViewKey) => {
    if (id === "todo") {
      setTab("todo");
      return;
    }
    // 切到月视图时把月份同步到所选日所在月，周/日保持所选日
    setTab(id);
    if (id === "month") {
      const d = new Date(dayStartMs(selectedKey));
      setYm({ y: d.getFullYear(), m: d.getMonth() });
    }
  };

  const moveStep = (delta: number) => {
    if (tab === "month") {
      setYm(({ y, m }) => {
        const d = new Date(y, m + delta, 1);
        return { y: d.getFullYear(), m: d.getMonth() };
      });
    } else if (tab === "week") {
      const cur = new Date(dayStartMs(selectedKey));
      setSelectedKey(localDayKey(cur.getTime() + delta * 7 * 86400000));
    } else if (tab === "day") {
      const cur = new Date(dayStartMs(selectedKey));
      setSelectedKey(localDayKey(cur.getTime() + delta * 86400000));
    }
  };

  const goToday = () => {
    const k = todayKey();
    setSelectedKey(k);
    if (tab === "month") {
      const n = new Date();
      setYm({ y: n.getFullYear(), m: n.getMonth() });
    }
  };

  // ---------- 增删改 ----------

  const openEventDrawer = (editing: EventDto | null, dayKey: number) =>
    setDrawer({ mode: "event", editing, dayKey });

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

  const openMenu = (kind: "event" | "todo", id: number, x: number, y: number) =>
    setMenu({ kind, id, x, y });

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

  const cells = monthGrid(ym.y, ym.m);

  return (
    <div className="flex h-full flex-col">
      <ModuleHeader
        title="日程表"
        meta={overdueCount > 0 ? `${overdueCount} 条待办已逾期` : "本地日历 · 数据存于本机"}
        actions={
          <>
            {tab !== "todo" && (
              <>
                <HeaderButton title="上一段" onClick={() => moveStep(-1)}>
                  <ChevronLeft className="size-4" />
                </HeaderButton>
                <HeaderButton title="回到今天" onClick={goToday}>
                  <span className="text-xs">今天</span>
                </HeaderButton>
                <HeaderButton title="下一段" onClick={() => moveStep(1)}>
                  <ChevronRight className="size-4" />
                </HeaderButton>
              </>
            )}
            <HeaderButton title="导入 ICS 日程文件（课程表/日历）" onClick={importIcs}>
              <Upload className="size-4" />
              <span className="text-xs">导入</span>
            </HeaderButton>
          </>
        }
        tabs={TABS}
        activeTab={tab}
        onTabChange={(id) => switchTab(id as ViewKey)}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "month" && (
          <div className="flex h-full flex-col">
            <div className="grid shrink-0 grid-cols-7 border-b px-2 py-1 text-center text-[11px] text-muted-foreground">
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="grid shrink-0 grid-cols-7 gap-px overflow-hidden border-b bg-border px-2 py-2">
              {cells.map((cell) => {
                const evs = eventsByDay.get(cell.key) ?? [];
                const hasTodo = monthTodoKeys.has(cell.key);
                const isToday = cell.key === todayKey();
                const selected = cell.key === selectedKey;
                return (
                  <button
                    key={cell.key}
                    onClick={() => {
                      setSelectedKey(cell.key);
                      switchTab("day");
                    }}
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
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              点击日期进入日视图查看/添加安排
            </div>
          </div>
        )}

        {tab === "week" && (
          <WeekView
            events={range?.events ?? []}
            selectedKey={selectedKey}
            showWeekend={cfg.weekShowWeekend !== false}
            onSelectDay={setSelectedKey}
            onEventClick={(e) => openEventDrawer(e, localDayKey(e.start_ms))}
            onEventMenu={(e, x, y) => openMenu("event", e.id, x, y)}
          />
        )}

        {tab === "day" && (
          <DayView
            events={range?.events ?? []}
            todos={range?.todos ?? []}
            dayKey={selectedKey}
            onEventClick={(e) => openEventDrawer(e, localDayKey(e.start_ms))}
            onEventMenu={(e, x, y) => openMenu("event", e.id, x, y)}
            onToggleTodo={toggleTodo}
            onTodoMenu={(t, x, y) => openMenu("todo", t.id, x, y)}
            onAddEvent={() => setDrawer({ mode: "event", editing: null, dayKey: selectedKey })}
            onAddTodo={() => setDrawer({ mode: "todo", editing: null })}
          />
        )}

        {tab === "todo" && (
          <TodoView
            todos={range?.todos ?? []}
            onToggle={toggleTodo}
            onMenu={(t, x, y) => openMenu("todo", t.id, x, y)}
            onAdd={() => setDrawer({ mode: "todo", editing: null })}
          />
        )}
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
              const ev = (range?.events ?? []).find((a) => a.id === m.id);
              if (ev) openEventDrawer(ev, localDayKey(ev.start_ms));
            } else {
              const t = (range?.todos ?? []).find((a) => a.id === m.id);
              if (t) setDrawer({ mode: "todo", editing: t });
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
  const [dayStr, setDayStr] = useState(
    editing?.all_day ? toDateInput(editing.start_ms) : toDateInput(dayStartMs(dayKey)),
  );
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
  const dueVal = editing?.due_date ?? null;
  const [hasDue, setHasDue] = useState(dueVal != null);
  const [dueStr, setDueStr] = useState(
    dueVal != null ? toDateInput(dayStartMs(dueVal)) : toDateInput(Date.now()),
  );
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