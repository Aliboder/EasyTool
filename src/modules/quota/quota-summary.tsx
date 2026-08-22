// 额度监控摘要条：一眼看整体（纯前端从 status 计算）

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Wallet, AlertTriangle, TrendingDown, Layers } from "lucide-react";
import { fmtMoney, type AccountStatusPayload } from "./quota-cards";

export function QuotaSummary({
  accounts,
  loading = false,
  threshold,
  critical,
}: {
  accounts: AccountStatusPayload[];
  loading?: boolean;
  threshold: number;
  critical: number;
}) {
  const ds = accounts.filter((a) => a.kind === "deepseek");
  const go = accounts.filter((a) => a.kind === "go");
  const total = ds.reduce((s, a) => s + (a.balance ?? 0), 0);
  const alertCount = ds.filter((a) => a.balance != null && a.balance < critical).length;
  const lowCount = ds.filter(
    (a) => a.balance != null && a.balance >= critical && a.balance < threshold,
  ).length;
  const windows = go.reduce((s, a) => s + a.go_windows.length, 0);

  // 首帧加载中显示「—」，避免闪现误导性的 ¥0.00 / 0
  const items = [
    { icon: Wallet, label: "DeepSeek 总余额", value: loading ? "—" : fmtMoney(total) },
    { icon: AlertTriangle, label: "告急账户", value: loading ? "—" : String(alertCount), danger: !loading && alertCount > 0 },
    { icon: TrendingDown, label: "偏低账户", value: loading ? "—" : String(lowCount), warn: !loading && lowCount > 0 },
    { icon: Layers, label: "Go 套餐窗口", value: loading ? "—" : String(windows) },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="flex items-center gap-3 py-3">
            <it.icon
              className={cn(
                "size-5 shrink-0",
                it.danger ? "text-red-500" : it.warn ? "text-orange-500" : "text-muted-foreground",
              )}
            />
            <div>
              <div className="text-xs text-muted-foreground">{it.label}</div>
              <div
                className={cn(
                  "text-lg font-semibold",
                  it.danger ? "text-red-600" : it.warn ? "text-orange-600" : "",
                )}
              >
                {it.value}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
