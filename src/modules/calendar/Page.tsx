// 日程表页面（批次 2）：月/周/日/待办 四 Tab。
// 月视图交互：点日期跳日视图；周/日视图复用 layoutDay 时间轴；待办分组清单。
// 数据窗口按当前视图需求一次性拉取（并集），增删改后整窗刷新。

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ModuleHeader, HeaderButton } from "@/components/module-header";
import { Drawer } from "@/components/ui/drawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContextMenu } from "@/components/ui/context-menu";
import { ContextMenuItem } from "@/components/ui/context-menu-item";
import { ContextMenuDivider } from "@/components/ui/context-menu-divider";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Clock, Folder, MapPin, Pencil, Repeat, Settings2, StickyNote, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { useModuleConfig } from "@/hooks/useModuleConfig";
import { CALENDAR_DEFAULTS, type CalendarConfig } from "./config";
import type { EventDto, TodoDto, ViewKey } from "./types";
import { CalendarSettings } from "./Settings";
import { DayView, TimeLineView, TodoView, WeekView } from "./views";
import {
  addDaysKey,
  buildRrule,
  dayEndMs,
  dayStartMs,
  fmtHM,
  fmtKey,
  fmtKeyLong,
  fmtMonth,
  fmtRruleSummary,
  COURSE_COLORS,
  courseColor,
  fmtWeekRange,
  fromDateTimeInput,
  fromDateInput,
  keyToDateInput,
  localDayKey,
  monthGrid,
  parseRrule,
  toDateInput,
  toDateTimeInput,
  todayKey,
  weekStartKey,
  type RruleForm,
} from "./utils";

interface RangePayload {
  events: EventDto[];
  todos: TodoDto[];
}

type DrawerState =
  | {
      mode: "event";
      editing: EventDto | null;
      dayKey: number;
      instance?: { eventId: number; instanceDate: number } | null;
      /** 双击时间轴预填的开始时刻 */
      presetStartMs?: number;
      /** 悬停「+」预填全天事件 */
      presetAllDay?: boolean;
    }
  | { mode: "todo"; editing: TodoDto | null }
  | null;

