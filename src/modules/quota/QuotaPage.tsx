// 额度监控面板：摘要条 + DeepSeek/Go 账户分区 + 设置抽屉
// 历史图表统一在卡片展开内，设置改侧滑抽屉不整页切换

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings2, RefreshCw } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { ModuleHeader, HeaderButton } from "@/components/module-header";
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
  const [panel, setPanel] = useState("overview");

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
            <HeaderButton title="手动刷新" onClick={refresh}>
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
        tabs={[
          { id: "overview", label: "总览" },
          { id: "deepseek", label: "DeepSeek" },
          { id: "go", label: "OpenCode Go" },
        ]}
        activeTab={panel}
        onTabChange={setPanel}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-6">
          {panel === "overview" && (
            <QuotaSummary
              accounts={status?.accounts ?? []}
              loading={status == null}
              threshold={threshold}
              critical={critical}
            />
          )}

          {panel === "deepseek" && (
            <section>
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
          )}

          {panel === "go" && (
            <section>
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
          )}
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
