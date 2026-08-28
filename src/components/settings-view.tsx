import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bot, Clipboard, Gauge, Smile, Search, ExternalLink } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { SettingRow } from "@/components/setting-row";
import type { AppConfig, Manifest } from "@/lib/api";
import { checkForUpdate } from "@/lib/api";

const GITHUB_ISSUES = "https://github.com/Aliboder/EasyTool/issues";

const MODULE_ICONS: Record<string, typeof Clipboard> = {
  gauge: Gauge,
  smile: Smile,
  search: Search,
  bot: Bot,
};

function SortableModuleCard({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        willChange: "transform",
      }}
      className={cn(
        "flex cursor-grab items-center justify-between gap-2 rounded-lg border p-3.5 transition-colors active:cursor-grabbing",
        isDragging ? "z-10 opacity-70" : "hover:bg-accent/50"
      )}
    >
      {children}
    </div>
  );
}

export function SettingsView({
  config,
  manifests,
  onToggle,
  onReorder,
  onThemeChange,
  onMainHotkey,
  onMainFollowMouse,
}: {
  config: AppConfig;
  manifests: Manifest[];
  onToggle: (id: string, enabled: boolean) => void;
  onReorder: (ids: string[]) => Promise<void>;
  onThemeChange: (theme: string) => void;
  onMainHotkey: (hotkey: string) => Promise<void>;
  onMainFollowMouse: (enabled: boolean) => Promise<void>;
}) {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "latest" | "error" | "downloading"
  >("idle");
  const [updateVersion, setUpdateVersion] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");
  const [updateProgress, setUpdateProgress] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = manifests.findIndex((m) => m.id === active.id);
    const newIdx = manifests.findIndex((m) => m.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onReorder(arrayMove(manifests, oldIdx, newIdx).map((m) => m.id));
  };

  useEffect(() => {
    invoke<boolean>("plugin:autostart|is_enabled")
      .then(setAutostart)
      .catch(() => setAutostart(false));
    getVersion().then(setVersion).catch(console.error);
  }, []);

  const handleCheckUpdate = async () => {
    setUpdateStatus("checking");
    try {
      const update = await checkForUpdate();
      if (update) {
        setUpdateVersion(update.version);
        setUpdateNotes(update.notes ?? "");
        setUpdateStatus("available");
      } else {
        setUpdateStatus("latest");
      }
    } catch (e) {
      console.error("update check failed", e);
      setUpdateStatus("error");
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdateStatus("downloading");
    setUpdateProgress("正在下载...");
    try {
      const update = await checkForUpdate();
      if (update) {
        await update.downloadAndInstall();
        setUpdateProgress("下载完成，重启应用后生效");
      }
    } catch (e) {
      console.error("update download failed", e);
      setUpdateStatus("error");
      setUpdateProgress(String(e));
    }
  };

  const toggleAutostart = async (v: boolean) => {
    try {
      if (v) await invoke("plugin:autostart|enable");
      else await invoke("plugin:autostart|disable");
      setAutostart(v);
    } catch (e) {
      console.error("autostart toggle failed", e);
    }
  };

  const enabledCount = manifests.filter((m) => Boolean(config.modules[m.id]?.enabled)).length;

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">设置</h2>
        <p className="text-sm text-muted-foreground">
          管理功能模块与全局选项 · {manifests.length} 个模块，{enabledCount} 个已启用
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>功能模块</CardTitle>
          <CardDescription>拖动手柄调整顺序，底部栏显示已启用的模块</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={manifests.map((m) => m.id)} strategy={verticalListSortingStrategy}>
              {manifests.map((m) => {
                const enabled = Boolean(config.modules[m.id]?.enabled);
                const Icon = MODULE_ICONS[m.icon] ?? Clipboard;
                return (
                  <SortableModuleCard key={m.id} id={m.id}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{m.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.description || `ID: ${m.id}`}
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => onToggle(m.id, v)}
                      aria-label={`启用${m.name}`}
                    />
                  </SortableModuleCard>
                );
              })}
            </SortableContext>
          </DndContext>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>窗口与呼出</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="全局呼出热键" hint="按此热键呼出 / 隐藏主窗口">
            <HotkeyRecorder
              value={(config.hotkeys.main as string) ?? "Ctrl+Shift+E"}
              onSave={async (combo) => {
                try {
                  await onMainHotkey(combo);
                } catch (e) {
                  return String(e);
                }
              }}
            />
          </SettingRow>
          <SettingRow title="呼出窗口跟随鼠标" hint="呼出时窗口出现在鼠标附近，否则停留在上次位置">
            <Switch
              checked={Boolean(config.main_follow_mouse)}
              onCheckedChange={(v) => onMainFollowMouse(v)}
            />
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>通用</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="开机自启动" hint="登录 Windows 后自动启动 EasyTool">
            <Switch
              checked={autostart ?? false}
              disabled={autostart === null}
              onCheckedChange={toggleAutostart}
            />
          </SettingRow>
          <SettingRow title="主题" hint="界面配色方案">
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
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>关于</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium">EasyTool 工具箱</span>
            <span className="text-xs text-muted-foreground">v{version}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium">检查更新</span>
            {updateStatus === "idle" && (
              <button
                onClick={handleCheckUpdate}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                检查新版本
              </button>
            )}
            {updateStatus === "checking" && (
              <span className="text-xs text-muted-foreground">检查中...</span>
            )}
            {updateStatus === "latest" && (
              <span className="text-xs text-green-500">已是最新版本</span>
            )}
            {updateStatus === "available" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-500">v{updateVersion} 可用</span>
                <button
                  onClick={handleDownloadUpdate}
                  className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:bg-primary/90"
                >
                  下载更新
                </button>
              </div>
            )}
            {updateStatus === "downloading" && (
              <span className="text-xs text-muted-foreground">{updateProgress}</span>
            )}
            {updateStatus === "error" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-destructive">检查失败</span>
                <button
                  onClick={handleCheckUpdate}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  重试
                </button>
              </div>
            )}
          </div>
          {updateNotes && updateStatus === "available" && (
            <div className="rounded-md bg-secondary/50 p-2 text-xs text-muted-foreground">
              {updateNotes}
            </div>
          )}
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium">反馈建议</span>
            <button
              onClick={() => openUrl(GITHUB_ISSUES)}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              GitHub Issues
              <ExternalLink className="size-3" />
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
