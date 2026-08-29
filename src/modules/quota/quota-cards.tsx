// 账户卡片：按供应商指标形态（balance / usage）分派渲染。全部字段来自后端真实数据。
// AccountCard 提供共享 Card + 头部（图标/名称/徽章）；BalanceCard / UsageCard 只渲染内容体。

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GripVertical, RefreshCw } from "lucide-react";
import {
  getKindMeta,
  type AccountStatusPayload,
  type GoQuotaPayload,
  type StatsPayload,
  fmtMoney,
  windowName,
} from "./registry";
import { DailyBars, Ring, SegmentBar } from "./charts";
import { tierAt, nextBoundary, fmtRemaining } from "./pricing";

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

/** 峰/谷计价档位徽章（北京时间规则，30 秒刷新倒计时）。
 * 固定用在余额卡的渐变头上（正常/低余额橙/告急红三种底色），
 * 因此采用白字+半透明黑底的高对比胶囊，峰/谷语义用小色点区分，
 * 保证任何渐变底、任何强调色下都可读。 */
function TierBadge() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const tier = tierAt(new Date());
  const next = nextBoundary(new Date());
  const peak = tier === "peak";
  const remaining = fmtRemaining(next.remainingMs);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-black/15 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
      title={`${peak ? "峰价时段" : "谷价时段"} · ${remaining}后切换为${next.tier === "peak" ? "峰时" : "谷时"}价（工作日 09–12 / 14–18 峰时，周末全天谷价）`}
    >
      <span className={cn("size-1.5 rounded-full", peak ? "bg-amber-300" : "bg-sky-300")} />
      {peak ? "峰价" : "谷价"}
      <span className="opacity-80">· {remaining}</span>
    </span>
  );
}

/** 余额型内容体（DeepSeek / 自定义 / SiliconFlow）：紧凑排版，总高度与用量卡（Go）一致。
 * 状态色通过顶部细条带 + 数字颜色 + 状态徽章三重表达；信息密度与 Go 卡的环形布局对齐 */
