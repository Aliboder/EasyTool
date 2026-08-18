import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
  session: "5小时",
  weekly: "每周",
  monthly: "每月",
};

function fmtMoney(n: number): string {
  return `¥${n.toFixed(2)}`;
}

function fmtCountdown(ts: number | null): string {
  if (!ts) return "—";
  const diff = ts * 1000 - Date.now();
  if (diff <= 0) return "即将重置";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

export function QuotaPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    const refresh = () => {
      invoke<StatusPayload>("get_status").then(setStatus).catch(console.error);
      invoke<StatsData>("get_stats_data").then(setStats).catch(console.error);
      invoke<Settings>("get_settings").then(setSettings).catch(console.error);
    };
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const balanceStatus = () => {
    if (!status || status.balance == null) {
      if (status?.error) return { label: "查询出错", cls: "bg-orange-500/15 text-orange-600" };
      return { label: "未配置", cls: "bg-muted text-muted-foreground" };
    }
    if (status.balance < (settings?.warn_threshold ?? 10)) {
      return { label: "不足", cls: "bg-red-500/15 text-red-600" };
    }
    return { label: "正常", cls: "bg-emerald-500/15 text-emerald-600" };
  };

  const bs = balanceStatus();
  const maxDaily = Math.max(1, ...(stats?.daily.map((d) => d.amount) ?? [1]));

  return (
    <div className="space-y-6 p-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
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
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">今日消费</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{fmtMoney(stats?.today ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">近7天日均</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{fmtMoney(stats?.avg_7d ?? 0)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">近 14 天每日消费</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-end gap-1">
            {(stats?.daily ?? []).map((d, i) => (
              <div
                key={i}
                className="group relative flex-1 rounded-t bg-primary/20 transition-colors hover:bg-primary/40"
                style={{ height: `${Math.max(3, (d.amount / maxDaily) * 100)}%` }}
                title={`${d.date}：${fmtMoney(d.amount)}`}
              >
                <div
                  className={cn(
                    "pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground opacity-0 shadow transition-opacity group-hover:opacity-100",
                  )}
                >
                  {fmtMoney(d.amount)}
                </div>
                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground">
                  {d.date}
                </div>
              </div>
            ))}
          </div>
          <div className="h-5" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">OpenCode Go 套餐</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!status?.go_windows.length ? (
            <div className="text-sm text-muted-foreground">
              {status?.error ? `暂无套餐数据（${status.error}）` : "未配置 Go 密钥或暂无套餐数据"}
            </div>
          ) : (
            status.go_windows.map((w) => (
              <div key={w.window}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span>{WINDOW_NAMES[w.window] ?? w.window}</span>
                  <span className="text-muted-foreground">重置：{fmtCountdown(w.resets_at)}</span>
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
                <div className="mt-0.5 text-right text-xs text-muted-foreground">
                  已用 {w.used_percent}%
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}