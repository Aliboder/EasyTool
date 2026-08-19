import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "@/components/layout/Sidebar";
import {
  getConfig,
  getManifests,
  setModuleEnabled,
  setTheme,
  setUnifiedHotkey,
  setMainHotkey,
  setMainFollowMouse,
  saveMainSize,
  type AppConfig,
  type Manifest,
} from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Clipboard, Gauge, Smile } from "lucide-react";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { applyTheme } from "@/lib/theme";
import { useWindowEntrance } from "@/lib/use-window-entrance";

const Clippage = lazy(() => import("@/modules/clipboard/Clippage").then(m => ({ default: m.Clippage })));
const QuotaPage = lazy(() => import("@/modules/quota/QuotaPage").then(m => ({ default: m.QuotaPage })));
const EmojiPage = lazy(() => import("@/modules/emoji/Page").then(m => ({ default: m.EmojiPage })));

function SettingsView({
  config,
  manifests,
  onToggle,
  onThemeChange,
  onUnifiedChange,
  onMainHotkey,
  onMainFollowMouse,
}: {
  config: AppConfig;
  manifests: Manifest[];
  onToggle: (id: string, enabled: boolean) => void;
  onThemeChange: (theme: string) => void;
  onUnifiedChange: (enabled: boolean) => void;
  onMainHotkey: (hotkey: string) => Promise<void>;
  onMainFollowMouse: (enabled: boolean) => Promise<void>;
}) {
  const [autostart, setAutostart] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<boolean>("plugin:autostart|is_enabled")
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);

  const toggleAutostart = async (v: boolean) => {
    try {
      if (v) await invoke("plugin:autostart|enable");
      else await invoke("plugin:autostart|disable");
      setAutostart(v);
    } catch (e) {
      console.error("autostart toggle failed", e);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">设置</h2>
        <p className="text-sm text-muted-foreground">管理功能模块与全局选项</p>
      </div>

      <div className="space-y-4">
        {manifests.map((m) => {
          const enabled = Boolean(config.modules[m.id]?.enabled);
          return (
            <div key={m.id} className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-secondary">
                  {m.icon === "gauge" ? (
                    <Gauge className="size-4" />
                  ) : m.icon === "smile" ? (
                    <Smile className="size-4" />
                  ) : (
                    <Clipboard className="size-4" />
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">ID: {m.id}</div>
                </div>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(v) => onToggle(m.id, v)}
                aria-label={`启用${m.name}`}
              />
            </div>
          );
        })}
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">统一呼出主窗口</div>
          <div className="text-xs text-muted-foreground">
            开启后只保留主窗口呼出热键，各模块独立热键全部禁用
          </div>
        </div>
        <Switch
          checked={Boolean(config.unified_hotkey)}
          onCheckedChange={onUnifiedChange}
          aria-label="统一呼出主窗口"
        />
      </div>

      {Boolean(config.unified_hotkey) && (
        <>
          <div className="space-y-1">
            <Label htmlFor="main-hotkey">全局呼出热键</Label>
            <HotkeyRecorder
              value={(config.hotkeys.main as string) ?? "Ctrl+Shift+E"}
              onSave={async (combo) => {
                try {
                  await onMainHotkey(combo);
                } catch (e) {
                  return String(e);
                }
              }}
              hint="统一呼出模式下，此热键呼出主窗口"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">呼出窗口跟随鼠标</div>
              <div className="text-xs text-muted-foreground">
                呼出时窗口出现在鼠标附近，否则停留在上次位置
              </div>
            </div>
            <Switch
              checked={Boolean(config.main_follow_mouse)}
              onCheckedChange={(v) => onMainFollowMouse(v)}
            />
          </div>
        </>
      )}

      <Separator />

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">开机自启动</div>
          <div className="text-xs text-muted-foreground">登录 Windows 后自动启动 EasyTool</div>
        </div>
        <Switch checked={autostart ?? false} onCheckedChange={toggleAutostart} />
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <Label htmlFor="theme" className="text-sm font-medium">
          主题
        </Label>
        <Select value={config.theme} onValueChange={onThemeChange}>
          <SelectTrigger id="theme" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dark">深色</SelectItem>
            <SelectItem value="light">浅色</SelectItem>
            <SelectItem value="system">跟随系统</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function App() {
  const entranceRef = useWindowEntrance(true, ["animate-in", "fade-in-0", "zoom-in-95"]);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [active, setActive] = useState<string>("clipboard");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getManifests().then(setManifests).catch(console.error);
    getConfig().then(setConfig).catch(console.error);
  }, []);

  useEffect(() => {
    if (config) applyTheme(config.theme);
  }, [config]);

  // 记住主窗口尺寸：调整后防抖保存，重启恢复
  // 过滤 0/极小尺寸：窗口隐藏/最小化时 WebView2 会报 0x0，存进配置会导致下次启动窗口极小
  useEffect(() => {
    const win = getCurrentWindow();
    let t: number | null = null;
    const un = win.onResized(({ payload }) => {
      if (t) window.clearTimeout(t);
      if (payload.width < 400 || payload.height < 300) return; // 与 tauri.conf.json 的 minWidth/minHeight 一致
      t = window.setTimeout(() => {
        saveMainSize(payload.width, payload.height).catch(console.error);
      }, 400);
    });
    return () => {
      un.then((fn) => fn());
      if (t) window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    const prev: string[] = JSON.parse(localStorage.getItem("easytool_migrated") || "[]");
    const cur = config.migrated ?? [];
    if (cur.includes("clipboard") && !prev.includes("clipboard")) {
      setNotice("已从旧版 PasteBoard 导入剪贴板历史记录");
    }
    localStorage.setItem("easytool_migrated", JSON.stringify(cur));
  }, [config]);

  const enabledModules = useMemo(
    () =>
      manifests
        .filter((m) => config?.modules[m.id]?.enabled !== false)
        .map((m) => ({ id: m.id, name: m.name, icon: m.icon })),
    [manifests, config],
  );

  const toggleModule = async (id: string, enabled: boolean) => {
    await setModuleEnabled(id, enabled);
    setConfig(await getConfig());
  };

  const changeTheme = async (theme: string) => {
    await setTheme(theme);
    setConfig(await getConfig());
  };

  const changeUnified = async (enabled: boolean) => {
    await setUnifiedHotkey(enabled);
    setConfig(await getConfig());
  };

  const changeMainHotkey = async (hotkey: string) => {
    await setMainHotkey(hotkey);
    setConfig(await getConfig());
  };

  const changeMainFollowMouse = async (enabled: boolean) => {
    await setMainFollowMouse(enabled);
    setConfig(await getConfig());
  };

  if (!config) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  const activeModule = enabledModules.find((m) => m.id === active);

  const renderModule = () => {
    if (!activeModule) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          请先在设置中启用模块
        </div>
      );
    }
    return (
      <Suspense fallback={
        <div className="flex h-full items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }>
        {(() => {
          switch (activeModule.id) {
            case "clipboard":
              return <Clippage popup={false} />;
            case "quota":
              return <QuotaPage />;
            case "emoji":
              return <EmojiPage />;
            default:
              return (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {activeModule.name}模块页面（建设中）
                </div>
              );
          }
        })()}
      </Suspense>
    );
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div
        ref={entranceRef}
        className="flex h-full min-h-0 flex-1 flex-col animate-in fade-in-0 zoom-in-95 duration-150"
      >
        <main key={active} className="flex-1 overflow-y-auto animate-in fade-in-0 slide-in-from-right-2 duration-150">
          {notice && (
            <div className="flex items-center justify-between border-b bg-secondary/50 px-4 py-2 text-sm">
              <span>{notice}</span>
              <button
                onClick={() => setNotice(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                关闭
              </button>
            </div>
          )}
          {active === "settings" ? (
            <SettingsView
              config={config}
              manifests={manifests}
              onToggle={toggleModule}
              onThemeChange={changeTheme}
              onUnifiedChange={changeUnified}
              onMainHotkey={changeMainHotkey}
              onMainFollowMouse={changeMainFollowMouse}
            />
          ) : (
            renderModule()
          )}
        </main>
        <Sidebar modules={enabledModules} active={active} onSelect={setActive} />
      </div>
    </div>
  );
}

export default App;