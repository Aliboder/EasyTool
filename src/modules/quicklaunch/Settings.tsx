import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface QuicklaunchSettings {
  view_mode: "grid" | "list";
  sort_by: "name" | "created_at" | "manual";
  sort_desc: boolean;
  grid_size: number;
  single_click_open: boolean;
}

const defaultSettings: QuicklaunchSettings = {
  view_mode: "grid",
  sort_by: "manual",
  sort_desc: false,
  grid_size: 64,
  single_click_open: false,
};

interface QuicklaunchSettingsProps {
  onRefresh?: () => void;
}

export function QuicklaunchSettings({ onRefresh }: QuicklaunchSettingsProps) {
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
        });
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (newSettings: Partial<QuicklaunchSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    try {
      await invoke("save_quicklaunch_settings", { settings: updated });
      onRefresh?.();
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
        加载设置中...
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2">
        <Label>默认视图</Label>
        <Select
          value={settings.view_mode}
          onValueChange={(value) => saveSettings({ view_mode: value as "grid" | "list" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="grid">网格视图</SelectItem>
            <SelectItem value="list">列表视图</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>默认排序</Label>
        <Select
          value={settings.sort_by}
          onValueChange={(value) => saveSettings({ sort_by: value as "name" | "created_at" | "manual" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">手动排序</SelectItem>
            <SelectItem value="name">按名称</SelectItem>
            <SelectItem value="created_at">按添加时间</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>网格图标大小</Label>
        <Select
          value={String(settings.grid_size)}
          onValueChange={(value) => saveSettings({ grid_size: Number(value) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="48">小 (48px)</SelectItem>
            <SelectItem value="64">中 (64px)</SelectItem>
            <SelectItem value="80">大 (80px)</SelectItem>
            <SelectItem value="96">特大 (96px)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="single-click">单击打开</Label>
        <Switch
          id="single-click"
          checked={settings.single_click_open}
          onCheckedChange={(checked) => saveSettings({ single_click_open: checked })}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        开启后单击即可打开项目，关闭则需双击打开
      </p>
    </div>
  );
}