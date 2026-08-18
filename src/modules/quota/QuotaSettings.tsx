import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface QuotaSettings {
  refresh_interval_sec: number;
  warn_threshold: number;
  notify_low: boolean;
  notify_surge: boolean;
  float_enabled: boolean;
  font_size: number;
  opacity: number;
  dim_level: number;
  corner_radius: number;
  lock_passthrough: boolean;
  ds_configured: boolean;
  go_configured: boolean;
}

const INTERVALS = [
  { value: 5, label: "5 秒" },
  { value: 15, label: "15 秒" },
  { value: 30, label: "30 秒" },
  { value: 60, label: "1 分钟" },
  { value: 90, label: "1 分 30 秒" },
  { value: 120, label: "2 分钟" },
];

function KeyField({
  kind,
  title,
  placeholder,
  configured,
  onSaved,
}: {
  kind: "deepseek" | "go";
  title: string;
  placeholder: string;
  configured: boolean;
  onSaved?: () => void;
}) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const cmd = kind === "deepseek" ? "set_deepseek_key" : "set_go_key";

  const applyKey = async () => {
    setBusy(true);
    setResult(null);
    try {
      await invoke(cmd, { key: value });
      setResult({ ok: true, msg: "已保存到系统密钥库" });
      setValue("");
      onSaved?.();
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
      await invoke(cmd, { key: "" });
      setResult({ ok: true, msg: "已清除" });
      setValue("");
      onSaved?.();
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
      const msg = await invoke<string>("test_key", { kind, key: value });
      setResult({ ok: true, msg });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        {title}
        {configured && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-600">
            已配置
          </span>
        )}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={configured && !value ? `已配置，输入新密钥可覆盖` : placeholder}
          className="flex-1"
        />
        <Button variant="outline" onClick={() => setShow((v) => !v)} className="shrink-0">
          {show ? "隐藏" : "显示"}
        </Button>
        <Button variant="outline" onClick={testKey} disabled={busy} className="shrink-0">
          测试
        </Button>
        <Button onClick={applyKey} disabled={busy || !value} className="shrink-0">
          应用
        </Button>
        <Button
          variant="ghost"
          onClick={clearKey}
          disabled={busy || !configured}
          className="shrink-0"
        >
          清空
        </Button>
      </div>
      {result && (
        <p className={result.ok ? "text-xs text-emerald-600" : "text-xs text-orange-600"}>
          {result.msg}
        </p>
      )}
    </div>
  );
}

export function QuotaSettings({ onRefresh }: { onRefresh: () => void }) {
  const [s, setS] = useState<QuotaSettings | null>(null);

  useEffect(() => {
    invoke<QuotaSettings>("get_settings").then(setS).catch(console.error);
  }, []);

  const set = (patch: Partial<QuotaSettings>) => {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    invoke("save_settings", { settings: next }).then(onRefresh).catch(console.error);
  };

  const toggleFloat = (show: boolean) => {
    set({ float_enabled: show });
    WebviewWindow.getByLabel("quota_float").then((w) => {
      if (show) {
        w?.show();
        w?.setFocus();
      } else {
        w?.hide();
      }
    });
  };

  const reloadSettings = () => {
    invoke<QuotaSettings>("get_settings").then(setS).catch(console.error);
  };

  if (!s) return <div className="p-6 text-sm text-muted-foreground">加载中...</div>;

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">密钥</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <KeyField
            kind="deepseek"
            title="DeepSeek API 密钥"
            placeholder="sk-..."
            configured={s.ds_configured}
            onSaved={reloadSettings}
          />
          <Separator />
          <KeyField
            kind="go"
            title="OpenCode Go 密钥"
            placeholder="留空自动使用本机 opencode 登录凭据"
            configured={s.go_configured}
            onSaved={reloadSettings}
          />
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
              <div className="text-xs text-muted-foreground">余额低于此值标红并提醒</div>
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
              <div className="text-sm font-medium">余额不足通知</div>
              <div className="text-xs text-muted-foreground">跌破阈值时提醒一次</div>
            </div>
            <Switch checked={s.notify_low} onCheckedChange={(v) => set({ notify_low: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">消费突增通知</div>
              <div className="text-xs text-muted-foreground">今日消费超近7天日均3倍时提醒</div>
            </div>
            <Switch checked={s.notify_surge} onCheckedChange={(v) => set({ notify_surge: v })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">悬浮窗</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">显示悬浮窗</div>
              <div className="text-xs text-muted-foreground">桌面常驻显示当前额度</div>
            </div>
            <Switch checked={s.float_enabled} onCheckedChange={toggleFloat} />
          </div>
          <Separator />
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>字号</span>
              <span className="text-muted-foreground">{s.font_size}</span>
            </div>
            <Slider
              min={12}
              max={48}
              value={[s.font_size]}
              onValueChange={([v]) => set({ font_size: v })}
            />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>整体透明度</span>
              <span className="text-muted-foreground">{s.opacity}%</span>
            </div>
            <Slider
              min={30}
              max={100}
              value={[s.opacity]}
              onValueChange={([v]) => set({ opacity: v })}
            />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>鼠标离开暗度</span>
              <span className="text-muted-foreground">{s.dim_level}%</span>
            </div>
            <Slider
              min={10}
              max={100}
              value={[s.dim_level]}
              onValueChange={([v]) => set({ dim_level: v })}
            />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>圆角</span>
              <span className="text-muted-foreground">{s.corner_radius}</span>
            </div>
            <Slider
              min={0}
              max={30}
              value={[s.corner_radius]}
              onValueChange={([v]) => set({ corner_radius: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">锁定穿透</div>
              <div className="text-xs text-muted-foreground">鼠标事件穿透悬浮窗，不影响下层操作</div>
            </div>
            <Switch
              checked={s.lock_passthrough}
              onCheckedChange={(v) => set({ lock_passthrough: v })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}