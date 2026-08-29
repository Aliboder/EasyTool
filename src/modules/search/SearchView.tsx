import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  Clock,
  X,
  Pin,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  SearchSettings,
  SEARCH_DEFAULTS,
  type SearchSettingsData,
} from "./SearchSettings";
import { useModuleConfig } from "@/hooks/useModuleConfig";
import { AppsGrid, AppsSection, type ScannedApp } from "./AppsGrid";
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

function extractKeywords(query: string): string[] {
  return query
    .replace(/\b(ext|folder|size|path|date|dupe|len|regex|ws|mult|nouni|noext|nopath|nocase|whole|pure|case|diacritics):\S*/gi, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 1);
}

function Highlight({ text, keywords }: { text: string; keywords: string[] }) {
  if (!keywords.length) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  for (const kw of keywords) {
    const lkw = kw.toLowerCase();
    let idx = lower.indexOf(lkw, lastIdx);
    while (idx !== -1) {
      if (idx > lastIdx) parts.push(text.slice(lastIdx, idx));
      parts.push(
        <mark key={`${idx}-${kw}`} className="rounded bg-primary/20 text-foreground">
          {text.slice(idx, idx + kw.length)}
        </mark>,
      );
      lastIdx = idx + kw.length;
      idx = lower.indexOf(lkw, lastIdx);
    }
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return <>{parts.length ? parts : text}</>;
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

export function SearchView() {
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
  // 应用条目的右键菜单（「应用」Tab / 搜索结果置顶区共用）
  const [appMenu, setAppMenu] = useState<{ x: number; y: number; app: ScannedApp } | null>(null);
  const [filter, setFilter] = useState(APPS_TAB);
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
  // 状态重试链：计数 + 定时器句柄（防叠加）
  const statusRetries = useRef(0);
  const statusTimer = useRef<number | null>(null);
  // 搜索代序号：每次新搜索自增，迟到的旧响应不得覆盖新结果
  const searchSeq = useRef(0);

  const refreshStatus = useCallback(async () => {
    const s = await invoke<SearchStatusDto>("search_get_status");
    setStatus(s);
    // 未运行：尝试自动启动（装到可定位路径时生效，便携版由用户手动启动）。
    // 限制总重试次数且同一时刻只保留一条重试链——否则未安装 Everything 的机器上
    // 每次窗口聚焦都会叠加一条 2.5s 无限轮询链，长期挂机持续空转
    if (s.running) {
      statusRetries.current = 0;
      return;
    }
    if (statusRetries.current >= 5) return;
    invoke("search_start_everything");
    statusRetries.current += 1;
    if (statusTimer.current) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(refreshStatus, 2500);
  }, []);

  useEffect(() => {
    refreshStatus();
    return () => {
      if (statusTimer.current) window.clearTimeout(statusTimer.current);
    };
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
      seq: number,
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
        // 迟到的旧响应：期间已发起新搜索，丢弃，防止列表跳回旧筛选/旧关键词
        if (seq !== searchSeq.current) return null;
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
      setLoading(true);
      setError(null);
      const seq = ++searchSeq.current;
      const items = await fetchPage(q, filterQuery, opts, 0, true, seq);
      if (items) await preloadVisuals(items);
      setLoading(false);
      const trimmed = q.trim();
      if (trimmed && items !== null) {
        const hist = cfg.searchHistory.filter((h) => h !== trimmed);
        updateCfg({ searchHistory: [trimmed, ...hist].slice(0, 20) });
      }
    },
    [fetchPage, preloadVisuals, filter, cfg.searchHistory, updateCfg],
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return;
    if (results.length >= total && total > 0) return; // 已全部加载
    setLoadingMore(true);
    const items = await fetchPage(query, activeFilter.query, options, results.length, false, searchSeq.current);
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

  // 后台监测计数后通知刷新：节流 5 秒，仅在应用 Tab 或有搜索词时拉取
  useEffect(() => {
    let last = 0;
    const un = listen("search://apps_dirty", () => {
      const now = Date.now();
      if (now - last < 5000) return;
      last = now;
      if (filter === APPS_TAB || query.trim()) ensureApps(true);
    });
    return () => {
      un.then((fn) => fn());
    };
  }, [filter, query, ensureApps]);

  const openApp = useCallback(
    (path: string) => {
      invoke("search_open_path", { path }).catch((e) =>
        toast(`打开失败：${e}`),
      );
      // 启动的应用即将成为前台：延迟重扫一次，频率排序随之实时变化
      window.setTimeout(() => ensureApps(true), 1500);
    },
    [ensureApps],
  );

  // 置顶应用集合（路径小写，用于排序与角标）
  const pinnedSet = useMemo(() => new Set(cfg.pinnedApps), [cfg.pinnedApps]);

  const togglePinApp = useCallback(
    (app: ScannedApp) => {
      const key = app.path.toLowerCase();
      setAppMenu(null);
      const next = cfg.pinnedApps.includes(key)
        ? cfg.pinnedApps.filter((p) => p !== key)
        : [...cfg.pinnedApps, key];
      updateCfg({ pinnedApps: next });
      toast(next.includes(key) ? `已置顶「${app.name}」` : `已取消置顶「${app.name}」`);
    },
    [cfg.pinnedApps, updateCfg],
  );

  const openAppLocation = useCallback(
    (app: ScannedApp) => {
      setAppMenu(null);
      invoke("search_open_file_location", { path: app.path }).catch((e) =>
        toast(`打开失败：${e}`),
      );
    },
    [],
  );
  const appsKeyHandler = useRef<((e: React.KeyboardEvent) => void) | null>(null);

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
  };

  const doOpenLocation = async (item: SearchResultDto) => {
    await invoke("search_open_file_location", { path: item.full_path });
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
    // 应用浏览态（无关键词）：键盘导航由 AppsGrid 内部处理（↑↓ 步进 / Enter 启动）
    if (browsingApps) {
      appsKeyHandler.current?.(e);
      return;
    }
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
      // ESC：逐层关闭浮层，最后清空搜索词回到应用浏览态
      if (menu) {
        setMenu(null);
        return;
      }
      if (appMenu) {
        setAppMenu(null);
        return;
      }
      if (optsPos) {
        setOptsPos(null);
        return;
      }
      if (query.trim()) {
        setQuery("");
        doSearch("", activeFilter.query, options);
      }
    }
  };

  const setSort = (sortBy: SearchSettingsData["sortBy"], sortDesc: boolean) => {
    updateCfg({ sortBy, sortDesc });
  };

  // 排序变化立即以新参数重搜：不能在 setSort 里直接 doSearch（闭包持旧 sortBy/sortDesc），
  // 等 cfg 更新、fetchPage 重建后再触发
  const sortKey = `${cfg.sortBy}|${cfg.sortDesc}`;
  const lastSortRef = useRef(sortKey);
  useEffect(() => {
    if (lastSortRef.current === sortKey) return;
    lastSortRef.current = sortKey;
    if (filter === APPS_TAB) return;
    doSearch(query, activeFilter.query, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey]);

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
  const highlightKws = useMemo(() => extractKeywords(query), [query]);
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
        <div className="truncate text-sm">
          <Highlight text={r.name} keywords={highlightKws} />
        </div>
        {cfg.columns.path && r.path && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              doOpenLocation(r);
            }}
            className="truncate text-[10px] text-muted-foreground hover:underline cursor-pointer"
          >
            {r.path}
          </div>
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
          <Highlight text={r.name} keywords={highlightKws} />
        </span>
      </div>
    );
  };

  // 「应用」Tab 空态首页：浏览全部已安装应用；一旦有关键词，结果呈现与「全部」Tab 一致
  const browsingApps = filter === APPS_TAB && !query.trim();
  const appsBody = browsingApps ? (
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
      registerKeyHandler={(fn) => {
        appsKeyHandler.current = fn;
      }}
      pinned={pinnedSet}
      onContextMenuApp={(e, app) => setAppMenu({ x: e.clientX, y: e.clientY, app })}
    />
  ) : null;

  const body = browsingApps ? (
    <div className="p-2">{appsBody}</div>
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
      className={cn(
        "relative flex h-full flex-col bg-background text-foreground",
      )}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ModuleHeader
        search={{
          value: query,
          onChange: onQueryChange,
          placeholder:
            status === null
              ? "正在连接 Everything…"
              : status.running
                ? "Everything 已连接，输入关键词搜索文件或启动应用…"
                : "未检测到 Everything，仅可浏览和启动已安装应用",
          autoFocus: true,
          inputRef: inputRef,
          // 注意：不要在这里再绑 onKeyDown——根容器已绑定同一处理器，
          // 输入框按键冒泡后会执行两次（Enter 会把文件打开两遍）
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
          browsingApps ? (
            <HeaderSort
              fields={[
                { id: "name", label: "名称" },
                { id: "usage", label: "频率" },
                { id: "recent", label: "最近" },
              ]}
              value={cfg.appSortBy}
              onChange={(id) =>
                updateCfg({ appSortBy: id as "name" | "usage" | "recent" })
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

      {notReady && !browsingApps && (
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
        {/* 搜索历史：输入为空且有历史记录时展示 */}
        {!query.trim() && !browsingApps && cfg.searchHistory.length > 0 && (
          <div className="border-b p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">搜索历史</span>
              <button
                onClick={() => updateCfg({ searchHistory: [] })}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                清空
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cfg.searchHistory.map((h) => (
                <div key={h} className="group flex items-center gap-1">
                  <button
                    onClick={() => {
                      setQuery(h);
                      doSearch(h, activeFilter.query, options);
                    }}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                  >
                    <Clock className="size-3 text-muted-foreground" />
                    {h}
                  </button>
                  <button
                    onClick={() =>
                      updateCfg({ searchHistory: cfg.searchHistory.filter((x) => x !== h) })
                    }
                    className="hidden rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:block"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 搜索时匹配的应用置顶显示（点击直接启动）——所有 Tab 一致，网格图标形态 */}
        {query.trim() && apps !== null && (
          <AppsSection
            apps={apps.filter((a) =>
              a.name.toLowerCase().includes(query.trim().toLowerCase()),
            )}
            onOpen={openApp}
            gridSize={cfg.gridSize}
            icons={icons}
            loadIcon={loadIcon}
            pinned={pinnedSet}
            onContextMenuApp={(e, app) => setAppMenu({ x: e.clientX, y: e.clientY, app })}
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

      {/* 应用条目右键（「应用」Tab 与搜索结果置顶区） */}
      <ContextMenu
        visible={!!appMenu}
        x={appMenu?.x ?? 0}
        y={appMenu?.y ?? 0}
        onClose={() => setAppMenu(null)}
      >
        <ContextMenuItem
          icon={<ExternalLink className="size-3.5" />}
          label="打开"
          onClick={() => {
            if (appMenu) {
              openApp(appMenu.app.path);
              setAppMenu(null);
            }
          }}
        />
        <ContextMenuItem
          icon={<FolderOpen className="size-3.5" />}
          label="打开所在位置"
          onClick={() => appMenu && openAppLocation(appMenu.app)}
        />
        {appMenu && (
          <ContextMenuItem
            icon={<Pin className="size-3.5" />}
            label={pinnedSet.has(appMenu.app.path.toLowerCase()) ? "取消置顶" : "置顶"}
            onClick={() => appMenu && togglePinApp(appMenu.app)}
          />
        )}
      </ContextMenu>
    </div>
  );
}