// 账户卡片：按供应商指标形态（balance / usage）分派渲染。全部字段来自后端真实数据。
// AccountCard 提供共享 Card + 头部（图标/名称/徽章）；BalanceCard / UsageCard 只渲染内容体。

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import {
  getKindMeta,
  type AccountStatusPayload,
  type GoPoint,
  type GoQuotaPayload,
  type StatsPayload,
  fmtMoney,
  WINDOW_NAMES,
} from "./registry";
import { AreaTrend, DailyBars, Ring } from "./charts";

function StatusBadge({
  account,
  threshold,
  critical,
}: {
  account: AccountStatusPayload;
  threshold: number;
  critical: number;
}) {
  const b = account.balance;
  if (b == null) {
    if (account.kind === "go" && account.go_windows.length) {
      return <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-600">监控中</span>;
    }
    return (
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-xs font-medium",
          account.error ? "bg-orange-500/15 text-orange-600" : "bg-muted text-muted-foreground",
        )}
      >
        {account.error ? "查询出错" : "未配置"}
      </span>
    );
  }
  const cls =
    b < critical
      ? "bg-red-500/15 text-red-600"
      : b < threshold
        ? "bg-orange-500/15 text-orange-600"
        : "bg-emerald-500/15 text-emerald-600";
  const label = b < critical ? "告急" : b < threshold ? "偏低" : "正常";
  return <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", cls)}>{label}</span>;
}

function Countdown({ ts }: { ts: number | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!ts) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [ts]);
  if (!ts) return <span>—</span>;
  const diff = ts * 1000 - Date.now();
  if (diff <= 0) return <span>即将重置</span>;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return <span>{d} 天 {h} 小时</span>;
  if (h > 0) return <span>{h} 小时 {m} 分</span>;
  return <span>{m} 分</span>;
}

/** 余额型内容体（DeepSeek）：渐变余额头 + 近7天消费趋势 */
function BalanceBody({ account, threshold, critical }: {
  account: AccountStatusPayload;
  threshold: number;
  critical: number;
}) {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  useEffect(() => {
    let alive = true;
    invoke<StatsPayload>("get_stats_data", { accountId: account.id })
      .then((s) => alive && setStats(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [account.id]);

  const alert = account.balance != null && account.balance < critical;
  const low = account.balance != null && account.balance >= critical && account.balance < threshold;
  const accent = alert
    ? "from-red-500/90 to-rose-600/70"
    : low
      ? "from-orange-500/90 to-amber-600/70"
      : "from-primary to-primary/60";
  const numCls = alert ? "text-red-50" : low ? "text-orange-50" : "text-primary-foreground";
  const days =
    stats && stats.avg_7d > 0 && account.balance != null ? Math.floor(account.balance / stats.avg_7d) : null;

  return (
    <div>
      {/* 渐变余额头 */}
      <div className={cn("rounded-xl bg-gradient-to-br px-4 pt-3 pb-3", accent)}>
        <div className={cn("text-[11px] opacity-90", numCls)}>余额</div>
        <div className={cn("mt-0.5 text-3xl font-bold tracking-tight tabular-nums", numCls)}>
          {account.balance != null ? fmtMoney(account.balance) : "—"}
        </div>
        <div className={cn("mt-1 flex flex-wrap gap-3 text-[11px] opacity-90", numCls)}>
          {account.granted > 0 && <span>赠送 {fmtMoney(account.granted)}</span>}
          {account.topped_up > 0 && <span>充值 {fmtMoney(account.topped_up)}</span>}
          {days != null && <span>约 {days} 天耗尽</span>}
        </div>
      </div>
      {/* 近7天消费 */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>近 7 天消费</span>
          {stats && <span className="font-medium text-foreground">今日 {fmtMoney(stats.today)}</span>}
        </div>
        {stats && stats.daily.length > 0 ? (
          <DailyBars data={stats.daily} days={7} className="h-12" />
        ) : (
          <div className="flex h-12 items-center justify-center text-xs text-muted-foreground">
            暂无历史
          </div>
        )}
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {account.available ? "账户可用" : "账户不可用"}
          {stats && stats.avg_7d > 0 && <span> · 日均 {fmtMoney(stats.avg_7d)}</span>}
        </div>
        {account.error && (
          <div className="mt-1 text-xs text-orange-600" title={account.error}>
            {account.error.length > 40 ? account.error.slice(0, 40) + "…" : account.error}
          </div>
        )}
      </div>
    </div>
  );
}

/** Go 单窗口：环形用量（点击展开趋势）*/
function GoWindowBlock({ win, accountId }: {
  win: GoQuotaPayload;
  accountId: string;
}) {
  const [points, setPoints] = useState<GoPoint[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    invoke<GoPoint[]>("get_go_history", { accountId, window: win.window, days: 7 })
      .then((p) => setPoints(p))
      .catch(console.error);
  }, [open, accountId, win.window]);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Ring percent={win.used_percent} size={48} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span className="flex items-center gap-1 text-sm font-medium text-foreground">
          {WINDOW_NAMES[win.window] ?? win.window}
          {open ? <ChevronUp className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
        </span>
        <span className="text-[11px] text-muted-foreground">
          剩余 {Math.max(0, 100 - win.used_percent)}% · 重置 <Countdown ts={win.resets_at} />
        </span>
      </button>
      {open && (
        <div className="w-full">
          {points && points.length >= 2 ? (
            <AreaTrend className="h-10" points={points.map((p) => ({ x: p.time, y: p.used_percent }))} />
          ) : (
            <div className="flex h-10 items-center justify-center text-[10px] text-muted-foreground">
              {points == null ? "加载中..." : "暂无趋势数据"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 用量型内容体（Go）：三窗口环形用量 */
function UsageBody({ account }: { account: AccountStatusPayload }) {
  if (!account.go_windows.length) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="size-4 opacity-60" />
        {account.error ? `暂无套餐数据（${account.error}）` : "未配置密钥或暂无套餐数据"}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {account.go_windows.map((w) => (
        <GoWindowBlock key={w.window} win={w} accountId={account.id} />
      ))}
    </div>
  );
}

export function AccountCard({
  account,
  threshold,
  critical,
}: {
  account: AccountStatusPayload;
  threshold: number;
  critical: number;
}) {
  const meta = getKindMeta(account.kind);
  const Icon = meta.icon;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-4 text-muted-foreground" />
          <span className="min-w-0 truncate">{account.name}</span>
          <StatusBadge account={account} threshold={threshold} critical={critical} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {meta.shape === "balance" ? (
          <BalanceBody account={account} threshold={threshold} critical={critical} />
        ) : (
          <UsageBody account={account} />
        )}
      </CardContent>
    </Card>
  );
}
