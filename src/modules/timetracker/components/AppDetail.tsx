import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileQuestion, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppDetail as AppDetailType, DailyStat } from "../types";
import { CATEGORY_LABELS, categoryColor, formatDuration } from "../types";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localToday = () => toDateStr(new Date());

interface Props {
  appId: number;
  /** exe 路径 → base64 图标（由父级 useFileIcons 缓存提供） */
  icons?: Record<string, string>;
  loadIcon?: (path: string) => Promise<void>;
  /** 分类修改后通知父级刷新（排行颜色/时长联动） */
  onCategoryChange?: () => void;
}

export function AppDetail({ appId, icons, loadIcon, onCategoryChange }: Props) {
  const [detail, setDetail] = useState<AppDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<AppDetailType | null>("timetracker_get_app_detail", {
        appId,
      });
      setDetail(data);
      if (data && loadIcon) {
        loadIcon(data.app.exe_path).catch(() => {});
      }
    } catch (e) {
      console.error("Failed to fetch app detail:", e);
    }
    setLoading(false);
  }, [appId, loadIcon]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleCategoryChange = async (category: string) => {
    if (!detail || category === detail.app.category) return;
    setChanging(true);
    const prev = detail.app.category;
    // 乐观更新：立即变色，失败回滚
    setDetail({ ...detail, app: { ...detail.app, category } });
    try {
      await invoke("timetracker_set_category", { appId: detail.app.id, category });
      toast(`已设为${CATEGORY_LABELS[category] ?? category}`);
      onCategoryChange?.();
    } catch (e) {
      setDetail({ ...detail, app: { ...detail.app, category: prev } });
      toast(String(e));
    }
    setChanging(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        未找到应用信息
      </div>
    );
  }

  const icon = icons?.[detail.app.exe_path];
  const cat = detail.app.category;
  const color = categoryColor(cat);
  // 今日 active 已含在 daily_stats 里（今天那一条），取不到则用净减
  const todayTotal = detail.today_duration_sec;
  const todayStat = detail.daily_stats.find((s) => s.date === localToday());
  const todayActive = todayStat?.active_duration_sec ?? 0;
  const todaySessions = todayStat?.session_count ?? 0;
  const activePct = todayTotal > 0 ? Math.round((todayActive / todayTotal) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* 头部英雄区：分类色视觉锚点 */}
      <div className="relative overflow-hidden rounded-lg border">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundColor: color }}
        />
        <div className="relative flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border bg-muted/30">
              {icon ? (
                <img
                  src={`data:image/png;base64,${icon}`}
                  alt=""
                  className="size-10 object-contain"
                />
              ) : (
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <FileQuestion className="size-5 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold leading-tight">
                {detail.app.app_name}
              </div>
              {detail.app.window_title && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {detail.app.window_title}
                </div>
              )}
            </div>
            <Select
              value={cat}
              onValueChange={handleCategoryChange}
              disabled={changing}
            >
              <SelectTrigger
                className="h-7 shrink-0 rounded-full border-0 px-2.5 text-xs font-medium text-white focus:ring-0"
                style={{ backgroundColor: color }}
                title="点击修改分类"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div
            className="truncate text-[11px] text-muted-foreground/80"
            title={detail.app.exe_path}
          >
            {detail.app.exe_path}
          </div>
        </div>
      </div>

      {/* 焦点数字行：今日为主，周/月为副 */}
      <div className="flex items-stretch gap-3 rounded-lg border bg-secondary/40 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">今日使用</div>
          <div className="mt-1 text-3xl font-semibold leading-none tabular-nums">
            {formatDuration(todayTotal)}
          </div>
        </div>
        <div className="w-px self-stretch bg-border" />
        <div className="w-20 shrink-0 text-right">
          <div className="text-xs text-muted-foreground">本周</div>
          <div className="mt-1 text-sm font-medium tabular-nums">
            {formatDuration(detail.week_duration_sec)}
          </div>
        </div>
        <div className="w-px self-stretch bg-border" />
        <div className="w-20 shrink-0 text-right">
          <div className="text-xs text-muted-foreground">本月</div>
          <div className="mt-1 text-sm font-medium tabular-nums">
            {formatDuration(detail.month_duration_sec)}
          </div>
        </div>
      </div>

      {/* 活跃占比条 */}
      <div className="rounded-lg border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium tabular-nums">
            {detail.today_duration_sec > 0 && todayActive > 0
              ? formatDuration(todayActive)
              : "—"}
          </span>
          <span className="text-xs text-muted-foreground">
            活跃使用{todayTotal > 0 && todayActive > 0 ? ` · ${activePct}%` : ""}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            会话 {todaySessions} 次
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${activePct}%` }}
          />
        </div>
      </div>

      {/* 近 7 天趋势柱状图 */}
      {detail.daily_stats.length > 0 && (
        <div className="rounded-lg border p-4">
          <h4 className="mb-3 text-sm font-medium">近 7 天趋势</h4>
          <DailyTrend stats={detail.daily_stats} />
        </div>
      )}
    </div>
  );
}

function DailyTrend({ stats }: { stats: DailyStat[] }) {
  const lastDate = localToday();
  const max = Math.max(...stats.map((s) => s.total_duration_sec), 1);
  return (
    <div className="flex h-28 items-end justify-between gap-2">
      {stats.map((s) => {
        const isToday = s.date === lastDate;
        const h = Math.max((s.total_duration_sec / max) * 100, 4);
        const cat = s.category;
        return (
          <div
            key={s.date}
            title={`${s.date} · ${formatDuration(s.total_duration_sec)}${
              s.active_duration_sec > 0 ? ` · 活跃 ${formatDuration(s.active_duration_sec)}` : ""
            }`}
            className="flex h-full w-full flex-col justify-end"
          >
            <div className="flex flex-1 items-end">
              <div
                className="w-full rounded-t-sm transition-all"
                style={{
                  height: `${h}%`,
                  backgroundColor: isToday ? categoryColor(cat) : `${categoryColor(cat)}40`,
                }}
              />
            </div>
            <div className="mt-1 truncate text-[10px] leading-none text-muted-foreground">
              {s.date.slice(5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
