import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "@/components/layout/Sidebar";
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
import {
  getConfig,
  getManifests,
  setModuleEnabled,
  setModuleOrder,
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
import { Clipboard, Gauge, Smile, Search, GripVertical } from "lucide-react";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { applyTheme } from "@/lib/theme";
import { useWindowEntrance } from "@/lib/use-window-entrance";

const Clippage = lazy(() => import("@/modules/clipboard/Clippage").then(m => ({ default: m.Clippage })));
const QuotaPage = lazy(() => import("@/modules/quota/QuotaPage").then(m => ({ default: m.QuotaPage })));
const EmojiPage = lazy(() => import("@/modules/emoji/Page").then(m => ({ default: m.EmojiPage })));
const SearchPage = lazy(() => import("@/modules/search/Page").then(m => ({ default: m.SearchPage })));

function SortableModuleCard({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-70")}
    >
      <div className="flex items-center justify-between gap-2 rounded-lg border p-4">
        <button
          {...attributes}
          {...listeners}
          aria-label="拖动排序"
          title="拖动排序"
          className="cursor-grab rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

function SettingsView({
  config,
  manifests,
  onToggle,
  onReorder,
  onThemeChange,
  onUnifiedChange,
  onMainHotkey,
  onMainFollowMouse,
}: {
  config: AppConfig;
  manifests: Manifest[];
  onToggle: (id: string, enabled: boolean) => void;
  onReorder: (ids: string[]) => Promise<void>;
  onThemeChange: (theme: string) => void;
  onUnifiedChange: (enabled: boolean) => void;
  onMainHotkey: (hotkey: string) => Promise<void>;
  onMainFollowMouse: (enabled: boolean) => Promise<void>;
}) {
  const [autostart, setAutostart] = useState<boolean | null>(null);

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

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">功能模块</h3>
        <span className="text-xs text-muted-foreground">拖动手柄调整排序</span>
      </div>

      <div className="space-y-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={manifests.map((m) => m.id)} strategy={verticalListSortingStrategy}>
            {manifests.map((m) => {
              const enabled = Boolean(config.modules[m.id]?.enabled);
              return (
                <SortableModuleCard key={m.id} id={m.id}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                      {m.icon === "gauge" ? (
                        <Gauge className="size-4" />
                      ) : m.icon === "smile" ? (
                        <Smile className="size-4" />
                      ) : m.icon === "search" ? (
                        <Search className="size-4" />
                      ) : (
                        <Clipboard className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{m.name}</div>
                      <div className="text-xs text-muted-foreground">ID: {m.id}</div>
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
  // keep-alive：已访问过的模块保留在 DOM（切换时显隐，不卸载重建，避免切页卡顿）
  const [visited, setVisited] = useState<Set<string>>(() => new Set(["clipboard"]));

  const selectModule = useCallback((id: string) => {
    setActive(id);
    if (id !== "settings") {
      setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    }
  }, []);
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

  // 按 config.module_order 排序；未收录的模块按 manifest 顺序补末尾
  const orderedManifests = useMemo(() => {
    const order = config?.module_order ?? [];
    const byId = new Map(manifests.map((m) => [m.id, m]));
    const ordered = order.map((id) => byId.get(id)).filter((m): m is Manifest => !!m);
    const seen = new Set(ordered.map((m) => m.id));
    return [...ordered, ...manifests.filter((m) => !seen.has(m.id))];
  }, [manifests, config?.module_order]);

  const enabledModules = useMemo(
    () =>
      orderedManifests
        .filter((m) => config?.modules[m.id]?.enabled !== false)
        .map((m) => ({ id: m.id, name: m.name, icon: m.icon })),
    [orderedManifests, config],
  );

  const toggleModule = async (id: string, enabled: boolean) => {
    await setModuleEnabled(id, enabled);
    setConfig(await getConfig());
  };

  const reorderModules = async (ids: string[]) => {
    await setModuleOrder(ids);
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

  const renderModules = () => (
    <div className="relative h-full">
      {visited.has("clipboard") && (
        <div className={active === "clipboard" ? "h-full" : "hidden"}>
          <Clippage popup={false} />
        </div>
      )}
      {visited.has("quota") && (
        <div className={active === "quota" ? "h-full" : "hidden"}>
          <QuotaPage />
        </div>
      )}
      {visited.has("emoji") && (
        <div className={active === "emoji" ? "h-full" : "hidden"}>
          <EmojiPage />
        </div>
      )}
      {visited.has("search") && (
        <div className={active === "search" ? "h-full" : "hidden"}>
          <SearchPage />
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div
        ref={entranceRef}
        className="flex h-full min-h-0 flex-1 flex-col animate-in fade-in-0 zoom-in-95 duration-150"
      >
        <main className="flex-1 overflow-y-auto">
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
              manifests={orderedManifests}
              onToggle={toggleModule}
              onReorder={reorderModules}
              onThemeChange={changeTheme}
              onUnifiedChange={changeUnified}
              onMainHotkey={changeMainHotkey}
              onMainFollowMouse={changeMainFollowMouse}
            />
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              }
            >
              {renderModules()}
            </Suspense>
          )}
        </main>
        <Sidebar modules={enabledModules} active={active} onSelect={selectModule} />
      </div>
    </div>
  );
}

export default App;