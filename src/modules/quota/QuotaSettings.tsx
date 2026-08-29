import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { getKindMeta, knownKinds } from "./registry";
import { SpendHeatmap } from "./charts";

interface AccountInfo {
  id: string;
  kind: string;
  name: string;
  configured: boolean;
  custom?: {
    url: string;
    headers: string;
    path: string;
    total_path?: string | null;
    scale: number;
  } | null;
}

interface QuotaSettings {
  refresh_interval_sec: number;
  warn_threshold: number;
  critical_threshold: number;
  notify_low: boolean;
  notify_surge: boolean;
  go_ring_remaining: boolean;
  daily_budget: number;
  budget_warn_pct: number;
  budget_critical_pct: number;
  notify_budget: boolean;
  balance_max: number;
  peak_alert_enabled: boolean;
  peak_alert_minutes: number;
  peak_alert_mode: string;
  accounts: AccountInfo[];
}

const INTERVALS = [
  { value: 5, label: "5 秒" },
  { value: 15, label: "15 秒" },
  { value: 30, label: "30 秒" },
  { value: 60, label: "1 分钟" },
  { value: 90, label: "1 分 30 秒" },
  { value: 120, label: "2 分钟" },
];

// 账户类型选择列表（注册表驱动；custom 带独立配置）
const ACCOUNT_KINDS = knownKinds().map((kind) => ({ kind, meta: getKindMeta(kind) }));

/// 阈值数字输入：本地草稿编辑，失焦/回车才提交（避免每键一次保存+全网轮询；
/// 空串/非法/负数一律拒绝并还原）
function ThresholdField({
  label,
  hint,
  value,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n) || n < 0) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Input
        type="number"
        step="0.01"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="w-32"
      />
    </div>
  );
}

