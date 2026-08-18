import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import {
  getConfig,
  getManifests,
  setModuleEnabled,
  setTheme,
  setUnifiedHotkey,
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
import { Clipboard, Gauge } from "lucide-react";
import { Clippage } from "@/modules/clipboard/Clippage";
import { ClipSettings } from "@/modules/clipboard/ClipSettings";

function applyTheme(theme: string) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function SettingsView({
  config,
  manifests,
  onToggle,
  onThemeChange,
  onUnifiedChange,
  onConfigRefresh,
}: {
  config: AppConfig;
  manifests: Manifest[];
  onToggle: (id: string, enabled: boolean) => void;
  onThemeChange: (theme: string) => void;
  onUnifiedChange: (enabled: boolean) => void;
  onConfigRefresh: () => void;
}) {
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
        <p className="text-xs text-muted-foreground">
          当前全局呼出热键：Ctrl+Shift+E
        </p>
      )}

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

      {Boolean(config.modules.clipboard?.enabled) && (
        <>
          <Separator />
          <div>
            <h3 className="mb-2 text-sm font-semibold">剪贴板设置</h3>
            <ClipSettings
              maxItems={(config.modules.clipboard?.max_items as number) ?? 500}
              hotkey={(config.modules.clipboard?.hotkey as string) ?? "Ctrl+Shift+V"}
              onMaxItems={onConfigRefresh}
              onHotkey={onConfigRefresh}
            />
          </div>
        </>
      )}
    </div>
  );
}

function App() {
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [active, setActive] = useState<string>("clipboard");

  useEffect(() => {
    getManifests().then(setManifests).catch(console.error);
    getConfig().then(setConfig).catch(console.error);
  }, []);

  useEffect(() => {
    if (config) applyTheme(config.theme);
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

  if (!config) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  const activeModule = enabledModules.find((m) => m.id === active);

  const updateClipMaxItems = async () => {
    setConfig(await getConfig());
  };

  const renderModule = () => {
    if (!activeModule) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          请先在设置中启用模块
        </div>
      );
    }
    switch (activeModule.id) {
      case "clipboard":
        return <Clippage popup={false} />;
      default:
        return (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {activeModule.name}模块页面（建设中）
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar modules={enabledModules} active={active} onSelect={setActive} />
      <main className="flex-1 overflow-y-auto">
        {active === "settings" ? (
          <SettingsView
            config={config}
            manifests={manifests}
            onToggle={toggleModule}
            onThemeChange={changeTheme}
            onUnifiedChange={changeUnified}
            onConfigRefresh={updateClipMaxItems}
          />
        ) : (
          renderModule()
        )}
      </main>
    </div>
  );
}

export default App;