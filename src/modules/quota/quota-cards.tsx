// 额度监控账户卡片组件（DeepSeek / OpenCode Go）与迷你图表
// 从 QuotaPage.tsx 拆出，职责单一：卡片渲染

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Wallet, ChevronDown, ChevronUp } from "lucide-react";

export interface GoQuotaPayload {
  window: string;
  used_percent: number;
  resets_at: number | null;
}

export interface AccountStatusPayload {
  id: string;
  kind: string;
  name: string;
  balance: number | null;
  granted: number;
  topped_up: number;
  available: boolean;
  error: string | null;
  go_windows: GoQuotaPayload[];
}

export const WINDOW_NAMES: Record<string, string> = {
  session: "滚动用量",
  weekly: "每周用量",
  monthly: "每月用量",
};

export function fmtMoney(n: number): string {
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

// 每秒刷新的倒计时：独立组件，只重渲染自身，避免整页每秒重渲染
function Countdown({ ts }: { ts: number | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!ts) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [ts]);
  return <span className="font-semibold text-primary">{fmtCountdown(ts)}</span>;
}

function AccountBadge({
  account,
  threshold,
  critical,
}: {
  account: AccountStatusPayload;
  threshold: number;
  critical: number;
}) {
  const low = account.balance != null && account.balance < critical;
  const lowish = account.balance != null && account.balance < threshold;
  const label =
    account.balance == null
      ? account.error
        ? "查询出错"
        : "未配置"
      : low
        ? "告急"
        : lowish
          ? "偏低"
          : "正常";
  const cls =
    account.balance == null
      ? account.error
        ? "bg-orange-500/15 text-orange-600"
        : "bg-muted text-muted-foreground"
      : low
        ? "bg-red-500/15 text-red-600"
        : lowish
          ? "bg-orange-500/15 text-orange-600"
          : "bg-emerald-500/15 text-emerald-600";
  return <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", cls)}>{label}</span>;
}

// 该账户每日消费迷你柱状图（点击卡片展开）
function MiniDailyBars({ accountId }: { accountId: string }) {
  const [data, setData] = useState<{ date: string; amount: number }[] | null>(null);
  useEffect(() => {
    invoke<{ date: string; amount: number }[]>("get_daily_history", { accountId })
      .then(setData)
      .catch(console.error);
  }, [accountId]);
  if (!data) {
    return (
      <div className="mt-2 flex h-16 items-center justify-center text-xs text-muted-foreground">
        加载中...
      </div>
    );
  }
  if (!data.length) {
    return (
      <div className="mt-2 flex h-16 items-center justify-center text-xs text-muted-foreground">
        暂无历史数据
      </div>
    );
  }
  const max = Math.max(1, ...data.map((d) => d.amount));
  const recent = data.slice(-30);
  return (
    <div className="mt-2 flex h-16 items-end gap-0.5">
      {recent.map((d, i) => (
        <div
          key={i}
          className="min-w-0 flex-1 rounded-t bg-primary/25 transition-colors hover:bg-primary/40"
          style={{ height: `${Math.max(3, (d.amount / max) * 100)}%` }}
          title={`${d.date} · ${fmtMoney(d.amount)}`}
        />
      ))}
    </div>
  );
}

