import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "@/components/layout/Sidebar";
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
import { SettingsView } from "@/components/settings-view";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { applyTheme } from "@/lib/theme";
import { checkForUpdate } from "@/lib/api";
import { useWindowEntrance } from "@/lib/use-window-entrance";

// 诊断插桩：记录各页面分包的加载耗时/失败（写入 easytool.log）
const loadPage =
  (
    name: string,
    loader: () => Promise<{ default: React.ComponentType<any> }>,
  ) =>
  async () => {
    const t0 = Date.now();
    try {
      const m = await loader();
      invoke("log_frontend", {
        level: "info",
        msg: `[chunk] ${name} loaded in ${Date.now() - t0}ms`,
      }).catch(() => {});
      return m;
    } catch (e) {
      invoke("log_frontend", {
        level: "error",
        msg: `[chunk] ${name} FAILED: ${e}`,
      }).catch(() => {});
      throw e;
    }
  };

const importClipboard = () =>
  import("@/modules/clipboard/Clippage").then(m => ({ default: m.Clippage }));
const importQuota = () =>
  import("@/modules/quota/QuotaPage").then(m => ({ default: m.QuotaPage }));
const importEmoji = () =>
  import("@/modules/emoji/Page").then(m => ({ default: m.EmojiPage }));
const importSearch = () =>
  import("@/modules/search/Page").then(m => ({ default: m.SearchPage }));
const importTimetracker = () =>
  import("@/modules/timetracker/Page").then(m => ({ default: m.TimetrackerPage }));

const Clippage = lazy(loadPage("clipboard", importClipboard));
const QuotaPage = lazy(loadPage("quota", importQuota));
const EmojiPage = lazy(loadPage("emoji", importEmoji));
const SearchPage = lazy(loadPage("search", importSearch));
const TimetrackerPage = lazy(loadPage("timetracker", importTimetracker));

// 首屏就绪前预载全部模块代码：与上方 lazy 共用同一 import（命中缓存，无额外请求），
// 保证主窗口显示时落地面板代码已就位
const PAGE_IMPORTS = [importClipboard, importQuota, importEmoji, importSearch, importTimetracker];

function App() {
  const entranceRef = useWindowEntrance(true, ["animate-in", "fade-in-0", "zoom-in-95"]);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  // 落地面板 = 设置排序第一位且启用的模块；初始留空，待模块清单就绪后由下方 effect 选定
  const [active, setActive] = useState<string>("");
  // keep-alive：已访问过的模块保留在 DOM（切换时显隐，不卸载重建，避免切页卡顿）
  const [visited, setVisited] = useState<Set<string>>(() => new Set());

  const selectModule = useCallback((id: string) => {
    setActive(id);
    if (id !== "settings") {
      setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    }
  }, []);
  const [notice, setNotice] = useState<string | null>(null);
  const [updateBanner, setUpdateBanner] = useState<{ version: string; notes: string } | null>(null);

  useEffect(() => {
    invoke("log_frontend", { level: "info", msg: "[diag] app mounted" }).catch(
      () => {},
    );
    Promise.all([getManifests(), getConfig()])
      .then(async ([m, c]) => {
        setManifests(m);
        setConfig(c);
        // 预载模块代码 + 等两帧（主题应用、首帧绘制完成）→ 通知 Rust 显示主窗口，
        // 窗口出现瞬间即完整内容（15s 后端兜底防前端异常永不显示）
        await Promise.allSettled(PAGE_IMPORTS.map(importPage => importPage()));
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            invoke("main_window_ready").catch(() => {});
          }),
        );
        invoke("log_frontend", {
          level: "info",
          msg: "[diag] bootstrap done",
        }).catch(() => {});
        // 后台静默检查更新（不阻塞启动），有新版本时显示顶部横幅
        checkForUpdate()
          .then((update) => {
            if (update) {
              setUpdateBanner({ version: update.version, notes: update.notes ?? "" });
            }
          })
          .catch(() => {});
      })
      .catch(e => {
        console.error(e);
        invoke("log_frontend", {
          level: "error",
          msg: `[diag] bootstrap failed: ${e}`,
        }).catch(() => {});
      });
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
    let prev: string[] = [];
    try {
      prev = JSON.parse(localStorage.getItem("easytool_migrated") || "[]");
    } catch {
      // localStorage 被写入非法 JSON 时不再中断渲染
    }
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

  // 模块禁用后从 keep-alive 卸载（不再空跑 effect/监听）；当前停在被禁用模块时回退到首个可用模块
  useEffect(() => {
    // 清单未就绪时跳过（空 ids 会把 visited 全部误剪掉且之后永不回填，首屏空白根因）；
    // 判断依据必须是「清单是否就绪」而非「启用列表是否为空」——全部禁用是合法状态，照常清理
    if (!orderedManifests.length) return;
    const ids = new Set(enabledModules.map((m) => m.id));
    setVisited((prev) => {
      // 名单为空（启动首次就绪/全部禁用后重新启用）→ 补入排序第一位且启用的模块，
      // 保证落地面板的组件会挂载
      if (prev.size === 0 && enabledModules.length) return new Set([enabledModules[0].id]);
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setActive((cur) =>
      cur !== "settings" && !ids.has(cur) ? (enabledModules[0]?.id ?? "clipboard") : cur,
    );
  }, [enabledModules]);

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
          <EmojiPage active={active === "emoji"} />
        </div>
      )}
      {visited.has("search") && (
        <div className={active === "search" ? "h-full" : "hidden"}>
          <SearchPage />
        </div>
      )}
      {visited.has("timetracker") && (
        <div className={active === "timetracker" ? "h-full" : "hidden"}>
          <TimetrackerPage />
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
          {updateBanner && (
            <div className="flex items-center justify-between border-b bg-amber-500/10 px-4 py-2 text-sm">
              <span>
                新版本 v{updateBanner.version} 可用
                {updateBanner.notes && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {updateBanner.notes.slice(0, 80)}
                    {updateBanner.notes.length > 80 ? "..." : ""}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    checkForUpdate().then((u) => u?.downloadAndInstall());
                    setUpdateBanner(null);
                  }}
                  className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:bg-primary/90"
                >
                  下载更新
                </button>
                <button
                  onClick={() => setUpdateBanner(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  忽略
                </button>
              </div>
            </div>
          )}
          <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              }
            >
              {/* 模块 DOM 常驻（keep-alive）：切换到设置页时隐藏但不卸载，
                  回来时不重新挂载、不重拉数据、不丢滚动位置 */}
              <div className={active === "settings" ? "hidden" : "h-full"}>
                <ErrorBoundary>
                  {renderModules()}
                </ErrorBoundary>
              </div>
            </Suspense>
            {active === "settings" && (
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
            )}
        </main>
        <Sidebar modules={enabledModules} active={active} onSelect={selectModule} />
      </div>
    </div>
  );
}

export default App;
