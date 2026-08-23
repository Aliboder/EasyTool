import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { ModuleHeader, HeaderButton, HeaderSort, type HeaderSortField } from "@/components/module-header";
import { Drawer } from "@/components/ui/drawer";
import { ContextMenu } from "@/components/ui/context-menu";
import { ContextMenuItem } from "@/components/ui/context-menu-item";
import {
  FolderOpen,
  Copy,
  File,
  Settings2,
  ExternalLink,
  Loader2,
  LayoutList,
  LayoutGrid,
  Type,
  AlignJustify,
  FolderSearch,
  Regex,
  SlidersHorizontal,
  Folder,
  FileText,
  Image,
  Video,
  Music,
  Archive,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useWindowEntrance } from "@/lib/use-window-entrance";
import {
  SearchSettings,
  SEARCH_DEFAULTS,
  type SearchSettingsData,
} from "./SearchSettings";
import { useModuleConfig } from "@/hooks/useModuleConfig";
import { AppsGrid, AppsSection, type ScannedApp } from "./AppsGrid";
import { usePopupGeometry } from "@/hooks/usePopupGeometry";
import { useFileIcons } from "@/hooks/useFileIcons";
import { toast } from "@/lib/toast";
import { gridColumns, gridVerticalTarget, gridIconSize, gridFontScale, gridPadding } from "@/lib/grid";

const SORT_FIELDS: HeaderSortField[] = [
  { id: "name", label: "名称" },
  { id: "path", label: "路径" },
  { id: "size", label: "大小" },
  { id: "modified", label: "修改" },
];

export interface SearchResultDto {
  name: string;
  path: string;
  full_path: string;
  size: number | null;
  modified_ms: number | null;
  is_folder: boolean;
}

export interface SearchStatusDto {
  running: boolean;
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "avif", "tif", "tiff"];

function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.includes(ext);
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes as number;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

