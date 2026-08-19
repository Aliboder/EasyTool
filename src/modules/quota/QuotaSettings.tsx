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

interface AccountInfo {
  id: string;
  kind: string;
  name: string;
  configured: boolean;
}

interface QuotaSettings {
  refresh_interval_sec: number;
  warn_threshold: number;
  critical_threshold: number;
  notify_low: boolean;
  notify_surge: boolean;
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

function AccountField({
  account,
  onChange,
}: {
  account: AccountInfo;
  onChange: () => void;
}) {
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
      onChange();
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
  };

  const placeholder =
    account.kind === "go" ? "留空自动使用本机 opencode 登录凭据" : "sk-...";

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
              {account.name}
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {account.kind === "deepseek" ? "DeepSeek" : "Go"}
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
          placeholder={account.configured && !value ? `已配置，输入新密钥可覆盖` : placeholder}
          className="flex-1"
        />
        <Button variant="outline" onClick={() => setShow((v) => !v)} className="shrink-0">
          {show ? "隐藏" : "显示"}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={testKey} disabled={busy || !value} className="shrink-0">
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
    </div>
  );
}

export function QuotaSettings({ onRefresh }: { onRefresh?: () => void }) {
  const [s, setS] = useState<QuotaSettings | null>(null);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<"deepseek" | "go">("deepseek");
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
    const next = { ...s, ...patch };
    setS(next);
    invoke("save_settings", { settings: next }).then(onRefresh).catch(console.error);
  };

  const addAccount = async () => {
    setBusy(true);
    try {
      await invoke("add_account", { kind: newKind, name: newName });
      setNewName("");
      setAdding(false);
      reload();
      onRefresh?.();
    } catch (e) {
      console.error(e);
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
                <Select
                  value={newKind}
                  onValueChange={(v) => setNewKind(v as "deepseek" | "go")}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deepseek">DeepSeek</SelectItem>
                    <SelectItem value="go">OpenCode Go</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs">名称（留空自动编号）</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={newKind === "go" ? "如：套餐 2，留空自动生成" : "如：小号，留空自动生成"}
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
              暂无账户，点击「添加账户」创建
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
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">预警阈值</div>
              <div className="text-xs text-muted-foreground">低于此值标橙并提醒一次（所有 DeepSeek 账户共用）</div>
            </div>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={s.warn_threshold}
              onChange={(e) => set({ warn_threshold: Number(e.target.value) })}
              className="w-32"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">紧急阈值</div>
              <div className="text-xs text-muted-foreground">低于此值标红并发出「余额告急」提醒（默认预警阈值的一半）</div>
            </div>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={s.critical_threshold}
              onChange={(e) => set({ critical_threshold: Number(e.target.value) })}
              className="w-32"
            />
          </div>
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
        </CardContent>
      </Card>
    </div>
  );
}