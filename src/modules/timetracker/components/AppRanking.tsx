import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowUpDown, FileQuestion, Loader2 } from "lucide-react";
import type { DailyStat } from "../types";
import { CATEGORY_LABELS, categoryColor, formatDuration } from "../types";

interface Props {
  stats: DailyStat[];
  onSelect: (appId: number) => void;
  selectedApp: number | null;
  loading: boolean;
  /** 当前查看的是否是今天（决定空状态文案） */
  isToday?: boolean;
  icons: Record<string, string>;
  loadIcon: (path: string) => Promise<void>;
}

export function AppRanking({
  stats,
  onSelect,
  selectedApp,
  loading,
  isToday = true,
  icons,
  loadIcon,
}: Props) {
  // 排序维度：总时长 / 活跃时长（纯前端重排）
  const [sortBy, setSortBy] = useState<"total" | "active">("total");

  const sorted = useMemo(
    () =>
      [...stats].sort((a, b) => {
        const key = sortBy === "active" ? "active_duration_sec" : "total_duration_sec";
        return b[key] - a[key];
      }),
    [stats, sortBy],
  );

  // 拉取每个应用的 exe 图标（useFileIcons 内部按路径缓存去重）
  useEffect(() => {
    for (const s of stats) {
      if (s.exe_path && !icons[s.exe_path]) {
        loadIcon(s.exe_path).catch(() => {});
      }
    }
  }, [stats, icons, loadIcon]);

  if (loading && stats.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <div className="py-8 text-center">
        <div className="text-sm text-muted-foreground">
          {isToday ? "正在记录中，还没有数据" : "这一天没有使用记录"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground/70">
          {isToday
            ? "正常切换几个窗口后回来看看，数据会实时累计"
            : "试试翻看其他日期"}
        </div>
      </div>
    );
  }

  const maxDuration = Math.max(...sorted.map((s) => s.total_duration_sec));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">应用排行</h3>
        <button
          onClick={() => setSortBy((v) => (v === "total" ? "active" : "total"))}
          title="切换排序：总时长 / 活跃时长"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowUpDown className="size-3" />
          按{sortBy === "total" ? "总时长" : "活跃"}排序
        </button>
      </div>
      <div className="mt-1 divide-y divide-border/60">
        {sorted.map((stat, index) => {
          const percentage =
            maxDuration > 0 ? (stat.total_duration_sec / maxDuration) * 100 : 0;
          const icon = stat.exe_path ? icons[stat.exe_path] : undefined;

          return (
            <div
              key={stat.app_id}
              onClick={() => onSelect(stat.app_id)}
              className={cn(
                "flex cursor-pointer items-center gap-3 px-2 py-2.5 transition-colors hover:bg-accent/50",
                selectedApp === stat.app_id && "bg-accent",
              )}
            >
              <div className="w-5 shrink-0 text-center text-sm font-medium tabular-nums text-muted-foreground">
                {index + 1}
              </div>
              {/* 应用图标 */}
              <div className="flex size-8 shrink-0 items-center justify-center">
                {icon ? (
                  <img
                    src={`data:image/png;base64,${icon}`}
                    alt=""
                    className="size-7 object-contain"
                  />
                ) : (
                  <div className="flex size-7 items-center justify-center rounded-md bg-muted">
                    <FileQuestion className="size-4 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{stat.app_name}</span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-white"
                    style={{ backgroundColor: categoryColor(stat.category) }}
                  >
                    {CATEGORY_LABELS[stat.category] || "其他"}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: categoryColor(stat.category),
                    }}
                  />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-medium tabular-nums">
                  {formatDuration(stat.total_duration_sec)}
                </div>
                {stat.active_duration_sec > 0 &&
                  stat.active_duration_sec < stat.total_duration_sec && (
                    <div className="text-xs text-muted-foreground">
                      活跃 {formatDuration(stat.active_duration_sec)}
                    </div>
                  )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
