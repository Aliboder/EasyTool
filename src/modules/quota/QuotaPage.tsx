// 额度监控面板：单一滚动视图，按供应商分组展示账户卡片。
// 供应商无关（registry 驱动），新供应商自动长出分组；设置走侧滑抽屉。

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Settings2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Drawer } from "@/components/ui/drawer";
import { ModuleHeader, HeaderButton } from "@/components/module-header";
import { QuotaSettings } from "./QuotaSettings";
import { AccountCard } from "./quota-cards";
import { type AccountStatusPayload, getKindMeta, knownKinds, fmtMoney } from "./registry";
import { tierAt, nextBoundary } from "./pricing";

interface StatusPayload {
  accounts: AccountStatusPayload[];
  today_spend: number;
  budget: number;
  budget_warn_pct: number;
  budget_critical_pct: number;
}

interface Settings {
  warn_threshold: number;
  critical_threshold: number;
  go_ring_remaining: boolean;
  balance_max: number;
}

/** 今日消费 + 预算进度条（顶部摘要条） */
function BudgetSummary({ status, settings }: { status: StatusPayload; settings: Settings | null }) {
  const budget = status.budget ?? 0;
  const today = status.today_spend ?? 0;
  const pct = budget > 0 ? (today / budget) * 100 : 0;
  const warn = settings ? status.budget_warn_pct ?? 80 : 80;
  const crit = settings ? status.budget_critical_pct ?? 100 : 100;
  const over = budget > 0 && pct >= crit;
  const warnLevel = budget > 0 && pct >= warn && !over;
  const barCls = over
    ? "bg-red-500"
    : warnLevel
      ? "bg-orange-400"
      : "bg-primary";
  // 峰谷档位徽章（30s 刷新）
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const tier = tierAt(new Date());
  const next = nextBoundary(new Date());
  const mins = Math.max(1, Math.ceil(next.remainingMs / 60000));
  const peak = tier === "peak";
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <div className="text-[11px] text-muted-foreground">今日消费（余额型账户合计）</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums">{fmtMoney(today)}</div>
        </div>
        {budget > 0 && (
          <div className="min-w-[220px] flex-1">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                每日预算 <span className="font-medium text-foreground">{fmtMoney(budget)}</span>
              </span>
              <span className={cn("font-medium", over ? "text-red-500" : warnLevel ? "text-orange-500" : "text-foreground")}>
                {pct.toFixed(0)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", barCls)}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            {over && <div className="mt-1 text-[11px] text-red-500">今日消费已超过预算</div>}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
              peak ? "bg-amber-500/15 text-amber-600" : "bg-sky-500/15 text-sky-600",
            )}
            title={`${mins} 分钟后切换为${next.tier === "peak" ? "峰时价" : "谷时价"}（工作日 09–12 / 14–18 峰时，周末全天谷价）`}
          >
            {peak ? "⏫ 峰价时段" : "⏬ 谷价时段"}
            <span className="opacity-70">· {mins}min</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function QuotaPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshStatus = useCallback(() => {
    invoke<StatusPayload>("get_status").then(setStatus).catch(console.error);
    setLastRefresh(Date.now());
  }, []);

  const refreshAll = useCallback(() => {
    setRefreshing(true);
    Promise.all([
      invoke<StatusPayload>("get_status").then(setStatus),
      invoke<Settings>("get_settings").then(setSettings),
    ])
      .catch(console.error)
      .finally(() => {
        setRefreshing(false);
        setLastRefresh(Date.now());
      });
  }, []);

  useEffect(() => {
    refreshAll();
    const un = listen("quota://updated", refreshStatus);
    return () => {
      un.then((fn) => fn());
    };
  }, [refreshAll, refreshStatus]);

  const thresholds = {
    threshold: settings?.warn_threshold ?? 10,
    critical: settings?.critical_threshold ?? (settings?.warn_threshold ?? 10) / 2,
    ringRemaining: settings?.go_ring_remaining ?? false,
    balanceMax: settings?.balance_max ?? 0,
  };

  // 按 kind 分组账户（仅含注册表已知的 kind，按 order 排序），组标题带供应商图标
  const groups = knownKinds()
    .map((kind) => ({
      kind,
      meta: getKindMeta(kind),
      accounts: status?.accounts.filter((a) => a.kind === kind) ?? [],
    }))
    .filter((g) => g.accounts.length > 0);

  return (
    <div className="relative flex h-full flex-col">
      <ModuleHeader
        title="额度监控"
        meta={
          lastRefresh ? (
            <>
              上次刷新{" "}
              {new Date(lastRefresh).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </>
          ) : undefined
        }
        actions={
          <>
            <HeaderButton title={refreshing ? "刷新中…" : "手动刷新"} onClick={refreshAll}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            </HeaderButton>
            <HeaderButton
              title="额度设置"
              active={showSettings}
              onClick={() => setShowSettings((v) => !v)}
            >
              <Settings2 className="size-4" />
            </HeaderButton>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-8 p-6">
          {status != null && (status.accounts.length > 0 || status.budget > 0) && (
            <BudgetSummary status={status} settings={settings} />
          )}
          {status == null ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              加载中...
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              暂无账户，点击右上角 ⚙ 添加
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.kind}>
                <div className="mb-3 flex items-center gap-2">
                  <g.meta.icon className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">{g.meta.name}</h3>
                  <span className="text-xs text-muted-foreground">{g.accounts.length} 个账户</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {g.accounts.map((acc) => (
                    <AccountCard
                      key={acc.id}
                      account={acc}
                      threshold={thresholds.threshold}
                      critical={thresholds.critical}
                      ringRemaining={thresholds.ringRemaining}
                      balanceMax={thresholds.balanceMax}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      <Drawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        title="额度监控设置"
      >
        <QuotaSettings onRefresh={refreshAll} />
      </Drawer>
    </div>
  );
}
