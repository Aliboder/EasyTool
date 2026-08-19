import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Settings2,
  RefreshCw,
  Wallet,
  TrendingUp,
  TrendingDown,
  CalendarDays,
  GripVertical,
  LayoutGrid,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useHorizontalWheel } from "@/lib/use-horizontal-wheel";
import { QuotaSettings } from "./QuotaSettings";

interface StatusPayload {
  balance: number | null;
  available: boolean;
  error: string | null;
  go_windows: { window: string; used_percent: number; resets_at: number | null }[];
}

interface StatsData {
  today: number;
  avg_7d: number;
  daily: { date: string; amount: number }[];
}

interface Settings {
  warn_threshold: number;
}

const WINDOW_NAMES: Record<string, string> = {
  session: "滚动用量",
  weekly: "每周用量",
  monthly: "每月用量",
};

const BLOCKS = ["stats", "chart", "go"] as const;

function fmtMoney(n: number): string {
  return `¥${n.toFixed(2)}`;
}

function fmtCountdown(ts: number | null): string {
  if (!ts) return "—";
  const diff = ts * 1000 - Date.now();
  if (diff <= 0) return "即将重置";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d} 天 ${h} 小时 ${m} 分钟`;
  if (h > 0) return `${h} 小时 ${m} 分钟`;
  return `${m} 分钟`;
}

// 让位式拖拽（cc-switch 同款）：所有卡片平滑让位；transform 取整 + 拖动中禁 transition
// 避免亚像素栅格化；will-change 强制 GPU 合成层，位移/重排走 GPU 不重新栅格化，消除压扁
function SortableBlock({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
  });
  const snapped = transform
    ? { ...transform, x: Math.round(transform.x), y: Math.round(transform.y) }
    : transform;
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(snapped),
        transition: isDragging ? "none" : transition,
        willChange: "transform",
      }}
      className="relative"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="拖动排序"
        className="absolute right-2 top-2 z-10 flex cursor-grab items-center rounded-md border bg-background p-1 text-muted-foreground shadow-sm transition-colors hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      {children}
    </div>
  );
}

export function QuotaPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [order, setOrder] = useState<string[]>(["stats", "chart", "go"]);
  const [dailyHistory, setDailyHistory] = useState<{ date: string; amount: number }[]>([]);
  const { ref: chartScrollRef, nodeRef: chartNodeRef } = useHorizontalWheel<HTMLDivElement>();
  const [chartWidth, setChartWidth] = useState(0);

  // 测量图表可见宽度：数据少时柱子拉伸铺满；数据多时固定最小宽度横向滚动。
  // 用回调 ref 在图表节点真正挂载后再绑定观察器（图表数据是异步加载的）
  const chartWrapRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) setChartWidth(en.contentRect.width);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const refresh = useCallback(() => {
    invoke<StatusPayload>("get_status").then(setStatus).catch(console.error);
    invoke<StatsData>("get_stats_data").then(setStats).catch(console.error);
    invoke<Settings>("get_settings").then(setSettings).catch(console.error);
    invoke<{ date: string; amount: number }[]>("get_daily_history")
      .then(setDailyHistory)
      .catch(console.error);
    setLastRefresh(Date.now());
  }, []);

  // 加载后滚到最右，默认看到最近的消费（今天）
  useEffect(() => {
    const el = chartNodeRef.current;
    if (el && dailyHistory.length) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [dailyHistory, chartNodeRef]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // 恢复上次的卡片顺序
  useEffect(() => {
    invoke<string[]>("get_panel_order")
      .then((o) => {
        const known = o.filter((x) => (BLOCKS as readonly string[]).includes(x));
        if (known.length) setOrder(known);
      })
      .catch(() => {});
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    invoke("save_panel_order", { order: next }).catch(console.error);
  };

  const balanceStatus = () => {
    if (!status || status.balance == null) {
      if (status?.error) {
        return { label: "查询出错", cls: "bg-orange-500/15 text-orange-600", low: false };
      }
      return { label: "未配置", cls: "bg-muted text-muted-foreground", low: false };
    }
    if (status.balance < (settings?.warn_threshold ?? 10)) {
      return { label: "不足", cls: "bg-red-500/15 text-red-600", low: true };
    }
    return { label: "正常", cls: "bg-emerald-500/15 text-emerald-600", low: false };
  };

  const bs = balanceStatus();
  const today = stats?.today ?? 0;
  const avg = stats?.avg_7d ?? 0;
  const trendPct = avg > 0 ? ((today - avg) / avg) * 100 : null;
  const chartMax = Math.max(1, ...dailyHistory.map((d) => d.amount), 1);
  // 自适应：数据少时柱子铺满容器，数据多时固定最小宽度横向滚动
  const MIN_BAR_W = 32;
  const GAP = 4;
  const totalNeeded = dailyHistory.length * MIN_BAR_W + (dailyHistory.length - 1) * GAP;
  const chartFits = chartWidth > 0 && totalNeeded <= chartWidth;
  const barW = chartFits ? undefined : MIN_BAR_W;

  const renderBlock = (id: string) => {
    switch (id) {
      case "stats":
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <LayoutGrid className="size-4 text-muted-foreground" />
                数据总览
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <Card className={cn(bs.low && "border-red-500/60")}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Wallet className="size-4 text-muted-foreground" />
                      DeepSeek 余额
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", bs.cls)}>
                        {bs.label}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold">
                      {status?.balance != null ? fmtMoney(status.balance) : "—"}
                    </div>
                    {status?.error && (
                      <div className="mt-1 text-xs text-orange-600" title={status.error}>
                        {status.error.length > 40 ? status.error.slice(0, 40) + "…" : status.error}
                      </div>
                    )}
                    {status && status.balance == null && !status.error && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => setShowSettings(true)}
                      >
                        去配置密钥
                      </Button>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <TrendingUp className="size-4 text-muted-foreground" />
                      今日消费
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold">{fmtMoney(today)}</div>
                    {trendPct != null && (
                      <div
                        className={cn(
                          "mt-1 flex items-center gap-1 text-xs",
                          trendPct > 0 ? "text-red-600" : "text-emerald-600",
                        )}
                      >
                        {trendPct > 0 ? (
                          <TrendingUp className="size-3" />
                        ) : (
                          <TrendingDown className="size-3" />
                        )}
                        {Math.abs(trendPct).toFixed(0)}% {trendPct > 0 ? "高于" : "低于"}近7天日均
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <CalendarDays className="size-4 text-muted-foreground" />
                      近7天日均
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold">{fmtMoney(avg)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">含今日，共 7 天</div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        );
      case "chart":
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">消费历史</CardTitle>
            </CardHeader>
            <CardContent>
              {dailyHistory.length === 0 ? (
                <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
                  暂无历史数据
                </div>
              ) : (
                <div ref={chartWrapRef}>
                  <div ref={chartScrollRef} className="overflow-x-auto">
                    <div style={chartFits ? undefined : { width: `${totalNeeded}px` }}>
                      <div className="relative flex h-44 items-end gap-1">
                        {avg > 0 && (
                          <div
                            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-muted-foreground/50"
                            style={{ bottom: `${(avg / chartMax) * 74}%` }}
                          >
                            <span className="absolute -top-4 right-0 text-[9px] text-muted-foreground">
                              日均 {fmtMoney(avg)}
                            </span>
                          </div>
                        )}
                        {dailyHistory.map((d, i) => {
                          const isLast = i === dailyHistory.length - 1;
                          const hPct = (d.amount / chartMax) * 74;
                          return (
                            <div
                              key={i}
                              className={cn(
                                "group relative h-full shrink-0",
                                chartFits && "flex-1",
                              )}
                              style={barW ? { width: barW } : undefined}
                            >
                              <div
                                className={cn(
                                  "absolute inset-x-0 bottom-0 rounded-t transition-colors",
                                  isLast
                                    ? "bg-primary hover:bg-primary/80"
                                    : "bg-primary/20 hover:bg-primary/40",
                                )}
                                style={{ height: `${Math.max(3, hPct)}%` }}
                              />
                              {chartFits && d.amount > 0 && (
                                <div
                                  className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-muted-foreground"
                                  style={{ bottom: `calc(${Math.max(3, hPct)}% + 2px)` }}
                                >
                                  {fmtMoney(d.amount)}
                                </div>
                              )}
                              <div
                                className={cn(
                                  "pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground opacity-0 shadow transition-opacity group-hover:opacity-100",
                                )}
                                style={{ bottom: `calc(${Math.max(3, hPct)}% + 18px)` }}
                              >
                                {d.date} · {fmtMoney(d.amount)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex gap-1 pt-0.5">
                        {dailyHistory.map((d, i) => (
                          <div
                            key={i}
                            className={cn(
                              "shrink-0 text-center text-[9px] text-muted-foreground",
                              chartFits && "flex-1",
                            )}
                            style={barW ? { width: barW } : undefined}
                          >
                            {i % 2 === 0 || i === dailyHistory.length - 1 ? d.date : ""}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      case "go":
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">OpenCode Go 套餐</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!status?.go_windows.length ? (
                <div className="text-sm text-muted-foreground">
                  {status?.error
                    ? `暂无套餐数据（${status.error}）`
                    : "未配置 Go 密钥或暂无套餐数据"}
                </div>
              ) : (
                status.go_windows.map((w) => (
                  <div key={w.window}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span>{WINDOW_NAMES[w.window] ?? w.window}</span>
                      <span className="text-muted-foreground">
                        重置：
                        <span className="font-semibold text-primary">
                          {fmtCountdown(w.resets_at)}
                        </span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          w.used_percent >= 90
                            ? "bg-red-500"
                            : w.used_percent >= 70
                              ? "bg-orange-500"
                              : "bg-emerald-500",
                        )}
                        style={{ width: `${w.used_percent}%` }}
                      />
                    </div>
                    <div className="mt-0.5 flex justify-between text-xs text-muted-foreground">
                      <span>已用 {w.used_percent}%</span>
                      <span>剩余 {Math.max(0, 100 - w.used_percent)}%</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <h2 className="text-lg font-semibold">额度监控</h2>
        <div className="flex items-center gap-1">
          {lastRefresh && (
            <span className="mr-1 text-xs text-muted-foreground">
              更新于{" "}
              {new Date(lastRefresh).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          <button
            onClick={refresh}
            aria-label="立即刷新"
            title="立即刷新"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="size-4" />
          </button>
          <button
            onClick={() => setShowSettings((v) => !v)}
            aria-label="额度监控设置"
            className={cn(
              "rounded p-1.5 transition-colors",
              showSettings
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Settings2 className="size-4" />
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        {showSettings ? (
          <QuotaSettings />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <div className="space-y-6 p-6">
                {order.map((id) => (
                  <SortableBlock key={id} id={id}>
                    {renderBlock(id)}
                  </SortableBlock>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
