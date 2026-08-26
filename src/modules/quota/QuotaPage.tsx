// 额度监控面板：单一滚动视图，按供应商分组展示账户卡片。
// 供应商无关（registry 驱动），新供应商自动长出分组；设置走侧滑抽屉。

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Settings2, RefreshCw } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { ModuleHeader, HeaderButton } from "@/components/module-header";
import { QuotaSettings } from "./QuotaSettings";
import { AccountCard } from "./quota-cards";
import { type AccountStatusPayload, getKindMeta, knownKinds } from "./registry";

interface StatusPayload {
  accounts: AccountStatusPayload[];
}

interface Settings {
  warn_threshold: number;
  critical_threshold: number;
  go_ring_remaining: boolean;
}

export function QuotaPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  const refreshStatus = useCallback(() => {
    invoke<StatusPayload>("get_status").then(setStatus).catch(console.error);
    setLastRefresh(Date.now());
  }, []);

  const refreshAll = useCallback(() => {
    refreshStatus();
    invoke<Settings>("get_settings").then(setSettings).catch(console.error);
  }, [refreshStatus]);

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
            <HeaderButton title="手动刷新" onClick={refreshAll}>
              <RefreshCw className="size-4" />
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
