import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ModuleHeader, HeaderButton } from "@/components/module-header";
import { ChevronLeft, ChevronRight, GripVertical, Settings2 } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import type { CategoryBreakdown, DailyStat, DayOverview, Event, Period } from "./types";
import type { TimetrackerConfig } from "./config";
import { useFileIcons } from "@/hooks/useFileIcons";
import { useWindowEntrance } from "@/lib/use-window-entrance";
import { usePopupGeometry } from "@/hooks/usePopupGeometry";
import { OverviewBar } from "./components/OverviewBar";
import { AppRanking } from "./components/AppRanking";
import { Timeline } from "./components/Timeline";
import { CategoryOverview } from "./components/CategoryOverview";
import { AppDetail } from "./components/AppDetail";
import { EventLog } from "./components/EventLog";
import { TimetrackerSettings } from "./Settings";

interface Props {
  cfg: TimetrackerConfig;
  onUpdate: (patch: Partial<TimetrackerConfig>) => void;
  popup?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => toDateStr(new Date());
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return toDateStr(new Date(y, m - 1, d + days));
}
/** 本周日（周起点） */
const weekStartStr = () => {
  const d = new Date();
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()));
};
/** 本月 1 号 */
const monthStartStr = () => {
  const d = new Date();
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
};
/** 本月天数（28/29/30/31） */
const daysInMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
};
/** 自 start 起 count 个连续日期（升序） */
const buildDateRange = (start: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => shiftDate(start, i));