interface MenuState {
  x: number;
  y: number;
  kind: "event" | "todo";
  event?: EventDto;
  todo?: TodoDto;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const TABS: { id: ViewKey; label: string }[] = [
  { id: "timeline", label: "时间线" },
  { id: "day", label: "日" },
  { id: "week", label: "周" },
  { id: "month", label: "月" },
  { id: "todo", label: "待办" },
];

/// 当前视图需要的数据窗口（日键范围，含边界）
function viewWindow(tab: ViewKey, ym: { y: number; m: number }, selectedKey: number): { start: number; end: number } {
  if (tab === "week") {
    const ws = weekStartKey(selectedKey);
    return { start: ws, end: addDaysKey(ws, 6) };
  }
  if (tab === "day") {
    return { start: selectedKey, end: selectedKey };
  }
  // month / todo：用当前月网格覆盖（含首尾补格）
  const cells = monthGrid(ym.y, ym.m);
  return { start: cells[0].key, end: cells[cells.length - 1].key };
}

export function CalendarPage() {
  const { cfg, update } = useModuleConfig<CalendarConfig>("calendar", CALENDAR_DEFAULTS);
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
  const [showSettings, setShowSettings] = useState(false);
  // 订阅 id → 颜色（只读事件着色）与名称（详情「日历账户」）
  const [subColors, setSubColors] = useState<Record<number, string>>({});
  const [subNames, setSubNames] = useState<Record<number, string>>({});
  // 导入源 id → 文件名（详情「日历账户」）
  const [importNames, setImportNames] = useState<Record<number, string>>({});
  // 详情浮窗（点事件先看详情）
  const [detail, setDetail] = useState<EventDto | null>(null);
  // 点「今天」时自增：让日/周视图把时间轴滚到当前时刻
  const [nowFocus, setNowFocus] = useState(0);
  // 视图切换方向（1=日→周→月 前推，-1=后退），用于滑动方向
  const [viewDir, setViewDir] = useState<1 | -1>(1);
  // 只看某门课聚焦（null=全部）
  const [focusTitle, setFocusTitle] = useState<string | null>(null);
  // ---- 时间线视图：范围、加载、跳过空闲、缩放 ----
  const TL_BACK = 90 * 86_400_000; // 前 3 个月
  const TL_FWD = 180 * 86_400_000; // 后 6 个月
  const TL_CHUNK = 30 * 86_400_000;
  const [tl, setTl] = useState<{ start: number; end: number; events: EventDto[]; loading: boolean } | null>(null);
  const [tlHideEmpty, setTlHideEmpty] = useState(true);
  const tlBound = useRef({ back: 0, fwd: 0 });

  const dedupeTl = (list: EventDto[]) => {
    const seen = new Set<string>();
    const out: EventDto[] = [];
    for (const e of list) {
      const key = `${e.id}:${e.instance_date ?? e.start_ms}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
    return out;
  };

  const ensureTl = useCallback(async () => {
    const now = Date.now();
    tlBound.current = { back: now - TL_BACK, fwd: now + TL_FWD };
    const s = now - TL_CHUNK;
    const e = now + TL_CHUNK;
    try {
      const r = await invoke<RangePayload>("calendar_get_range", { startMs: s, endMs: e });
      setTl({ start: s, end: e, events: dedupeTl(r.events), loading: false });
    } catch (err) {
      console.error(err);
      setTl({ start: s, end: e, events: [], loading: false });
    }
  }, []);

  useEffect(() => {
    if (tab === "timeline" && !tl) ensureTl();
  }, [tab, tl, ensureTl]);

  const extendTl = useCallback(
    async (dir: "up" | "down") => {
      if (!tl) return;
      const { back, fwd } = tlBound.current;
      let ns = tl.start;
      let ne = tl.end;
      let fetchStart = 0;
      let fetchEnd = 0;
      if (dir === "up" && tl.start > back) {
        ns = Math.max(back, tl.start - TL_CHUNK);
        fetchStart = ns;
        fetchEnd = tl.start;
      } else if (dir === "down" && tl.end < fwd) {
        ne = Math.min(fwd, tl.end + TL_CHUNK);
        fetchStart = tl.end;
        fetchEnd = ne;
      } else {
        return;
      }
      setTl((p) => (p ? { ...p, loading: true } : p));
      try {
        const r = await invoke<RangePayload>("calendar_get_range", { startMs: fetchStart, endMs: fetchEnd });
        setTl((p) =>
          p ? { start: ns, end: ne, events: dedupeTl([...r.events, ...p.events]), loading: false } : p,
        );
      } catch (err) {
        console.error(err);
        setTl((p) => (p ? { ...p, loading: false } : p));
      }
    },
    [tl],
  );

  const loadSubs = useCallback(() => {
    invoke<{ id: number; color: string; name: string }[]>("calendar_list_subscriptions")
      .then((list) => {
        setSubColors(Object.fromEntries(list.map((s) => [s.id, s.color])));
        setSubNames(Object.fromEntries(list.map((s) => [s.id, s.name])));
      })
      .catch(() => {});
  }, []);

  const loadImportNames = useCallback(() => {
    invoke<{ id: number; name: string }[]>("calendar_list_ics_imports")
      .then((list) => setImportNames(Object.fromEntries(list.map((i) => [i.id, i.name]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSubs();
    loadImportNames();
  }, [loadSubs, loadImportNames]);

  // 关闭设置抽屉后刷新订阅色/来源名（新增/改色即时生效）
  useEffect(() => {
    if (!showSettings) {
      loadSubs();
      loadImportNames();
    }
  }, [showSettings, loadSubs, loadImportNames]);

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
    const oldIdx = TABS.findIndex((t) => t.id === tab);
    const newIdx = TABS.findIndex((t) => t.id === id);
    if (newIdx >= 0 && oldIdx >= 0 && newIdx !== oldIdx) setViewDir(newIdx > oldIdx ? 1 : -1);
    if (id === "todo") {
      setTab("todo");
      return;
    }
    // 切到月视图时把月份同步到所选日所在月，周/日保持所选日
    setTab(id);
    if (id === "day" && selectedKey === todayKey()) {
      setNowFocus((n) => n + 1); // 从月视图点今天/日期进日视图 → 自动滚到当前时刻
    }
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
    setNowFocus((n) => n + 1);
  };

  // ---------- 增删改 ----------

  const openEventDrawer = (
    editing: EventDto | null,
    dayKey: number,
    instance?: { eventId: number; instanceDate: number } | null,
    presetStartMs?: number,
  ) => setDrawer({ mode: "event", editing, dayKey, instance: instance ?? null, presetStartMs });

  /// 双击时间轴空白处：按点位时刻预填新建事件
  const createEventAt = (startMs: number) => {
    setDrawer({ mode: "event", editing: null, dayKey: localDayKey(startMs), instance: null, presetStartMs: startMs });
  };

  /// 月视图悬停「+」：新建该日全天事件
  const createAllDayAt = (dayKey: number) => {
    setDrawer({ mode: "event", editing: null, dayKey, instance: null, presetAllDay: true });
  };

  const saveEvent = async (input: {
    title: string;
    location: string;
    notes: string;
    all_day: boolean;
    start_ms: number;
    end_ms: number;
    rrule: string | null;
    remind_minutes: number | null;
    color: string | null;
    syncSameName: boolean;
    instance?: { eventId: number; instanceDate: number } | null;
  }) => {
    setBusy(true);
    try {
      const editing = drawer && drawer.mode === "event" ? drawer.editing : null;
      const instance = drawer && drawer.mode === "event" ? drawer.instance : null;
      if (instance) {
        await invoke("calendar_override_event", {
          eventId: instance.eventId,
          instanceDate: instance.instanceDate,
          input: {
            variant: "edit",
            input: {
              title: input.title,
              location: input.location,
              notes: input.notes,
              all_day: input.all_day,
              start_ms: input.start_ms,
              end_ms: input.end_ms,
              rrule: null,
              remind_minutes: null,
              color: null,
            },
          },
        });
        toast("已只改这一次");
      } else if (editing) {
        const n = await invoke<number>("calendar_update_event", {
          id: editing.id,
          input,
          syncSameName: input.syncSameName, // Tauri 命令行参数为驼峰（sync_same_name → syncSameName）
        });
        toast(n > 0 ? `事件已更新，并同步 ${n} 条同名事件` : "事件已更新");
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

  const removeItem = async () => {
    const m = menu;
    if (!m) return;
    if (m.kind === "event" && m.event) {
      const e = m.event;
      if (!window.confirm("删除这个事件？")) return;
      try {
        await invoke("calendar_delete_event", { id: e.id });
        toast("已删除");
        loadRange();
      } catch (err) {
        toast(`删除失败：${err}`);
      }
    } else if (m.todo) {
      const t = m.todo;
      if (!window.confirm("删除这条待办？")) return;
      try {
        await invoke("calendar_delete_todo", { id: t.id });
        toast("已删除");
        loadRange();
      } catch (err) {
        toast(`删除失败：${err}`);
      }
    }
    setMenu(null);
  };

  /// 删除重复事件的规则及全部次数（危险操作，二级确认）
  const deleteRecurringAll = async (e: EventDto) => {
    if (!window.confirm(`删除「${e.title}」的规则及全部次数？`)) {
      setMenu(null);
      return;
    }
    if (!window.confirm("最后确认：该重复事件的所有次数将全部删除，不可恢复。")) {
      setMenu(null);
      return;
    }
    try {
      await invoke("calendar_delete_event", { id: e.id });
      toast("已删除全部");
      loadRange();
    } catch (err) {
      toast(`删除失败：${err}`);
    } finally {
      setMenu(null);
    }
  };

  const deleteInstanceOnly = async (e: EventDto) => {
    if (e.instance_date == null) return;
    if (!window.confirm(`只删除这一天（${e.instance_date % 100} 日）的这一次？其它次不受影响。`)) return;
    try {
      await invoke("calendar_override_event", {
        eventId: e.id,
        instanceDate: e.instance_date,
        input: { variant: "delete" },
      });
      toast("已删除这一次");
      loadRange();
    } catch (err) {
      toast(`删除失败：${err}`);
    } finally {
      setMenu(null);
    }
  };

  const openMenu = (kind: "event" | "todo", item: EventDto | TodoDto, x: number, y: number) => {
    // 订阅事件只读：不给编辑/删除菜单
    if (kind === "event" && (item as EventDto).subscription_id != null) return;
    if (kind === "event") setMenu({ kind, event: item as EventDto, x, y });
    else setMenu({ kind, todo: item as TodoDto, x, y });
  };

  /// 事件点击：先弹详情浮窗（含来源/重复/提醒信息；订阅事件只读、本地事件可编辑删除）
  const onEventTap = (e: EventDto) => setDetail(e);

  /// 删除详情里的单次本地事件（不经菜单）
  const deleteDetailSingle = async () => {
    const d = detail;
    if (!d) return;
    if (!window.confirm(`删除「${d.title}」？`)) return;
    try {
      await invoke("calendar_delete_event", { id: d.id });
      toast("已删除");
      setDetail(null);
      loadRange();
    } catch (e) {
      toast(`删除失败：${e}`);
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
            {tab === "timeline" ? (
              <HeaderButton title="回到今天" onClick={goToday}>
                <span className="whitespace-nowrap text-xs font-medium">时间线</span>
              </HeaderButton>
            ) : tab !== "todo" ? (
              <>
                <HeaderButton title={tab === "month" ? "上一月" : tab === "week" ? "上一周" : "上一天"} onClick={() => moveStep(-1)}>
                  <ChevronLeft className="size-4" />
                </HeaderButton>
                <HeaderButton title="回到今天" onClick={goToday}>
                  <span className="whitespace-nowrap text-xs font-medium">
                    {tab === "month"
                      ? fmtMonth(ym.y, ym.m)
                      : tab === "week"
                        ? fmtWeekRange(selectedKey, cfg.weekShowWeekend !== false ? 7 : 5)
                        : fmtKeyLong(selectedKey)}
                  </span>
                </HeaderButton>
                <HeaderButton title={tab === "month" ? "下一月" : tab === "week" ? "下一周" : "下一天"} onClick={() => moveStep(1)}>
                  <ChevronRight className="size-4" />
                </HeaderButton>
              </>
            ) : null}
            <HeaderButton title="日程设置" active={showSettings} onClick={() => setShowSettings((v) => !v)}>
              <Settings2 className="size-4" />
            </HeaderButton>
          </>
        }
        tabs={TABS}
        activeTab={tab}
        onTabChange={(id) => switchTab(id as ViewKey)}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          key={tab}
          className={cn(
            "h-full",
            viewDir === 1
              ? "animate-in fade-in-0 slide-in-from-right-3 duration-200 ease-out"
              : "animate-in fade-in-0 slide-in-from-left-3 duration-200 ease-out",
          )}
        >
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
                      "group relative flex min-h-[62px] cursor-pointer flex-col gap-0.5 rounded-md p-1 text-left transition-colors",
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
                      {String(cell.dayOfMonth).padStart(2, "0")}
                    </span>
                    {cell.inMonth && (
                      <span
                        role="button"
                        title="新建全天事件"
                        onClick={(e) => {
                          e.stopPropagation();
                          createAllDayAt(cell.key);
                        }}
                        className="absolute right-1 top-1 hidden size-4 items-center justify-center rounded bg-primary text-[10px] font-semibold text-primary-foreground shadow-sm group-hover:flex"
                      >
                        +
                      </span>
                    )}
                    {evs.slice(0, 3).map((e) => {
                      const tint = e.subscription_id != null ? subColors[e.subscription_id] : (e.color ?? courseColor(e.title));
                      const dimmed = focusTitle != null && e.title !== focusTitle;
                      return (
                        <span
                          key={e.id}
                          title={`${e.all_day ? "全天" : fmtHM(e.start_ms)} · ${e.title}`}
                          className={cn(
                            "truncate rounded px-1 py-px text-[10px]",
                            e.all_day ? "bg-primary/25 text-primary" : "bg-secondary text-secondary-foreground",
                            dimmed && "opacity-40",
                          )}
                          style={tint ? { backgroundColor: `${tint}26`, color: tint } : undefined}
                        >
                          {e.all_day ? "" : `${fmtHM(e.start_ms)} `}
                          {e.title}
                        </span>
                      );
                    })}
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
            subColors={subColors}
            nowFocus={nowFocus}
            focusTitle={focusTitle}
            onFocusTitle={setFocusTitle}
            onSelectDay={setSelectedKey}
            onEventClick={onEventTap}
            onEventMenu={(e, x, y) => openMenu("event", e, x, y)}
            onCreateAt={createEventAt}
          />
        )}

        {tab === "day" && (
          <DayView
            events={range?.events ?? []}
            todos={range?.todos ?? []}
            dayKey={selectedKey}
            subColors={subColors}
            nowFocus={nowFocus}
            focusTitle={focusTitle}
            onEventClick={onEventTap}
            onEventMenu={(e, x, y) => openMenu("event", e, x, y)}
            onToggleTodo={toggleTodo}
            onTodoMenu={(t, x, y) => openMenu("todo", t, x, y)}
            onAddEvent={() => setDrawer({ mode: "event", editing: null, dayKey: selectedKey })}
            onAddTodo={() => setDrawer({ mode: "todo", editing: null })}
            onCreateAt={createEventAt}
          />
        )}

        {tab === "timeline" && (
          <TimeLineView
            events={tl?.events ?? []}
            subColors={subColors}
            loadedStart={tl?.start ?? 0}
            loadedEnd={tl?.end ?? 0}
            loading={tl?.loading ?? false}
            hideEmpty={tlHideEmpty}
            nowFocus={nowFocus}
            onHideEmptyChange={setTlHideEmpty}
            onLoadEdge={extendTl}
            onEventClick={onEventTap}
            onEventMenu={(e, x, y) => openMenu("event", e, x, y)}
            onCreateAt={createEventAt}
          />
        )}
        {tab === "todo" && (
          <TodoView
            todos={range?.todos ?? []}
            onToggle={toggleTodo}
            onMenu={(t, x, y) => openMenu("todo", t, x, y)}
            onAdd={() => setDrawer({ mode: "todo", editing: null })}
          />
        )}
        </div>
      </div>

      {/* 右键菜单 */}
      <ContextMenu visible={menu !== null} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(null)}>
        {menu?.kind === "event" && menu.event ? (
          <>
            {menu.event.rrule && menu.event.instance_date != null ? (
              <>
                <ContextMenuItem
                  icon={<Pencil className="size-3.5" />}
                  label="编辑此事件（仅此一次）"
                  onClick={() => {
                    const e = menu.event!;
                    setMenu(null);
                    openEventDrawer(e, localDayKey(e.start_ms), {
                      eventId: e.id,
                      instanceDate: e.instance_date!,
                    });
                  }}
                />
                <ContextMenuItem
                  icon={<Pencil className="size-3.5" />}
                  label="编辑规则（全部次数）"
                  onClick={() => {
                    const e = menu.event!;
                    setMenu(null);
                    openEventDrawer({ ...e, instance_date: null }, localDayKey(e.start_ms), null);
                  }}
                />
                <ContextMenuDivider />
                <ContextMenuItem
                  icon={<Trash2 className="size-3.5" />}
                  label="删除此事件（仅此一次）"
                  className="text-destructive hover:bg-destructive/15 hover:text-destructive"
                  onClick={() => deleteInstanceOnly(menu.event!)}
                />
                <ContextMenuItem
                  icon={<Trash2 className="size-3.5" />}
                  label="删除全部（含规则）"
                  className="text-destructive hover:bg-destructive/15 hover:text-destructive"
                  onClick={() => deleteRecurringAll(menu.event!)}
                />
              </>
            ) : (
              <>
                <ContextMenuItem
                  icon={<Pencil className="size-3.5" />}
                  label="编辑事件"
                  onClick={() => {
                    const e = menu.event!;
                    setMenu(null);
                    openEventDrawer(e, localDayKey(e.start_ms), null);
                  }}
                />
                <ContextMenuDivider />
                <ContextMenuItem
                  icon={<Trash2 className="size-3.5" />}
                  label="删除"
                  className="text-destructive hover:bg-destructive/15 hover:text-destructive"
                  onClick={removeItem}
                />
              </>
            )}
          </>
        ) : menu?.kind === "todo" && menu.todo ? (
          <>
            <ContextMenuItem
              icon={<Pencil className="size-3.5" />}
              label="编辑待办"
              onClick={() => {
                const t = menu.todo!;
                setMenu(null);
                setDrawer({ mode: "todo", editing: t });
              }}
            />
            <ContextMenuDivider />
            <ContextMenuItem
              icon={<Trash2 className="size-3.5" />}
              label="删除"
              className="text-destructive hover:bg-destructive/15 hover:text-destructive"
              onClick={removeItem}
            />
          </>
        ) : null}
      </ContextMenu>

      {/* 设置抽屉 */}
      <Drawer open={showSettings} onClose={() => setShowSettings(false)} title="日程设置">
        <CalendarSettings cfg={cfg} onUpdate={update} onImportsChanged={loadRange} />
      </Drawer>

      {/* 事件/待办浮窗（居中弹层；设置仍是右侧抽屉） */}
      <Dialog open={drawer !== null} onOpenChange={(v) => { if (!v) setDrawer(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          {drawer?.mode === "event" ? (
            <EventForm
              key={drawer.editing?.id ?? `new-${drawer.dayKey}`}
              editing={drawer.editing}
              dayKey={drawer.dayKey}
              instance={drawer.instance ?? null}
              busy={busy}
              globalRemindMinutes={cfg.eventRemindMinutes}
              presetStartMs={drawer.presetStartMs}
              presetAllDay={drawer.presetAllDay}
              onSave={saveEvent}
              onCancel={() => setDrawer(null)}
              heading={drawer.instance ? "仅此一次：编辑这一天" : drawer.editing ? "编辑事件" : "新建事件"}
            />
          ) : drawer?.mode === "todo" ? (
            <TodoForm
              key={drawer.editing?.id ?? "new-todo"}
              editing={drawer.editing}
              busy={busy}
              onSave={saveTodo}
              onCancel={() => setDrawer(null)}
              heading={drawer.editing ? "编辑待办" : "新建待办"}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 事件详情浮窗 */}
      <Dialog open={detail !== null} onOpenChange={(v) => { if (!v) setDetail(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          {detail && (
            <EventDetail
              event={detail}
              subNames={subNames}
              importNames={importNames}
              globalRemindMinutes={cfg.eventRemindMinutes}
              onClose={() => setDetail(null)}
              onEdit={() => {
                const d = detail;
                setDetail(null);
                openEventDrawer(d, localDayKey(d.start_ms));
              }}
              onEditInstance={() => {
                const d = detail;
                if (!d || d.instance_date == null) return;
                setDetail(null);
                openEventDrawer(d, localDayKey(d.start_ms), { eventId: d.id, instanceDate: d.instance_date });
              }}
              onEditRule={() => {
                const d = detail;
                setDetail(null);
                openEventDrawer({ ...d, instance_date: null }, localDayKey(d.start_ms), null);
              }}
              onDeleteInstance={() => {
                const d = detail;
                setDetail(null);
                deleteInstanceOnly(d);
              }}
              onDeleteAll={() => {
                const d = detail;
                setDetail(null);
                deleteRecurringAll(d);
              }}
              onDelete={deleteDetailSingle}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- 事件表单 ----------

const RECUR_OPTIONS = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月同日" },
  { value: "monthlyNth", label: "每月第 N 个星期几" },
];

/// 单条提醒可选提前量（分钟；0=准时）
const REMIND_CHOICES = [0, 5, 10, 20, 30, 60, 120, 180];

/// 本地事件可选颜色（hex；null=默认主题色）
/// 课程自动配色盘（按名称稳定配色，见 utils.courseColor）
const EVENT_COLORS = COURSE_COLORS;

/// 信息摘要小标签（浮窗顶部展示事件的关键信息）
function InfoChip({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-1 text-[11px] text-muted-foreground">
      {icon}
      {text}
    </span>
  );
}

/// 事件详情浮窗：标题 + 时间/地点/重复/提醒/日历账户/备注 + 操作按钮
function EventDetail({
  event,
  subNames,
  importNames,
  globalRemindMinutes,
  onClose,
  onEdit,
  onEditInstance,
  onEditRule,
  onDeleteInstance,
  onDeleteAll,
  onDelete,
}: {
  event: EventDto;
  subNames: Record<number, string>;
  importNames: Record<number, string>;
  globalRemindMinutes: number;
  onClose: () => void;
  onEdit: () => void;
  onEditInstance: () => void;
  onEditRule: () => void;
  onDeleteInstance: () => void;
  onDeleteAll: () => void;
  onDelete: () => void;
}) {
  const isSub = event.subscription_id != null;
  const seriesText = useMemo(() => {
    if (!event.rrule) return "";
    const p = parseRrule(event.rrule);
    if (!p || p.freq === "none") return "";
    return `${fmtRruleSummary(p)}${p.untilKey != null ? `，至 ${fmtKey(p.untilKey)} 结束` : ""}`;
  }, [event.rrule]);
  const remindText =
    event.remind_minutes != null
      ? event.remind_minutes === 0
        ? "准时（本条单独设置）"
        : `开始前 ${event.remind_minutes} 分钟（本条单独设置）`
      : globalRemindMinutes === 0
        ? "准时（跟随全局）"
        : `开始前 ${globalRemindMinutes} 分钟（跟随全局）`;
  const sourceText = isSub
    ? (subNames[event.subscription_id!] ?? "订阅日历")
    : event.ics_import_id != null
      ? (importNames[event.ics_import_id] ?? "导入文件")
      : "我的日历";
  const timeText = event.all_day ? "全天" : `${fmtHM(event.start_ms)}–${fmtHM(event.end_ms)}`;
  return (
    <div className="space-y-4">
      <DialogHeader className="gap-1">
        <DialogTitle className="text-lg leading-snug">{event.title}</DialogTitle>
      </DialogHeader>
      <div className="space-y-2.5">
        <DetailRow
          icon={<CalendarDays className="size-3.5" />}
          label="时间"
          value={`${fmtKeyLong(localDayKey(event.start_ms))}  ${timeText}`}
        />
        {event.location && <DetailRow icon={<MapPin className="size-3.5" />} label="地点" value={event.location} />}
        {seriesText && <DetailRow icon={<Repeat className="size-3.5" />} label="重复" value={seriesText} />}
        <DetailRow icon={<Bell className="size-3.5" />} label="提醒" value={remindText} />
        <DetailRow icon={<Folder className="size-3.5" />} label="日历账户" value={sourceText} />
        {event.notes && <DetailRow icon={<StickyNote className="size-3.5" />} label="备注" value={event.notes} />}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        {!isSub && event.rrule && event.instance_date != null ? (
          <>
            <Button variant="outline" size="sm" onClick={onEditRule}>
              编辑全部
            </Button>
            <Button variant="outline" size="sm" onClick={onEditInstance}>
              编辑这一次
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-600"
              onClick={onDeleteInstance}
            >
              删这一次
            </Button>
            <Button variant="destructive" size="sm" onClick={onDeleteAll}>
              删全部
            </Button>
          </>
        ) : !isSub ? (
          <>
            <Button variant="outline" size="sm" onClick={onEdit}>
              编辑
            </Button>
            <Button variant="destructive" size="sm" onClick={onDelete}>
              删除
            </Button>
          </>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );
}

/// 详情行：图标 + 灰字标签 + 内容
function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words text-sm text-foreground">{value}</span>
    </div>
  );
}

function EventForm({
  heading,
  editing,
  dayKey,
  instance,
  busy,
  globalRemindMinutes,
  presetStartMs,
  presetAllDay,
  onSave,
  onCancel,
}: {
  heading: string;
  editing: EventDto | null;
  dayKey: number;
  instance: { eventId: number; instanceDate: number } | null;
  busy: boolean;
  globalRemindMinutes: number;
  presetStartMs?: number;
  presetAllDay?: boolean;
  onSave: (input: {
    title: string;
    location: string;
    notes: string;
    all_day: boolean;
    start_ms: number;
    end_ms: number;
    rrule: string | null;
    remind_minutes: number | null;
    color: string | null;
    syncSameName: boolean;
    instance?: { eventId: number; instanceDate: number } | null;
  }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [allDay, setAllDay] = useState(editing?.all_day ?? presetAllDay ?? false);
  const [start, setStart] = useState(
    editing
      ? toDateTimeInput(editing.start_ms)
      : presetStartMs != null
        ? toDateTimeInput(presetStartMs)
        : `${toDateInput(dayStartMs(dayKey))}T09:00`,
  );
  const [end, setEnd] = useState(
    editing
      ? toDateTimeInput(editing.end_ms)
      : presetStartMs != null
        ? toDateTimeInput(presetStartMs + 3_600_000)
        : `${toDateInput(dayStartMs(dayKey))}T10:00`,
  );
  const [dayStr, setDayStr] = useState(
    editing?.all_day ? toDateInput(editing.start_ms) : toDateInput(dayStartMs(dayKey)),
  );
  // 重复设置（仅此一次模式不可改）
  const [recur, setRecur] = useState<RruleForm>(() => {
    const parsed = editing?.rrule ? parseRrule(editing.rrule) : null;
    return (
      parsed ?? {
        freq: "none",
        bydays: [],
        nth: 1,
        nthDay: editing ? Math.max(0, (new Date(editing.start_ms).getDay() + 6) % 7) : 0,
        untilKey: null,
      }
    );
  });
  const [err, setErr] = useState<string | null>(null);
  const [recErr, setRecErr] = useState<string | null>(null);
  // 提醒：默认跟随全局；可单条覆盖（仅此一次模式不支持改提醒，沿用规则事件默认）
  const [remindOverride, setRemindOverride] = useState(
    instance == null && editing != null && editing.remind_minutes != null,
  );
  const [remindMinutes, setRemindMinutes] = useState<number>(editing?.remind_minutes ?? globalRemindMinutes);
  // 颜色：默认(null)=主题色；可自定义
  const [color, setColor] = useState<string | null>(editing?.color ?? null);
  // 同名同步（编辑导入的重复课程时默认开：改名/换色一次改全）；仅此一次模式不可用
  const [syncSameName, setSyncSameName] = useState(
    instance == null && editing != null && editing.ics_import_id != null,
  );

  const submit = () => {
    const t = title.trim();
    if (!t) {
      setErr("标题不能为空");
      return;
    }
    if (!instance && recur.freq === "weekly" && recur.bydays.length === 0) {
      setRecErr("每周重复至少要勾选一天");
      return;
    }
    let rrule: string | null = null;
    if (!instance) {
      rrule = buildRrule(recur);
      if (rrule === null && recur.freq !== "none") {
        setRecErr("重复设置不完整");
        return;
      }
    }
    const remind = instance ? null : remindOverride ? remindMinutes : null;
    const evColor = instance ? null : color;
    if (allDay) {
      const ms = fromDateInput(dayStr);
      onSave({
        title: t,
        location,
        notes,
        all_day: true,
        start_ms: ms,
        end_ms: ms + 86_400_000 - 1, // 当天 23:59:59.999（不能走 dayEndMs(ms)：ms 是时间戳，非日期键）
        rrule,
        remind_minutes: remind,
        color: evColor,
        syncSameName: editing != null && !instance && syncSameName,
        instance,
      });
    } else {
      const startMs = fromDateTimeInput(start);
      const endMs = fromDateTimeInput(end);
      if (endMs < startMs) {
        setErr("结束时间不能早于开始时间");
        return;
      }
      onSave({
        title: t,
        location,
        notes,
        all_day: false,
        start_ms: startMs,
        end_ms: endMs,
        rrule,
        remind_minutes: remind,
        color: evColor,
        syncSameName: editing != null && !instance && syncSameName,
        instance,
      });
    }
  };

  const toggleDay = (d: number) => {
    setRecur((r) => ({
      ...r,
      bydays: r.bydays.includes(d) ? r.bydays.filter((x) => x !== d) : [...r.bydays, d].sort(),
    }));
  };

  /// 重复系列的可读描述（编辑既有事件时展示上下文，如「每周一、三、五，至 8/29」）
  const seriesText = useMemo(() => {
    if (!editing?.rrule) return "";
    const p = parseRrule(editing.rrule);
    if (!p || p.freq === "none") return "";
    return `${fmtRruleSummary(p)}${p.untilKey != null ? `，至 ${fmtKey(p.untilKey)}` : ""}`;
  }, [editing]);

  return (
    <div className="space-y-4">
      <DialogHeader className="gap-1">
        <DialogTitle>{heading}</DialogTitle>
      </DialogHeader>
      {/* 信息摘要条：日期 / 时段或全天 / 重复规则 / 地点 */}
      <div className="flex flex-wrap gap-1.5">
        <InfoChip icon={<CalendarDays className="size-3" />} text={fmtKeyLong(dayKey)} />
        {editing && (
          <InfoChip
            icon={<Clock className="size-3" />}
            text={editing.all_day ? "全天" : `${fmtHM(editing.start_ms)}–${fmtHM(editing.end_ms)}`}
          />
        )}
        {seriesText && <InfoChip icon={<Repeat className="size-3" />} text={seriesText} />}
        {editing?.location && <InfoChip icon={<MapPin className="size-3" />} text={editing.location} />}
      </div>
      {instance && (
        <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          你正在单独调整 <b>{fmtKeyLong(instance.instanceDate)}</b> 这一天。
          {seriesText ? `这条事件按「${seriesText}」重复，其它次数不受影响；` : "其它重复次数不受影响；"}
          重复规则不可在此改动。
        </div>
      )}
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
        <Label className="flex items-center gap-1">
          <MapPin className="size-3.5 text-muted-foreground" />
          地点（可选）
        </Label>
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="会议室 3F" />
      </div>
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1">
          <StickyNote className="size-3.5 text-muted-foreground" />
          备注（可选）
        </Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="带什么、和谁" />
      </div>
      {!instance && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">提醒</div>
            <div className="text-xs text-muted-foreground">
              {remindOverride
                ? `本条单独设置：开始前 ${remindMinutes} 分钟`
                : `跟随全局提前量（开始前 ${globalRemindMinutes} 分钟）`}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch checked={remindOverride} onCheckedChange={setRemindOverride} aria-label="单独设置提醒" />
            {remindOverride && (
              <Select value={String(remindMinutes)} onValueChange={(v) => setRemindMinutes(Number(v))}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMIND_CHOICES.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m === 0 ? "准时" : `${m} 分钟前`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      )}
      {!instance && (
        <div className="space-y-1.5">
          <div className="text-sm font-medium">颜色</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setColor(null)}
              className={cn(
                "rounded-full border px-2 py-1 text-[11px] transition-transform hover:scale-105",
                color === null
                  ? "border-foreground/70 bg-accent text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              自动
            </button>
            {EVENT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  "size-6 rounded-full border-2 transition-transform",
                  color === c ? "scale-110 border-foreground" : "border-transparent hover:scale-110",
                )}
                style={{ backgroundColor: c }}
                aria-label={`颜色 ${c}`}
              />
            ))}
          </div>
        </div>
      )}
      {editing && !instance && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">同步同名课程</div>
            <div className="text-xs text-muted-foreground">同时改其它同名事件的标题和颜色（时间地点各自保留）</div>
          </div>
          <Switch checked={syncSameName} onCheckedChange={setSyncSameName} aria-label="同步同名课程" />
        </div>
      )}
      {!instance && (
        <div className="space-y-3 rounded-lg border border-dashed p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">重复</div>
              <div className="text-xs text-muted-foreground">按规则自动生成每次（登录日历/课表常用）</div>
            </div>
            <Select
              value={recur.freq}
              onValueChange={(v) =>
                setRecur((r) => ({ ...r, freq: v as RruleForm["freq"] }))
              }
              disabled={instance != null}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECUR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {recur.freq === "weekly" && (
            <div className="flex flex-wrap gap-1.5">
              {["一", "二", "三", "四", "五", "六", "日"].map((w, i) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full border text-xs transition-colors",
                    recur.bydays.includes(i)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {w}
                </button>
              ))}
            </div>
          )}
          {recur.freq === "monthlyNth" && (
            <div className="flex items-center gap-2">
              <Label className="shrink-0 text-xs">每月第</Label>
              <Select
                value={String(recur.nth)}
                onValueChange={(v) => setRecur((r) => ({ ...r, nth: Number(v) }))}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      第 {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(recur.nthDay)} onValueChange={(v) => setRecur((r) => ({ ...r, nthDay: Number(v) }))}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((w, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(recur.freq === "daily" || recur.freq === "weekly" || recur.freq === "monthly" || recur.freq === "monthlyNth") && (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">截止日期</div>
                <div className="text-xs text-muted-foreground">不设置则无限重复</div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={recur.untilKey != null}
                  onCheckedChange={(v) =>
                    setRecur((r) => ({ ...r, untilKey: v ? r.untilKey ?? todayKey() : null }))
                  }
                />
                {recur.untilKey != null && (
                  <Input
                    type="date"
                    value={keyToDateInput(recur.untilKey)}
                    onChange={(e) => {
                      const k = e.target.value;
                      if (k) {
                        const [y, m, d] = k.split("-").map(Number);
                        setRecur((r) => ({ ...r, untilKey: y * 10000 + m * 100 + d }));
                      }
                    }}
                    className="w-36"
                  />
                )}
              </div>
            </div>
          )}
          {!instance && recur.freq !== "none" && (
            <p className="text-[11px] text-muted-foreground">
              预览：{fmtRruleSummary(recur)}
              {recur.untilKey != null && `，至 ${fmtKey(recur.untilKey)}`}
            </p>
          )}
          {recErr && <p className="text-xs text-red-500">{recErr}</p>}
        </div>
      )}
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button onClick={submit} disabled={busy}>
          {instance ? "只改这一天" : editing ? "保存修改" : "添加"}
        </Button>
      </div>
    </div>
  );
}

// ---------- 待办表单 ----------

function TodoForm({
  heading,
  editing,
  busy,
  onSave,
  onCancel,
}: {
  heading: string;
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
    <div className="space-y-4">
      <DialogHeader className="gap-1">
        <DialogTitle>{heading}</DialogTitle>
      </DialogHeader>
      {editing && editing.due_date != null && (
        <InfoChip icon={<CalendarDays className="size-3" />} text={`截止 ${fmtKeyLong(editing.due_date)}`} />
      )}
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