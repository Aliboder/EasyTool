import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect } from "react";
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
import { SettingRow } from "@/components/setting-row";

interface QuicklaunchSettings {
  view_mode: "grid" | "list";
  sort_by: "name" | "created_at" | "manual";
  sort_desc: boolean;
  grid_size: number;
  single_click_open: boolean;
  show_extension: boolean;
}

const defaultSettings: QuicklaunchSettings = {
  view_mode: "grid",
  sort_by: "manual",
  sort_desc: false,
  grid_size: 64,
  single_click_open: false,
  show_extension: true,
};

interface QuicklaunchSettingsProps {
  onRefresh?: () => void;
  onSettingsChange?: (settings: QuicklaunchSettings) => void;
}

export function QuicklaunchSettings({ onRefresh, onSettingsChange }: QuicklaunchSettingsProps) {
  const [settings, setSettings] = useState<QuicklaunchSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const config = await invoke<{ modules?: Record<string, Record<string, unknown>> }>("get_config");
      const moduleConfig = config?.modules?.quicklaunch;
      if (moduleConfig) {
        setSettings({
          view_mode: (moduleConfig.view_mode as "grid" | "list") || defaultSettings.view_mode,
          sort_by: (moduleConfig.sort_by as "name" | "created_at" | "manual") || defaultSettings.sort_by,
          sort_desc: (moduleConfig.sort_desc as boolean) ?? defaultSettings.sort_desc,
          grid_size: (moduleConfig.grid_size as number) || defaultSettings.grid_size,
          single_click_open: (moduleConfig.single_click_open as boolean) ?? defaultSettings.single_click_open,
          show_extension: (moduleConfig.show_extension as boolean) ?? defaultSettings.show_extension,
        });
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (patch: Partial<QuicklaunchSettings>) => {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    onSettingsChange?.(updated);
    try {
      await invoke("save_quicklaunch_settings", { settings: updated });
      onRefresh?.();
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        加载设置中...
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">显示</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="默认视图" hint="选择网格或列表视图">
            <div className="flex gap-1">
              {(
                [
                  ["grid", "网格"],
                  ["list", "列表"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => saveSettings({ view_mode: id })}
                  className={`rounded-md border px-3 py-1 text-xs ${
                    settings.view_mode === id
                      ? "border-primary text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </SettingRow>
          {settings.view_mode === "grid" && (
            <SettingRow title="网格大小" hint="调节图标卡片尺寸">
              <div className="flex w-40 items-center gap-2">
                <Slider
                  min={48}
                  max={96}
                  step={8}
                  value={[settings.grid_size]}
                  onValueChange={([v]) => {
                    setSettings({ ...settings, grid_size: v });
                    saveSettings({ grid_size: v });
                  }}
                />
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {settings.grid_size}px
                </span>
              </div>
            </SettingRow>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">行为</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="默认排序" hint="选择排序方式">
            <Select
              value={settings.sort_by}
              onValueChange={(v) => {
                saveSettings({ sort_by: v as "name" | "created_at" | "manual" });
                // 排序方式变化后需要重新加载数据
                setTimeout(() => onRefresh?.(), 100);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">手动排序</SelectItem>
                <SelectItem value="name">按名称</SelectItem>
                <SelectItem value="created_at">按添加时间</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow title="单击打开" hint="开启后单击即可打开项目">
            <Switch
              checked={settings.single_click_open}
              onCheckedChange={(checked) => saveSettings({ single_click_open: checked })}
            />
          </SettingRow>
          <SettingRow title="显示文件后缀名" hint="开启后显示文件扩展名">
            <Switch
              checked={settings.show_extension}
              onCheckedChange={(checked) => saveSettings({ show_extension: checked })}
            />
          </SettingRow>
        </CardContent>
      </Card>
    </div>
  );
}