export function TimetrackerView({ cfg, onUpdate, popup = false }: Props) {
  // 弹窗呼出入场动画（主窗不播）
  const entranceRef = useWindowEntrance(popup, ["animate-in", "fade-in-0"]);
  // 弹窗尺寸记忆：缩放停止后写回模块配置
  usePopupGeometry("timetracker", { trackSize: popup });

  const [period, setPeriod] = useState<Period>("today");
  // 日期回看：仅「今日」Tab 生效，可翻看任意一天
  const [viewDate, setViewDate] = useState(todayStr());
  const [stats, setStats] = useState<DailyStat[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<Event[]>([]);
  const [timelineDayKeys, setTimelineDayKeys] = useState<string[]>([]);
  const [overview, setOverview] = useState<DayOverview | null>(null);
  const [dailyTotals, setDailyTotals] = useState<[string, number][]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdown[]>([]);
  const [selectedApp, setSelectedApp] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);

  // 共享图标缓存（排行/详情/甘特 tooltip 同源）
  const { icons, loadIcon } = useFileIcons();

  const isToday = viewDate === todayStr();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (period === "today") {
        // 今日：单日 24 小时甘特
        const timeline = await invoke<Event[]>("timetracker_get_app_timeline", {
          date: viewDate,
        });
        setTimelineEvents(timeline);
        setTimelineDayKeys([]);
        const [dayStats, dayOverview, breakdown, totals] = await Promise.all([
          isToday
            ? invoke<DailyStat[]>("timetracker_get_today_stats", { limit: cfg.topN })
            : invoke<DailyStat[]>("timetracker_get_day_stats", { date: viewDate, limit: cfg.topN }),
          invoke<DayOverview>("timetracker_get_day_overview", { date: viewDate }),
          invoke<CategoryBreakdown[]>("timetracker_get_category_breakdown", { date: viewDate }),
          // 迷你趋势始终展示最近 7 天（与当前查看日期无关）
          isToday
            ? invoke<[string, number][]>("timetracker_get_daily_totals", { days: 7 })
            : Promise.resolve(null),
        ]);
        setStats(dayStats);
        setOverview(dayOverview);
        setCategoryBreakdown(breakdown);
        if (totals) setDailyTotals(totals);
      } else {
        // 周 / 月：整段范围的时间线（7 根 / 当月天数根柱），柱按天
        const start = period === "week" ? weekStartStr() : monthStartStr();
        const count = period === "week" ? 7 : daysInMonth();
        const end = shiftDate(start, count);
        const range = await invoke<Event[]>("timetracker_get_app_timeline_range", {
          start,
          end,
        });
        setTimelineEvents(range);
        setTimelineDayKeys(buildDateRange(start, count));
        const data =
          period === "week"
            ? await invoke<DailyStat[]>("timetracker_get_week_stats", { limit: cfg.topN })
            : await invoke<DailyStat[]>("timetracker_get_month_stats", { limit: cfg.topN });
        const overviewData =
          period === "week"
            ? await invoke<DayOverview>("timetracker_get_week_overview")
            : await invoke<DayOverview>("timetracker_get_month_overview");
        const breakdown = await invoke<CategoryBreakdown[]>(
          "timetracker_get_category_breakdown_range",
          {
            start,
            end,
          },
        );
        setStats(data);
        setOverview(overviewData);
        setCategoryBreakdown(breakdown);
        setDailyTotals([]); // 今日迷你趋势不适用于周/月
      }
    } catch (e) {
      console.error("Failed to fetch timetracker data:", e);
    }
    setLoading(false);
  }, [period, viewDate, isToday, cfg.topN]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 定时刷新（30 秒）；翻看历史日期时不轮询，避免数据被顶掉观感跳动
  useEffect(() => {
    if (period !== "today" || !isToday) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData, period, isToday]);

  // 今日/周/月概览优先用后端返回值；无数据时（如空列表）兜底为 0，不显示对比
  const cardOverview: DayOverview | null =
    overview ??
    (stats.length > 0
      ? {
          date: "",
          total_sec: stats.reduce((sum, s) => sum + s.total_duration_sec, 0),
          active_sec: stats.reduce((sum, s) => sum + s.active_duration_sec, 0),
          prev_total_sec: 0,
          app_count: stats.length,
        }
      : null);

  const dateLabel =
    period !== "today"
      ? null
      : isToday
        ? "今日"
        : viewDate.slice(5).replace("-", "/");

  // 时间线标题标签：今日=日期，本周=区间，本月=年月
  const timelineDateLabel =
    period === "today"
      ? viewDate.slice(5)
      : period === "week"
        ? `${weekStartStr().slice(5)}~${todayStr().slice(5)}`
        : monthStartStr().slice(0, 7);

  // Esc 关闭弹窗（抽屉/设置打开时优先由其自身处理，不抢）
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && popup && !showSettings && selectedApp === null) {
      getCurrentWindow().hide();
    }
  };

  return (
    <div
      ref={popup ? entranceRef : undefined}
      onKeyDown={onKeyDown}
      className="flex h-full flex-col bg-background text-foreground"
    >
      <ModuleHeader
        title={period === "today" ? `时长统计 · ${dateLabel}` : "时长统计"}
        leading={
          popup && (
            <div
              data-tauri-drag-region
              className="flex shrink-0 cursor-grab items-center self-stretch px-2 text-muted-foreground hover:text-foreground"
              title="拖动窗口"
            >
              <GripVertical className="pointer-events-none size-4" />
            </div>
          )
        }
        actions={
          <>
            {/* 日期回看：仅今日 Tab（周/月时间线为整段周期） */}
            {period === "today" && (
              <div className="flex items-center">
                <HeaderButton title="前一天" onClick={() => setViewDate(shiftDate(viewDate, -1))}>
                  <ChevronLeft className="size-4" />
                </HeaderButton>
                <HeaderButton
                  title="后一天"
                  disabled={isToday}
                  onClick={() => setViewDate(shiftDate(viewDate, 1))}
                >
                  <ChevronRight className="size-4" />
                </HeaderButton>
              </div>
            )}
            <HeaderButton
              title="设置"
              active={showSettings}
              onClick={() => setShowSettings(true)}
            >
              <Settings2 className="size-4" />
            </HeaderButton>
          </>
        }
        tabs={[
          { id: "today", label: "今日" },
          { id: "week", label: "本周" },
          { id: "month", label: "本月" },
        ]}
        activeTab={period}
        onTabChange={(id) => {
          setPeriod(id as Period);
          // 切回「今日」时回到今天，不残留上次翻看的历史日期
          if (id === "today") setViewDate(todayStr());
        }}
      />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <OverviewBar
          overview={cardOverview}
          appCount={stats.length}
          loading={loading}
          dailyTotals={dailyTotals}
          label={period === "today" ? "今日使用" : period === "week" ? "本周使用" : "本月使用"}
          diffLabel={period === "today" ? "昨日" : period === "week" ? "上周" : "上月"}
        />

        <AppRanking
          stats={stats}
          onSelect={setSelectedApp}
          selectedApp={selectedApp}
          loading={loading}
          isToday={isToday}
          icons={icons}
          loadIcon={loadIcon}
        />

        {categoryBreakdown.length > 0 && (
          <CategoryOverview data={categoryBreakdown} />
        )}

        {timelineEvents.length > 0 && (
          <Timeline
            events={timelineEvents}
            onSelect={setSelectedApp}
            isToday={isToday}
            date={timelineDateLabel}
            granularity={period === "today" ? "hour" : "day"}
            dayKeys={timelineDayKeys}
          />
        )}

        {period === "today" && timelineEvents.length > 0 && (
          <EventLog events={timelineEvents} isToday={isToday} />
        )}
      </div>

      <Drawer
        open={selectedApp !== null}
        onClose={() => setSelectedApp(null)}
        title="应用详情"
      >
        {selectedApp && (
          <AppDetail
            appId={selectedApp}
            icons={icons}
            loadIcon={loadIcon}
            onCategoryChange={fetchData}
          />
        )}
      </Drawer>

      <Drawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        title="时长统计设置"
      >
        <TimetrackerSettings cfg={cfg} onUpdate={onUpdate} />
      </Drawer>
    </div>
  );
}
