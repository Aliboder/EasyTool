import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import {
  getBootstrap,
  getConfig,
  setModuleEnabled,
  setModuleOrder,
  setTheme,
  setMainHotkey,
  setMainFollowMouse,
  setCheckUpdateOnStart,
  saveMainSize,
  type AppConfig,
  type Manifest,
} from "@/lib/api";
import { SettingsView } from "@/components/settings-view";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { applyAccent, applyTheme, applyUiScale } from "@/lib/theme";
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

// 模块 id → 分包加载器：与上方 lazy 共用同一 import（命中缓存，无额外请求）
const PAGE_IMPORTS: Record<string, () => Promise<{ default: React.ComponentType<any> }>> = {
  clipboard: importClipboard,
  quota: importQuota,
  emoji: importEmoji,
  search: importSearch,
  timetracker: importTimetracker,
};

// 落地面板 = 排序第一位且启用的模块（与下方 enabledModules 同规则）
function landingModule(m: Manifest[], c: AppConfig): string | null {
  const byId = new Map(m.map((x) => [x.id, x]));
  const ordered = (c.module_order ?? [])
    .map((id) => byId.get(id))
    .filter((x): x is Manifest => !!x);
  const seen = new Set(ordered.map((x) => x.id));
  return (
    [...ordered, ...m.filter((x) => !seen.has(x.id))].find(
      (x) => c.modules[x.id]?.enabled !== false,
    )?.id ?? null
  );
}

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
      // 记住上次使用的模块：下次启动直接恢复
      localStorage.setItem("easytool_last_module", id);
    }
  }, []);
  const [notice, setNotice] = useState<string | null>(null);
  const [updateBanner, setUpdateBanner] = useState<{ version: string; notes: string } | null>(null);
  // 更新日志弹窗（横幅「更新内容」触发，拉取 GitHub Release body）
  const [updateNotes, setUpdateNotes] = useState<{ tag: string; published: string; body: string } | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);

  useEffect(() => {
    invoke("log_frontend", { level: "info", msg: "[diag] app mounted" }).catch(
      () => {},
    );
    getBootstrap()
      .then(async ({ manifests: m, config: c }) => {
        setManifests(m);
        setConfig(c);
        // 应用持久化的外观偏好（强调色 / 界面缩放）
        const storedAccent = localStorage.getItem("easytool_accent") as
          | "emerald"
          | "sky"
          | "violet"
          | "amber"
          | "";
        if (storedAccent) applyAccent(storedAccent);
        const storedScale = Number(localStorage.getItem("easytool_ui_scale"));
        if ([90, 100, 110, 120].includes(storedScale)) applyUiScale(storedScale);
        // 落地面板：优先恢复上次使用的模块（启用中才生效）
        const storedModule = localStorage.getItem("easytool_last_module");
        const landing =
          storedModule &&
          m.some((x) => x.id === storedModule) &&
          c.modules[storedModule]?.enabled !== false
            ? storedModule
            : landingModule(m, c);
        await Promise.allSettled(
          landing && PAGE_IMPORTS[landing] ? [PAGE_IMPORTS[landing]()] : [],
        );
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            invoke("main_window_ready").catch(() => {});
          }),
        );
        Promise.allSettled(
          Object.entries(PAGE_IMPORTS)
            .filter(([id]) => id !== landing)
            .map(([, importPage]) => importPage()),
        );
        invoke("log_frontend", {
          level: "info",
          msg: "[diag] bootstrap done",
        }).catch(() => {});
        // 后台静默检查更新（可设置关闭；不阻塞启动），有新版本时显示顶部横幅
        if (c.check_update_on_start !== false) {
          checkForUpdate()
            .then((update) => {
              if (update) {
                setUpdateBanner({ version: update.version, notes: update.notes ?? "" });
              }
            })
            .catch(() => {});
        }
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

  // 记住主窗口尺寸与位置：调整/移动后防抖保存，重启恢复（多显示器回到原位置）
  // 过滤 0/极小尺寸：窗口隐藏/最小化时 WebView2 会报 0x0/离屏坐标，存进配置会导致下次启动窗口异常
  useEffect(() => {
    const win = getCurrentWindow();
    let t: number | null = null;
    let size = { width: 0, height: 0 };
    const persist = () => {
      if (t) window.clearTimeout(t);
      if (size.width < 400 || size.height < 300) return; // 与 tauri.conf.json 的 minWidth/minHeight 一致
      win
        .outerPosition()
        .then((pos) => {
          if (pos.x < -32000 || pos.y < -32000) return; // 离屏坐标（隐藏/最小化）
          saveMainSize(size.width, size.height, pos.x, pos.y).catch(console.error);
        })
        .catch(console.error);
    };
    const unResize = win.onResized(({ payload }) => {
      size = { width: payload.width, height: payload.height };
      t = window.setTimeout(persist, 400);
    });
    const unMove = win.onMoved(() => {
      t = window.setTimeout(() => {
        win.innerSize().then((s) => {
          size = { width: s.width, height: s.height };
          persist();
        }).catch(console.error);
      }, 400);
    });
    return () => {
      unResize.then((fn) => fn());
      unMove.then((fn) => fn());
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

  // 托盘菜单快速入口：后端 emit tray://nav（打开剪贴板/时长统计）→ 切到对应模块页；
  // tray://check-update → 静默检查更新并展示横幅（与启动时逻辑一致）
  useEffect(() => {
    const unNav = listen<{ page: string }>("tray://nav", (e) => {
      const page = e.payload?.page;
      if (page && enabledModules.some((m) => m.id === page)) selectModule(page);
    });
    const unUpdate = listen("tray://check-update", () => {
      checkForUpdate()
        .then((u) => {
          if (u) setUpdateBanner({ version: u.version, notes: u.notes ?? "" });
        })
        .catch(() => {});
    });
    return () => {
      unNav.then((fn) => fn());
      unUpdate.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectModule, enabledModules]);

  // 模块禁用后从 keep-alive 卸载（不再空跑 effect/监听）；当前停在被禁用模块时回退到首个可用模块
  useEffect(() => {
    // 清单未就绪时跳过（空 ids 会把 visited 全部误剪掉且之后永不回填，首屏空白根因）；
    // 判断依据必须是「清单是否就绪」而非「启用列表是否为空」——全部禁用是合法状态，照常清理
    if (!orderedManifests.length) return;
    const ids = new Set(enabledModules.map((m) => m.id));
    // 初始选中偏好：上次使用的模块（仍在启用列表内才生效），否则回退到排序首位
    const stored = localStorage.getItem("easytool_last_module");
    const preferred =
      stored && ids.has(stored) ? stored : (enabledModules[0]?.id ?? "clipboard");
    setVisited((prev) => {
      // 名单为空（启动首次就绪/全部禁用后重新启用）→ 补入排序第一位且启用的模块，
      // 保证落地面板的组件会挂载
      if (prev.size === 0 && enabledModules.length) return new Set([preferred]);
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setActive((cur) =>
      cur !== "settings" && !ids.has(cur) ? (enabledModules[0]?.id ?? "clipboard") : cur,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const changeMainHotkey = async (hotkey: string) => {
    await setMainHotkey(hotkey);
    setConfig(await getConfig());
  };

  const changeMainFollowMouse = async (enabled: boolean) => {
    await setMainFollowMouse(enabled);
    setConfig(await getConfig());
  };

  const changeCheckUpdateOnStart = async (enabled: boolean) => {
    await setCheckUpdateOnStart(enabled);
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
          <Clippage />
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
          <TimetrackerPage active={active === "timetracker"} />
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
                    if (updateNotes) return;
                    setNotesLoading(true);
                    invoke<{ tag: string; published: string; body: string }>(
                      "github_latest_release",
                    )
                      .then((r) => setUpdateNotes(r))
                      .catch(() => {
                        invoke("log_frontend", {
                          level: "warn",
                          msg: "fetch release notes failed",
                        }).catch(() => {});
                      })
                      .finally(() => setNotesLoading(false));
                  }}
                  className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-400"
                >
                  {notesLoading ? "加载中…" : "更新内容"}
                </button>
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
                onMainHotkey={changeMainHotkey}
                onMainFollowMouse={changeMainFollowMouse}
                onCheckUpdateOnStart={changeCheckUpdateOnStart}
              />
            )}

            {updateNotes && (
              <div
                className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6"
                onClick={() => setUpdateNotes(null)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex max-h-[80%] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xl"
                >
                  <div className="flex items-center justify-between border-b px-5 py-3">
                    <div>
                      <div className="text-sm font-semibold">
                        更新内容 · {updateNotes.tag}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {updateNotes.tag}
                        {updateNotes.published ? ` · ${updateNotes.published.slice(0, 10)}` : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => setUpdateNotes(null)}
                      aria-label="关闭"
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="themed-scroll flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-4 text-xs leading-relaxed text-muted-foreground">
                    {updateNotes.body || "暂无更新说明"}
                  </div>
                </div>
              </div>
            )}
        </main>
        <Sidebar modules={enabledModules} active={active} onSelect={selectModule} />
      </div>
    </div>
  );
}

export default App;