function BalanceBody({ account, threshold, critical, balanceMax }: {
  account: AccountStatusPayload;
  threshold: number;
  critical: number;
  balanceMax: number;
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
  const numCls = alert ? "text-destructive" : low ? "text-orange-500" : "text-foreground";
  const stripCls = alert
    ? "bg-gradient-to-r from-red-500 to-rose-400"
    : low
      ? "bg-gradient-to-r from-orange-500 to-amber-400"
      : "bg-gradient-to-r from-primary to-primary/40";
  const days =
    stats && stats.avg_7d > 0 && account.balance != null ? Math.floor(account.balance / stats.avg_7d) : null;

  // 三段进度条基准：手动设的 balanceMax > 充值+赠送 时用设置值，否则自动（充值+赠送）
  const baseline =
    balanceMax > 0
      ? balanceMax
      : account.granted + account.topped_up > 0
        ? account.granted + account.topped_up
        : 0;

  return (
    <div className="flex h-full flex-col gap-1">
      {/* 状态条带 */}
      <div className={cn("h-[3px] w-full rounded-full", stripCls)} />
      {/* 余额（与峰谷徽章同一行） */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-[11px] text-muted-foreground">余额</span>
          <span className={cn("truncate text-xl font-bold tracking-tight tabular-nums", numCls)}>
            {account.balance != null ? fmtMoney(account.balance) : "—"}
          </span>
          {!account.available && account.balance != null && (
            <span className="text-[10px] text-amber-500">不可用</span>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {account.kind === "deepseek" && <TierBadge />}
          {account.error && (
            <span
              className="max-w-[120px] truncate text-[10px] text-orange-600"
              title={account.error}
            >
              {account.error}
            </span>
          )}
        </div>
      </div>
      {/* 三段进度条（紧凑，无色名行；悬停看比例） */}
      {account.balance != null && baseline > 0 && (
        <SegmentBar
          compact
          balance={account.balance}
          today={stats?.today ?? 0}
          used={Math.max(0, baseline - account.balance)}
          max={baseline}
        />
      )}
      {/* 赠送/充值/耗尽预估/日均 */}
      <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        {account.granted > 0 && <span>赠送 {fmtMoney(account.granted)}</span>}
        {account.topped_up > 0 && <span>充值 {fmtMoney(account.topped_up)}</span>}
        {days != null && <span>约 {days} 天耗尽</span>}
        {stats && stats.avg_7d > 0 && <span>日均 {fmtMoney(stats.avg_7d)}</span>}
      </div>
      {/* 近 7 天消费（贴底，撑满时与 Go 卡同高） */}
      <div className="mt-auto flex items-center gap-2 pt-0.5">
        <span className="shrink-0 text-[10px] text-muted-foreground">近7天</span>
        {stats && stats.daily.length > 0 ? (
          <DailyBars data={stats.daily} days={7} className="h-6 flex-1" />
        ) : (
          <div className="flex h-6 flex-1 items-center justify-center text-xs text-muted-foreground">
            暂无历史
          </div>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground">
          今日 <b className="font-medium text-foreground">{fmtMoney(stats?.today ?? 0)}</b>
        </span>
      </div>
    </div>
  );
}

/** Go 单窗口：环形用量（环形 + 窗口名/剩余/重置三行信息）；文本窗口直接展示文本 */
function GoWindowBlock({ win, ringRemaining }: {
  win: GoQuotaPayload;
  ringRemaining: boolean;
}) {
  // 文本窗口（余额类）：无百分比环
  if (win.text) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
        <div className="mt-2 text-sm font-medium text-foreground">{windowName(win.window)}</div>
        <div className="text-base font-semibold tabular-nums">{win.text}</div>
      </div>
    );
  }
  const used = win.used_percent;
  // 展示模式：按实际用量（未用为空环，随用量填充）/ 从 100% 逐次递减（显示剩余量）
  // 颜色按已用量判断：剩余越少越红（展示剩余量时颜色不能随剩余值走，否则剩余 80% 会误标橙）
  const shown = ringRemaining ? Math.max(0, 100 - used) : used;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <Ring percent={shown} size={72} colorPercent={used} />
      <div className="flex w-full min-w-0 flex-col items-center text-center">
        <span className="text-sm font-medium text-foreground">{windowName(win.window)}</span>
        <span className="text-[11px] text-muted-foreground">
          {ringRemaining ? `已用 ${used}%` : `剩余 ${Math.max(0, 100 - used)}%`}
        </span>
        <span className="text-[11px] text-muted-foreground">
          重置 <Countdown ts={win.resets_at} />
        </span>
      </div>
    </div>
  );
}

/** 用量型内容体（Go / Coding Plan）：三窗口环形用量，纵向居中填充 */
function UsageBody({ account, ringRemaining }: { account: AccountStatusPayload; ringRemaining: boolean }) {
  if (!account.go_windows.length) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="size-4 opacity-60" />
        {account.error ? `暂无套餐数据（${account.error}）` : "未配置密钥或暂无套餐数据"}
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center gap-3">
      {account.go_windows.map((w) => (
        <GoWindowBlock key={w.window} win={w} ringRemaining={ringRemaining} />
      ))}
    </div>
  );
}

/** 账户卡拖拽排序包装：整卡可拖（PointerSensor 距离阈值避免误触），拖时半透明置顶。
 * h-full：网格单元被拉伸到行高，卡片必须撑满单元，否则 dnd-kit 的排序矩形
 * 会比可见卡片高出一截（幽灵空白），跨不同高度的卡片拖动时会互相压叠变形 */
export function SortableCard({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    willChange: "transform",
  };
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      title="拖拽排序"
      className={cn(
        "group relative h-full cursor-grab select-none active:cursor-grabbing",
        isDragging && "z-10 opacity-80",
      )}
    >
      {children}
    </div>
  );
}

export function AccountCard({
  account,
  threshold,
  critical,
  ringRemaining,
  balanceMax,
  dragHandle,
}: {
  account: AccountStatusPayload;
  threshold: number;
  critical: number;
  ringRemaining: boolean;
  balanceMax: number;
  dragHandle?: boolean;
}) {
  const meta = getKindMeta(account.kind);
  const Icon = meta.icon;
  return (
    // min-h-[12rem]：以 Go 卡（环形布局）为基准的统一高度（随界面缩放等比变化），
    // 所有厂商卡片——无论内容多寡——都至少到达该高度，网格各行因此完全齐平
    <Card className="h-full min-h-[12rem]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{account.name}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {meta.name}
          </span>
          <StatusBadge account={account} threshold={threshold} critical={critical} />
          {dragHandle && (
            <GripVertical className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {meta.shape === "balance" ? (
          <BalanceBody account={account} threshold={threshold} critical={critical} balanceMax={balanceMax} />
        ) : (
          <UsageBody account={account} ringRemaining={ringRemaining} />
        )}
      </CardContent>
    </Card>
  );
}