/** 自定义 Provider 查询配置编辑器（custom 账户用） */
function CustomConfigEditor({
  account,
  onChange,
}: {
  account: AccountInfo;
  onChange: () => void;
}) {
  const [url, setUrl] = useState(account.custom?.url ?? "");
  const [headers, setHeaders] = useState(account.custom?.headers ?? "");
  const [path, setPath] = useState(account.custom?.path ?? "");
  const [totalPath, setTotalPath] = useState(account.custom?.total_path ?? "");
  const [scale, setScale] = useState(String(account.custom?.scale ?? 1));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    if (!url.trim() || !path.trim()) {
      setMsg({ ok: false, text: "URL 与余额取值路径不能为空" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await invoke("set_account_custom", {
        id: account.id,
        custom: {
          url: url.trim(),
          headers: headers.trim() || "{}",
          path: path.trim(),
          total_path: totalPath.trim() || null,
          scale: Number(scale) || 1,
        },
      });
      setMsg({ ok: true, text: "已保存，后台已触发一次查询" });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <div className="text-xs font-medium text-muted-foreground">
        自定义查询（GET；请求头中 <code className="rounded bg-muted px-1">{"{{KEY}}"}</code> 会替换为上方密钥）
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">URL</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-api.com/api/usage/token" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">请求头（JSON，可选）</Label>
          <Input value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder='{"Authorization": "Bearer {{KEY}}"}' />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">余额取值路径</Label>
          <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="data.total_available" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">总量路径（可选）</Label>
          <Input value={totalPath} onChange={(e) => setTotalPath(e.target.value)} placeholder="data.total_granted" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">数值缩放（可选；适配 NewApi 等整数 quota，如 0.000002 = 1/500000）</Label>
          <Input value={scale} onChange={(e) => setScale(e.target.value)} className="w-40" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={save} disabled={busy}>
          保存查询配置
        </Button>
        {msg && (
          <span className={cn("text-xs", msg.ok ? "text-emerald-600" : "text-orange-600")}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

function AccountField({
  account,
  onChange,
}: {
  account: AccountInfo;
  onChange: () => void;
}) {
  const meta = getKindMeta(account.kind);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);

  const applyKey = async () => {
    setBusy(true);
    setResult(null);
    try {
      await invoke("set_account_key", { id: account.id, key: value });
      setResult({ ok: true, msg: "已保存到系统密钥库" });
      setValue("");
      onChange();
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    setBusy(true);
    setResult(null);
    try {
      await invoke("set_account_key", { id: account.id, key: "" });
      setResult({ ok: true, msg: "已清除" });
      setValue("");
      onChange();
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const testKey = async () => {
    setBusy(true);
    setResult(null);
    try {
      const msg = await invoke<string>("test_key", { kind: account.kind, key: value });
      setResult({ ok: true, msg });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === account.name) {
      setEditing(false);
      setName(account.name);
      return;
    }
    try {
      await invoke("rename_account", { id: account.id, name: trimmed });
      onChange();
      setEditing(false);
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
  };

  const remove = async () => {
    if (!window.confirm(`删除账户「${account.name}」？其消费历史将保留在磁盘但不再展示。`)) return;
    try {
      await invoke("remove_account", { id: account.id });
      toast("已删除账户");
      onChange();
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {editing ? (
            <span className="flex items-center gap-1">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                className="h-7 w-40"
              />
              <button onClick={saveName} className="rounded p-1 text-emerald-600 hover:bg-accent">
                <Check className="size-3.5" />
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setName(account.name);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <meta.icon className="size-3.5 text-muted-foreground" />
              {account.name}
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {meta.name}
              </span>
              {account.configured && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-600">
                  已配置
                </span>
              )}
            </span>
          )}
        </span>
        <button
          onClick={() => setEditing((v) => !v)}
          className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="重命名"
          title="重命名"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={remove}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
          aria-label="删除账户"
          title="删除账户"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            account.configured && !value
              ? `已配置，输入新密钥可覆盖`
              : meta.keyHint || "密钥"
          }
          className="flex-1"
        />
        <Button variant="outline" onClick={() => setShow((v) => !v)} className="shrink-0">
          {show ? "隐藏" : "显示"}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={testKey}
          disabled={busy || !value || account.kind === "custom"}
          className="shrink-0"
        >
          测试
        </Button>
        <Button onClick={applyKey} disabled={busy || !value} className="shrink-0">
          应用
        </Button>
        <Button
          variant="ghost"
          onClick={clearKey}
          disabled={busy || !account.configured}
          className="shrink-0"
        >
          清空
        </Button>
      </div>
      {result && (
        <p className={cn(result.ok ? "text-xs text-emerald-600" : "text-xs text-orange-600")}>
          {result.msg}
        </p>
      )}
      <div className="text-[11px] text-muted-foreground">{meta.keyHint}</div>
      {account.kind === "custom" && (
        <CustomConfigEditor account={account} onChange={onChange} />
      )}
    </div>
  );
}

/** 消费历史热图卡片（按账户选择） */
function HistoryCard({ accounts }: { accounts: AccountInfo[] }) {
  const [accId, setAccId] = useState<string>(accounts[0]?.id ?? "");
  const [history, setHistory] = useState<{ date: string; amount: number }[] | null>(null);
  useEffect(() => {
    if (!accId) return;
    let alive = true;
    setHistory(null);
    invoke<{ date: string; amount: number }[]>("get_daily_history", { accountId: accId })
      .then((h) => alive && setHistory(h))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [accId]);

  if (accounts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">消费历史</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          添加 DeepSeek 账户后这里会展示每日消费热图
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">消费历史热图</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs">账户</Label>
          <Select value={accId} onValueChange={setAccId}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <SpendHeatmap data={history ?? []} weeks={26} />
      </CardContent>
    </Card>
  );
}

export function QuotaSettings({ onRefresh }: { onRefresh?: () => void }) {
  const [s, setS] = useState<QuotaSettings | null>(null);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<string>("deepseek");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => {
    invoke<QuotaSettings>("get_settings").then(setS).catch(console.error);
  };

  useEffect(() => {
    reload();
  }, []);

  const set = (patch: Partial<QuotaSettings>) => {
    if (!s) return;
    const prev = s;
    const next = { ...s, ...patch };
    setS(next);
    invoke("save_settings", { settings: next })
      .then(onRefresh)
      .catch((e) => {
        setS(prev); // 落盘失败回滚到修改前的值
        toast(`保存设置失败：${e}`);
      });
  };

  const addAccount = async () => {
    setBusy(true);
    try {
      await invoke("add_account", { kind: newKind, name: newName });
      toast("已添加账户");
      setNewName("");
      setAdding(false);
      reload();
      onRefresh?.();
    } catch (e) {
      toast(`添加失败：${e}`);
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <div className="p-6 text-sm text-muted-foreground">加载中...</div>;

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>账户管理</span>
            <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
              <Plus className="size-4" />
              添加账户
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {adding && (
            <div className="flex items-end gap-2 rounded-lg border p-3">
              <div className="space-y-1">
                <Label className="text-xs">类型</Label>
                <Select value={newKind} onValueChange={setNewKind}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_KINDS.map(({ kind, meta }) => (
                      <SelectItem key={kind} value={kind}>
                        {meta.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs">名称（留空自动编号）</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="留空自动生成"
                  onKeyDown={(e) => e.key === "Enter" && addAccount()}
                />
              </div>
              <Button onClick={addAccount} disabled={busy} className="shrink-0">
                添加
              </Button>
            </div>
          )}
          {s.accounts.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              暂无账户，点击「添加账户」创建（支持 DeepSeek / OpenCode Go / 自定义 Provider / 8 家 Coding Plan）
            </div>
          ) : (
            s.accounts.map((acc) => (
              <AccountField key={acc.id} account={acc} onChange={reload} />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">监控</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>刷新间隔</Label>
            <Select
              value={String(s.refresh_interval_sec)}
              onValueChange={(v) => set({ refresh_interval_sec: Number(v) })}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map((i) => (
                  <SelectItem key={i.value} value={String(i.value)}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ThresholdField
            label="预警阈值"
            hint="低于此值标橙并提醒一次（所有余额型账户共用）"
            value={s.warn_threshold}
            onCommit={(v) => set({ warn_threshold: v })}
          />
          <ThresholdField
            label="紧急阈值"
            hint="低于此值标红并发出「余额告急」提醒（默认预警阈值的一半）"
            value={s.critical_threshold}
            onCommit={(v) => set({ critical_threshold: v })}
          />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">余额不足通知</div>
              <div className="text-xs text-muted-foreground">任一账户跌破阈值时提醒一次</div>
            </div>
            <Switch checked={s.notify_low} onCheckedChange={(v) => set({ notify_low: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">消费突增通知</div>
              <div className="text-xs text-muted-foreground">账户今日消费超近7天日均3倍时提醒</div>
            </div>
            <Switch checked={s.notify_surge} onCheckedChange={(v) => set({ notify_surge: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">用量环显示剩余量</div>
              <div className="text-xs text-muted-foreground">开启后用量环从满环递减显示剩余（默认按实际用量填充）</div>
            </div>
            <Switch
              checked={s.go_ring_remaining}
              onCheckedChange={(v) => set({ go_ring_remaining: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">每日预算</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ThresholdField
            label="每日预算金额"
            hint="0 = 关闭；今日消费（DeepSeek 合计）超过预警/超支线时提醒一次"
            value={s.daily_budget}
            onCommit={(v) => set({ daily_budget: v })}
          />
          <ThresholdField
            label="预警百分比"
            hint="今日消费达预算该百分比时提醒（默认 80%）"
            value={s.budget_warn_pct}
            onCommit={(v) => set({ budget_warn_pct: v })}
          />
          <ThresholdField
            label="超支百分比"
            hint="超过预算该百分比时提醒（默认 100%）"
            value={s.budget_critical_pct}
            onCommit={(v) => set({ budget_critical_pct: v })}
          />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">预算超额通知</div>
              <div className="text-xs text-muted-foreground">开启后跨界时发系统通知</div>
            </div>
            <Switch checked={s.notify_budget} onCheckedChange={(v) => set({ notify_budget: v })} />
          </div>
          <ThresholdField
            label="进度条额度上限"
            hint="0 = 自动（充值+赠送合计）；手动设置后蓝=余额/橙=今日/灰=已用按它计算"
            value={s.balance_max}
            onCommit={(v) => set({ balance_max: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">峰/谷计价提醒（DeepSeek）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs text-muted-foreground">
            工作日北京时间 09:00–12:00 / 14:00–18:00 为峰时段（谷价约为峰价一半）；周末全天谷价。
            切换前提醒，方便把高成本任务安排在谷时。
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">切换提醒</div>
              <div className="text-xs text-muted-foreground">进入峰/谷前发系统通知（同一切换点只提醒一次）</div>
            </div>
            <Switch
              checked={s.peak_alert_enabled}
              onCheckedChange={(v) => set({ peak_alert_enabled: v })}
            />
          </div>
          {s.peak_alert_enabled && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">提前量（分钟）</div>
                  <div className="text-xs text-muted-foreground">距切换不足该时间时提醒（1-30）</div>
                </div>
                <Select
                  value={String(s.peak_alert_minutes)}
                  onValueChange={(v) => set({ peak_alert_minutes: Number(v) })}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 5, 10, 15, 30].map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m} 分钟
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">提醒类型</div>
                  <div className="text-xs text-muted-foreground">只关心高价时段可只提醒进峰</div>
                </div>
                <Select
                  value={s.peak_alert_mode}
                  onValueChange={(v) => set({ peak_alert_mode: v })}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">峰和谷</SelectItem>
                    <SelectItem value="peak">仅进峰</SelectItem>
                    <SelectItem value="valley">仅进谷</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <HistoryCard accounts={s.accounts.filter((a) => a.kind === "deepseek")} />
    </div>
  );
}