function fmtTime(ms: number | null): string {
  if (ms == null) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/// 「应用」Tab：已安装应用中心（非 Everything 过滤器）
const APPS_TAB = "apps";

/// 预设过滤器（对应 Everything 语法；label 用于 tooltip，query 为空串表示无过滤）
const FILTERS: { id: string; label: string; icon: LucideIcon; query: string }[] = [
  { id: "all", label: "全部", icon: LayoutGrid, query: "" },
  { id: "folders", label: "文件夹", icon: Folder, query: "folder:" },
  { id: "files", label: "文件", icon: File, query: "!folder:" },
  { id: "doc", label: "文档", icon: FileText, query: "ext:doc;docx;pdf;txt;xls;xlsx;ppt;pptx;md" },
  { id: "image", label: "图片", icon: Image, query: "ext:png;jpg;jpeg;gif;bmp;webp;svg;ico" },
  { id: "video", label: "视频", icon: Video, query: "ext:mp4;avi;mkv;mov;wmv;flv;webm" },
  { id: "audio", label: "音频", icon: Music, query: "ext:mp3;wav;flac;ogg;aac;m4a" },
  { id: "zip", label: "压缩包", icon: Archive, query: "ext:zip;rar;7z;tar;gz;bz2;iso" },
];

interface SearchOptions {
  matchCase: boolean;
  matchWholeWord: boolean;
  matchPath: boolean;
  regex: boolean;
}

export function SearchView({ popup = true }: { popup?: boolean }) {
  const entranceRef = useWindowEntrance(popup, ["animate-in", "fade-in-0"]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatusDto | null>(null);
  const [results, setResults] = useState<SearchResultDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: SearchResultDto } | null>(null);
  const [filter, setFilter] = useState("all");
  const [options, setOptions] = useState<SearchOptions>({
    matchCase: false,
    matchWholeWord: false,
    matchPath: false,
    regex: false,
  });
  // 统一配置（共享 Hook：读写/键名映射/focus 重读全部内置）
  const { cfg, update: updateCfg } = useModuleConfig("search", SEARCH_DEFAULTS);
  // 文件图标/缩略图按路径缓存（共享 Hook）
  const { icons, thumbs, loadIcon, loadThumb } = useFileIcons();
  const [showSettings, setShowSettings] = useState(false);
  const [optsPos, setOptsPos] = useState<{ x: number; y: number } | null>(null);
  const optsRef = useRef<HTMLDivElement | null>(null);
  const debounce = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await invoke<SearchStatusDto>("search_get_status");
      setStatus(s);
      // 未运行：尝试自动启动（装到可定位路径时生效，便携版由用户手动启动）
      if (!s.running) {
        invoke("search_start_everything");
        setTimeout(refreshStatus, 2500);
      }
    } catch (e) {
      console.error("search status failed", e);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    window.addEventListener("focus", refreshStatus);
    return () => window.removeEventListener("focus", refreshStatus);
  }, [refreshStatus]);

  const activeFilter = useMemo(() => FILTERS.find((f) => f.id === filter) ?? FILTERS[0], [filter]);

  const PAGE_SIZE = 100;

  const fetchPage = useCallback(
    async (
      q: string,
      filterQuery: string,
      opts: SearchOptions,
      offset: number,
      isFirst: boolean,
    ): Promise<SearchResultDto[] | null> => {
      const parts = [filterQuery, q.trim()].filter(Boolean);
      const full = parts.join(" ");
      if (!full.trim()) {
        setResults([]);
        setTotal(0);
        setSelected(null);
        return null;
      }
      try {
        const page = await invoke<{ total: number; items: SearchResultDto[] }>("search", {
          query: full,
          offset,
          pageSize: PAGE_SIZE,
          sortBy: cfg.sortBy,
          sortDesc: cfg.sortDesc,
          matchCase: opts.matchCase,
          matchWholeWord: opts.matchWholeWord,
          matchPath: opts.matchPath,
          regex: opts.regex,
        });
        if (isFirst) {
          setTotal(page.total);
          setResults(page.items);
          setSelected((cur) => {
            if (cfg.autoSelectFirst) return page.items[0]?.full_path ?? null;
            return page.items.some((r) => r.full_path === cur) ? cur : null;
          });
        } else {
          setResults((prev) => {
            const seen = new Set(prev.map((r) => r.full_path));
            return [...prev, ...page.items.filter((r) => !seen.has(r.full_path))];
          });
        }
        return page.items;
      } catch (e) {
        console.error("search failed", e);
        if (isFirst) {
          setError(String(e));
          setResults([]);
          setTotal(0);
          setSelected(null);
        }
        return null;
      }
    },
    [cfg.sortBy, cfg.sortDesc, cfg.autoSelectFirst],
  );

  const preloadVisuals = useCallback(
    async (items: SearchResultDto[]) => {
      const pending: Promise<void>[] = [];
      for (const r of items) {
        if (isImagePath(r.name) && cfg.columns.thumbnail) {
          pending.push(loadThumb(r.full_path));
        } else {
          pending.push(loadIcon(r.full_path));
        }
      }
      await Promise.all(pending);
    },
    [cfg.columns.thumbnail, loadIcon, loadThumb],
  );

  const doSearch = useCallback(
    async (q: string, filterQuery: string, opts: SearchOptions) => {
      if (filter === APPS_TAB) return; // 应用 Tab 不做文件搜索
      setLoading(true);
      setError(null);
      const items = await fetchPage(q, filterQuery, opts, 0, true);
      if (items) await preloadVisuals(items);
      setLoading(false);
    },
    [fetchPage, preloadVisuals, filter],
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return;
    if (results.length >= total && total > 0) return; // 已全部加载
    setLoadingMore(true);
    const items = await fetchPage(query, activeFilter.query, options, results.length, false);
    if (items) await preloadVisuals(items);
    setLoadingMore(false);
  }, [loadingMore, loading, results.length, total, activeFilter.query, query, options, fetchPage, preloadVisuals]);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
        loadMore();
      }
    },
    [loadMore],
  );

  // 兜底：自动加载直到填满可视区。全屏/大窗口下第一页撑不满屏幕时无滚动可触发 onScroll，
  // 这里在每次结果变化后检查容器是否溢出，未填满且有更多结果就继续加载（隐藏容器 clientHeight=0 跳过）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return;
    if (total === 0 || loading || loadingMore) return;
    if (results.length >= total) return;
    if (el.scrollHeight - el.clientHeight < 40) {
      loadMore();
    }
  }, [results, total, loading, loadingMore, loadMore]);

  const onQueryChange = (v: string) => {
    setQuery(v);
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      doSearch(v, activeFilter.query, options);
    }, 150);
  };

  // 过滤器/选项变化时立即重搜（不等待输入）；「应用」Tab 不触发 Everything 搜索
  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    if (filter === APPS_TAB) return;
    doSearch(query, activeFilter.query, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, options]);

  // 弹窗尺寸记忆（共享 Hook 内置防抖）
  usePopupGeometry("search", { trackSize: popup });

  // 已安装应用库：「应用」Tab 数据源；30 秒内不重复扫描
  const [apps, setApps] = useState<ScannedApp[] | null>(null);
  const appsFetchedAt = useRef(0);
  const ensureApps = useCallback(
    (force = false) => {
      if (!force && appsFetchedAt.current && Date.now() - appsFetchedAt.current < 30_000)
        return;
      appsFetchedAt.current = Date.now();
      invoke<ScannedApp[]>("search_scan_apps")
        .then(setApps)
        .catch(console.error);
    },
    [],
  );
  useEffect(() => {
    ensureApps();
  }, [ensureApps]);
  useEffect(() => {
    if (filter === APPS_TAB) ensureApps(true); // 切到应用 Tab 强制刷新频率数据
  }, [filter, ensureApps]);

  const openApp = useCallback((path: string) => {
    invoke("search_open_path", { path }).catch((e) =>
      toast(`打开失败：${e}`),
    );
  }, []);

  // 搜索选项菜单关闭逻辑（点击外部关闭）
  useEffect(() => {
    if (optsPos) {
      const onDown = (e: MouseEvent) => {
        if (optsRef.current && !optsRef.current.contains(e.target as Node)) setOptsPos(null);
      };
      window.addEventListener("mousedown", onDown);
      return () => window.removeEventListener("mousedown", onDown);
    }
  }, [optsPos]);

  const doOpen = async (item: SearchResultDto) => {
    await invoke("search_open_file", { path: item.full_path });
    if (popup) getCurrentWindow().hide();
  };

  const doOpenLocation = async (item: SearchResultDto) => {
    await invoke("search_open_file_location", { path: item.full_path });
    if (popup) getCurrentWindow().hide();
  };

  const doCopyPath = async (item: SearchResultDto) => {
    await invoke("search_copy_path", { path: item.full_path });
    toast("已复制路径");
    setMenu(null);
  };

  const doCopyFile = async (item: SearchResultDto) => {
    await invoke("search_copy_file", { path: item.full_path });
    toast("已复制文件");
    setMenu(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (showSettings) return;
    const idx = results.findIndex((r) => r.full_path === selected);
    const isGrid = cfg.viewMode === "grid";
    const cols = isGrid && gridRef.current ? gridColumns(gridRef.current) : 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length)
        setSelected(results[gridVerticalTarget(idx, 1, results.length, cols)].full_path);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length)
        setSelected(results[gridVerticalTarget(idx, -1, results.length, cols)].full_path);
    } else if (e.key === "Enter" && selected != null) {
      e.preventDefault();
      const item = results.find((r) => r.full_path === selected);
      if (item) {
        if (e.ctrlKey) doOpenLocation(item);
        else doOpen(item);
      }
    } else if (e.key === "Escape") {
      if (popup) getCurrentWindow().hide();
    }
  };

  const setSort = (sortBy: SearchSettingsData["sortBy"], sortDesc: boolean) => {
    updateCfg({ sortBy, sortDesc });
    doSearch(query, activeFilter.query, options);
  };

  const toggleView = () => {
    updateCfg({ viewMode: cfg.viewMode === "grid" ? "list" : "grid" });
  };

  const toggleOption = (key: keyof SearchOptions) => {
    const next = { ...options, [key]: !options[key] };
    setOptions(next);
  };

  const notReady = status && !status.running;

  // 图标/缩略图节点（列表与网格共用）
  const visualNode = (r: SearchResultDto, size: number) => (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden"
      style={{ width: size, height: size }}
    >
      {cfg.columns.thumbnail && thumbs[r.full_path] ? (
        <img
          src={`data:image/png;base64,${thumbs[r.full_path]}`}
          className="h-full w-full rounded object-cover"
          alt=""
        />
      ) : icons[r.full_path] ? (
        <img
          src={`data:image/png;base64,${icons[r.full_path]}`}
          className="object-contain"
          alt=""
          style={{ width: size * 0.7, height: size * 0.7 }}
        />
      ) : (
        <File className="text-muted-foreground" style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </div>
  );

  // 列表行
  const rowNode = (r: SearchResultDto) => (
    <div
      onClick={() => {
        if (cfg.clickToOpen) doOpen(r);
        else setSelected(r.full_path);
      }}
      onDoubleClick={() => {
        if (!cfg.clickToOpen) doOpen(r);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, item: r });
      }}
      onMouseEnter={() => setSelected(r.full_path)}
      className={cn(
        "flex cursor-pointer items-center gap-2 px-2 py-1.5 transition-colors",
        selected === r.full_path ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      {visualNode(r, 28)}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{r.name}</div>
        {cfg.columns.path && r.path && (
          <div className="truncate text-[10px] text-muted-foreground">{r.path}</div>
        )}
      </div>
      {cfg.columns.size && !r.is_folder && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {fmtSize(r.size)}
        </span>
      )}
      {cfg.columns.modified && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {fmtTime(r.modified_ms)}
        </span>
      )}
    </div>
  );

  // 网格单元
  const gridNode = (r: SearchResultDto) => {
    const gs = cfg.gridSize;
        const iconSize = gridIconSize(gs);
    return (
      <div
        onClick={() => {
          if (cfg.clickToOpen) doOpen(r);
          else setSelected(r.full_path);
        }}
        onDoubleClick={() => {
          if (!cfg.clickToOpen) doOpen(r);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, item: r });
        }}
        onMouseEnter={() => setSelected(r.full_path)}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border transition-colors",
          selected === r.full_path
            ? "border-primary bg-accent"
            : "border-transparent hover:bg-accent/50",
        )}
        style={{ width: gs, height: gs, padding: gridPadding(gs) }}
      >
        {visualNode(r, iconSize)}
        <span className="w-full truncate text-center leading-tight" style={{ fontSize: `${gridFontScale(gs)}px` }} title={r.name}>
          {r.name}
        </span>
      </div>
    );
  };

  // 「应用」Tab：已安装应用网格/列表（点击直接启动）
  const appsBody =
    filter === APPS_TAB ? (
      <AppsGrid
        apps={apps}
        query={query}
        gridSize={cfg.gridSize}
        viewMode={cfg.viewMode}
        sortBy={cfg.appSortBy}
        sortDesc={cfg.appSortDesc}
        icons={icons}
        loadIcon={loadIcon}
        onOpen={openApp}
      />
    ) : null;

  const body =
    filter === APPS_TAB ? (
      appsBody
    ) : error ? (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
        {error}
      </div>
    ) : results.length === 0 ? (
      query.trim() || activeFilter.query ? (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          无匹配结果
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                !status
                  ? "bg-muted-foreground/50"
                  : status.running
                    ? "bg-emerald-500"
                    : "bg-orange-500",
              )}
            />
            <span className="text-muted-foreground">
              {!status
                ? "正在检测 Everything 连接状态…"
                : status.running
                  ? "Everything 已连接，输入关键词开始搜索"
                  : "Everything 未运行，见上方提示"}
            </span>
          </div>
          <div className="text-xs leading-relaxed text-muted-foreground/80">
            支持 Everything 语法：
            <span className="mx-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">ext:pdf</span>
            <span className="mx-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">folder:D:\</span>
            <span className="mx-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">*.mp4</span>
            <br />
            顶栏图标可切换类型过滤
          </div>
        </div>
      )
    ) : cfg.viewMode === "grid" ? (
      <div
        ref={gridRef}
        className="grid gap-2 p-2"
        style={{
          gridAutoRows: `${cfg.gridSize}px`,
          gridTemplateColumns: `repeat(auto-fill, ${cfg.gridSize}px)`,
        }}
      >
        {results.map((r) => (
          <div key={r.full_path}>{gridNode(r)}</div>
        ))}
      </div>
    ) : (
      <ul className="py-1">
        {results.map((r) => (
          <li key={r.full_path}>{rowNode(r)}</li>
        ))}
      </ul>
    );

  return (
    <div
      ref={popup ? entranceRef : undefined}
      className={cn(
        "relative flex h-full flex-col bg-background text-foreground",
        popup && "animate-in fade-in-0 duration-150",
      )}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ModuleHeader
        search={{
          value: query,
          onChange: onQueryChange,
          placeholder: "输入关键词搜索文件…",
          autoFocus: true,
          inputRef: inputRef,
          onKeyDown: onKeyDown,
          trailing: (
            <>
              {loading && (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              {cfg.showResultsCount && total > 0 && !loading && (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  共 {total} 条
                </span>
              )}
            </>
          ),
        }}
        actions={
          <>
            <HeaderButton
              title={cfg.viewMode === "grid" ? "切换到列表" : "切换到网格"}
              onClick={toggleView}
            >
              {cfg.viewMode === "grid" ? (
                <LayoutList className="size-4" />
              ) : (
                <LayoutGrid className="size-4" />
              )}
            </HeaderButton>
            <HeaderButton
              title="搜索设置"
              active={showSettings}
              onClick={() => setShowSettings((v) => !v)}
            >
              <Settings2 className="size-4" />
            </HeaderButton>
          </>
        }
        tabs={[
          { id: APPS_TAB, label: "应用" },
          ...FILTERS.map((f) => ({ id: f.id, icon: f.icon, title: f.label })),
        ]}
        activeTab={filter}
        onTabChange={setFilter}
        tabsTrailing={
          filter === APPS_TAB ? (
            <HeaderSort
              fields={[
                { id: "name", label: "名称" },
                { id: "usage", label: "频率" },
              ]}
              value={cfg.appSortBy}
              onChange={(id) =>
                updateCfg({ appSortBy: id as "name" | "usage" })
              }
              desc={cfg.appSortDesc}
              onDescToggle={() => updateCfg({ appSortDesc: !cfg.appSortDesc })}
            />
          ) : (
            <>
              <HeaderSort
                fields={SORT_FIELDS}
                value={cfg.sortBy}
                onChange={(id) => setSort(id as SearchSettingsData["sortBy"], cfg.sortDesc)}
                desc={cfg.sortDesc}
                onDescToggle={() => setSort(cfg.sortBy, !cfg.sortDesc)}
              />

            {/* 匹配选项菜单 */}
            <div ref={optsRef} className="relative">
              <button
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setOptsPos((cur) =>
                    cur ? null : { x: r.right - 160, y: r.bottom + 4 },
                  );
                }}
                aria-label="匹配选项"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <SlidersHorizontal className="size-3.5" />
              </button>
              {optsPos && (
                <div
                  className="fixed z-50 w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                  style={{ left: optsPos.x, top: optsPos.y }}
                >
                  {(
                    [
                      ["matchCase", "区分大小写", options.matchCase],
                      ["matchWholeWord", "全字匹配", options.matchWholeWord],
                      ["matchPath", "匹配路径", options.matchPath],
                      ["regex", "正则表达式", options.regex],
                    ] as const
                  ).map(([key, label, on]) => (
                    <button
                      key={key}
                      onClick={() => toggleOption(key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent",
                        on ? "text-primary" : "text-foreground",
                      )}
                    >
                      {key === "matchCase" ? (
                        <Type className="size-3.5" />
                      ) : key === "matchWholeWord" ? (
                        <AlignJustify className="size-3.5" />
                      ) : key === "matchPath" ? (
                        <FolderSearch className="size-3.5" />
                      ) : (
                        <Regex className="size-3.5" />
                      )}
                       {label}
                       {on && <span className="ml-auto">✓</span>}
                     </button>
                   ))}
                 </div>
               )}
             </div>
            </>
          )
        }
       />

      {notReady && (
        <div className="border-b bg-secondary/40 p-3">
          <div className="flex flex-col gap-2 text-sm">
            <div>未检测到运行中的 Everything（文件搜索的底层引擎，免费）</div>
            <div className="text-xs text-muted-foreground">
              已安装 Everything 时请启动它；未安装请前往官方下载
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => openUrl("https://www.voidtools.com/downloads/")}
                className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
              >
                前往下载
              </button>
              <button
                onClick={() => {
                  invoke("search_start_everything");
                  setTimeout(refreshStatus, 2500);
                }}
                className="rounded-md border px-3 py-1 text-xs"
              >
                启动 Everything
              </button>
              <button
                onClick={refreshStatus}
                className="rounded-md border px-3 py-1 text-xs text-muted-foreground"
              >
                重新检测
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="themed-scroll flex-1 overflow-y-auto">
        {/* 搜索时匹配的应用置顶显示（点击直接启动） */}
        {filter !== APPS_TAB && query.trim() && apps !== null && (
          <AppsSection
            apps={apps.filter((a) =>
              a.name.toLowerCase().includes(query.trim().toLowerCase()),
            )}
            onOpen={openApp}
          />
        )}
        {body}
      </div>

      <Drawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        title="搜索设置"
      >
        <SearchSettings cfg={cfg} onUpdate={updateCfg} />
      </Drawer>

      <ContextMenu
        visible={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
      >
        <ContextMenuItem
          icon={<ExternalLink className="size-3.5" />}
          label="打开"
          onClick={() => {
            if (menu) {
              doOpen(menu.item);
              setMenu(null);
            }
          }}
        />
        <ContextMenuItem
          icon={<FolderOpen className="size-3.5" />}
          label="打开所在位置"
          onClick={() => {
            if (menu) {
              doOpenLocation(menu.item);
              setMenu(null);
            }
          }}
        />
        <ContextMenuItem
          icon={<Copy className="size-3.5" />}
          label="复制路径"
          onClick={() => menu && doCopyPath(menu.item)}
        />
        <ContextMenuItem
          icon={<Copy className="size-3.5" />}
          label="复制文件"
          onClick={() => menu && doCopyFile(menu.item)}
        />
      </ContextMenu>
    </div>
  );
}