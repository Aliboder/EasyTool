// 额度监控面板：摘要条 + DeepSeek/Go 账户分区 + 设置抽屉
// 历史图表统一在卡片展开内，设置改侧滑抽屉不整页切换

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { Settings2, RefreshCw, Wallet, Layers } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { QuotaSettings } from "./QuotaSettings";
import { QuotaSummary } from "./quota-summary";
import { DeepseekCard, GoCard, type AccountStatusPayload } from "./quota-cards";

interface StatusPayload {
  accounts: AccountStatusPayload[];
}

interface Settings {
  warn_threshold: number;
  critical_threshold: number;
}

export function QuotaPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  const dsAccounts = status?.accounts.filter((a) => a.kind === "deepseek") ?? [];
  const goAccounts = status?.accounts.filter((a) => a.kind === "go") ?? [];

  const refresh = useCallback(() => {
    invoke<StatusPayload>("get_status").then(setStatus).catch(console.error);
    invoke<Settings>("get_settings").then(setSettings).catch(console.error);
    setLastRefresh(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const threshold = settings?.warn_threshold ?? 10;
  const critical = settings?.critical_threshold ?? threshold / 2;

  return (
    <div className="relative flex h-full flex-col">
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
            type="button"
            onClick={refresh}
            aria-label="立即刷新"
            title="立即刷新"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="size-4" />
          </button>
          <button
            type="button"
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
        <div className="space-y-6 p-6">
          <QuotaSummary
            accounts={status?.accounts ?? []}
            loading={status == null}
            threshold={threshold}
            critical={critical}
          />

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Wallet className="size-4" />
              DeepSeek 账户
            </h3>
            {status == null ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                加载中...
              </div>
            ) : dsAccounts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                暂无 DeepSeek 账户，点击右上角 ⚙ 添加
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {dsAccounts.map((acc) => (
                  <DeepseekCard
                    key={acc.id}
                    account={acc}
                    threshold={threshold}
                    critical={critical}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Layers className="size-4" />
              OpenCode Go 套餐
            </h3>
            {status == null ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                加载中...
              </div>
            ) : goAccounts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                暂无 Go 账户，点击右上角 ⚙ 添加
              </div>
            ) : (
              <div className="space-y-3">
                {goAccounts.map((acc) => (
                  <GoCard key={acc.id} account={acc} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <Drawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        title="额度监控设置"
      >
        <QuotaSettings onRefresh={refresh} />
      </Drawer>
    </div>
  );
}