// Go 窗口利用率趋势（点击窗口展开）
function GoSparkline({
  accountId,
  window,
  days = 7,
}: {
  accountId: string;
  window: string;
  days?: number;
}) {
  const [points, setPoints] = useState<{ time: number; used_percent: number }[] | null>(null);
  useEffect(() => {
    invoke<{ time: number; used_percent: number }[]>("get_go_history", {
      accountId,
      window,
      days,
    })
      .then(setPoints)
      .catch(console.error);
  }, [accountId, window, days]);
  if (!points) {
    return (
      <div className="flex h-10 items-center justify-center text-[10px] text-muted-foreground">
        加载中...
      </div>
    );
  }
  if (points.length < 2) {
    return (
      <div className="flex h-10 items-center justify-center text-[10px] text-muted-foreground">
        暂无趋势数据（新周期开始后出现）
      </div>
    );
  }
  // y 轴自动缩放到数据范围（带余量），窄区间变化才看得见；恒定值画在带余量的中间
  const vals = points.map((p) => p.used_percent);
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  let lo = rawMin - (rawMax - rawMin) * 0.25;
  let hi = rawMax + (rawMax - rawMin) * 0.25;
  if (hi - lo < 8) {
    lo = rawMin - 4;
    hi = rawMax + 4;
  }
  lo = Math.max(0, lo);
  hi = Math.min(100, hi);
  if (hi - lo < 1) hi = Math.min(100, lo + 1);
  const span = hi - lo;

  const W = 200;
  const H = 40;
  const step = W / (points.length - 1);
  const pts = points.map(
    (p, i) => `${(i * step).toFixed(1)},${(H - ((p.used_percent - lo) / span) * H).toFixed(1)}`,
  );
  const path = `M ${pts.join(" L ")}`;
  const area = `${path} L ${W},${H} L 0,${H} Z`;

  const last = vals[vals.length - 1];
  return (
    <div className="mt-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          当前 <span className="font-semibold text-foreground">{last}%</span>
        </span>
        <span>
          区间 {rawMin}%–{rawMax}%
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full" preserveAspectRatio="none">
        <path d={area} className="fill-primary/15" />
        <path
          d={path}
          className="fill-none stroke-primary"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

export function DeepseekCard({
  account,
  threshold,
  critical,
}: {
  account: AccountStatusPayload;
  threshold: number;
  critical: number;
}) {
  const [expanded, setExpanded] = useState(false);
  // 每卡自取近 7 天日均（燃尽率），不再依赖父级选中账户
  const [avg7, setAvg7] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    invoke<{ today: number; avg_7d: number }>("get_stats_data", { accountId: account.id })
      .then((s) => alive && setAvg7(s.avg_7d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [account.id]);
  const days =
    avg7 != null && avg7 > 0 && account.balance != null
      ? Math.floor(account.balance / avg7)
      : null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wallet className="size-4 text-muted-foreground" />
          {account.name}
          <AccountBadge account={account} threshold={threshold} critical={critical} />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "收起" : "展开消费历史"}
            title={expanded ? "收起" : "查看消费历史"}
            className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">
          {account.balance != null ? fmtMoney(account.balance) : "—"}
        </div>
        <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
          <span>赠送 {fmtMoney(account.granted)}</span>
          <span>充值 {fmtMoney(account.topped_up)}</span>
        </div>
        {account.balance != null &&
          (days != null ? (
            <div className="mt-1 text-xs text-muted-foreground">
              按近期日均消费 ¥{avg7!.toFixed(2)} 可用约{" "}
              <span className="font-medium text-foreground">{days}</span> 天
            </div>
          ) : (
            <div className="mt-1 text-xs text-muted-foreground">暂无足够历史数据计算日均消费</div>
          ))}
        {expanded && <MiniDailyBars accountId={account.id} />}
        {account.error && (
          <div className="mt-1 text-xs text-orange-600" title={account.error}>
            {account.error.length > 40 ? account.error.slice(0, 40) + "…" : account.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function GoCard({ account }: { account: AccountStatusPayload }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{account.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!account.go_windows.length ? (
          <div className="text-sm text-muted-foreground">
            {account.error ? `暂无套餐数据（${account.error}）` : "未配置密钥或暂无套餐数据"}
          </div>
        ) : (
          account.go_windows.map((w) => (
            <div key={w.window}>
              <button
                type="button"
                onClick={() => setOpen(open === w.window ? null : w.window)}
                className="mb-1 flex w-full items-center justify-between text-xs"
                title="点击查看用量趋势"
              >
                <span className="flex items-center gap-1">
                  {open === w.window ? (
                    <ChevronUp className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                  {WINDOW_NAMES[w.window] ?? w.window}
                </span>
                <span className="text-muted-foreground">
                  重置：
                  <Countdown ts={w.resets_at} />
                </span>
              </button>
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
              {open === w.window && <GoSparkline accountId={account.id} window={w.window} />}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
