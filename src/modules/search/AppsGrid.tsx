import { useEffect, useMemo, useRef, useState } from "react";
import { FileQuestion, Pin } from "lucide-react";
import {
  gridColumns,
  gridIconSize,
  gridFontScale,
  gridPadding,
  gridVerticalTarget,
} from "@/lib/grid";
import { cn } from "@/lib/utils";

export interface ScannedApp {
  name: string;
  path: string;
  usage_count: number;
}

/** 应用置顶区：匹配应用以网格图标卡片展示 */
export function AppsSection({
  apps,
  onOpen,
  gridSize,
  icons,
  loadIcon,
  pinned,
  onContextMenuApp,
}: {
  apps: ScannedApp[];
  onOpen: (path: string) => void;
  gridSize: number;
  icons: Record<string, string>;
  loadIcon: (path: string) => Promise<void>;
  pinned?: Set<string>;
  onContextMenuApp?: (e: React.MouseEvent, app: ScannedApp) => void;
}) {
  if (apps.length === 0) return null;
  return (
    <div className="border-b p-2">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">应用</div>
      <AppsGrid
        apps={apps}
        query=""
        gridSize={gridSize}
        viewMode="grid"
        sortBy="name"
        sortDesc={false}
        icons={icons}
        loadIcon={loadIcon}
        onOpen={onOpen}
        pinned={pinned}
        onContextMenuApp={onContextMenuApp}
      />
    </div>
  );
}

/** 已安装应用网格/列表（「应用」Tab 与搜索结果置顶区共用） */
export function AppsGrid({
  apps,
  query,
  gridSize,
  viewMode,
  sortBy,
  sortDesc,
  icons,
  loadIcon,
  onOpen,
  registerKeyHandler,
  pinned,
  onContextMenuApp,
}: {
  apps: ScannedApp[] | null;
  query: string;
  gridSize: number;
  viewMode: "grid" | "list";
  sortBy: "name" | "usage";
  sortDesc: boolean;
  icons: Record<string, string>;
  loadIcon: (path: string) => Promise<void>;
  onOpen: (path: string) => void;
  /** 向外注册键盘处理函数（↑↓ 步进 / Enter 启动），供容器 onKeyDown 转发 */
  registerKeyHandler?: (fn: ((e: React.KeyboardEvent) => void) | null) => void;
  /** 置顶应用路径集合（小写）；命中者排序恒在顶部并显示图钉角标 */
  pinned?: Set<string>;
  /** 右键菜单回调（事件与命中的应用），由父层渲染菜单 */
  onContextMenuApp?: (e: React.MouseEvent, app: ScannedApp) => void;
  }) {
  const isPinned = (a: ScannedApp) => pinned?.has(a.path.toLowerCase()) ?? false;
  const clickCtx = (e: React.MouseEvent, app: ScannedApp) => {
    if (!onContextMenuApp) return;
    e.preventDefault();
    onContextMenuApp(e, app);
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (apps ?? []).filter((a) =>
      a.name.toLowerCase().includes(q),
    );
    // 频率降序为"最常用在前"，方向可翻转；名称按中文拼音
    if (sortBy === "usage") {
      filtered.sort((a, b) =>
        sortDesc ? a.usage_count - b.usage_count : b.usage_count - a.usage_count,
      );
    } else {
      filtered.sort((a, b) => {
        const cmp = a.name.localeCompare(b.name, "zh-CN-u-co-pinyin");
        return sortDesc ? -cmp : cmp;
      });
    }
    // 置顶恒定排最前（各自内部保持既有序，稳定分区）
    const top = pinned ?? new Set<string>();
    const pinnedItems = filtered.filter((a) => top.has(a.path.toLowerCase()));
    const rest = filtered.filter((a) => !top.has(a.path.toLowerCase()));
    return [...pinnedItems, ...rest];
  }, [apps, query, sortBy, sortDesc, pinned]);

  // 图标加载从 render 副作用改为 effect：列表变化时按需补拉，不阻塞渲染
  const iconsRef = useRef(icons);
  iconsRef.current = icons;
  useEffect(() => {
    for (const a of list) {
      if (!iconsRef.current[a.path]) loadIcon(a.path);
    }
  }, [list, loadIcon]);

  // 键盘导航（↑↓ 按实测列数跨行步进，Enter 启动）：向容器注册处理函数
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const listRef = useRef(list);
  listRef.current = list;
  const activeRef = useRef(activeIdx);
  activeRef.current = activeIdx;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!registerKeyHandler) return;
    registerKeyHandler((e: React.KeyboardEvent) => {
      const items = listRef.current;
      if (!items.length) return;
      const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (dir !== 0) {
        e.preventDefault();
        const cols =
          viewMode === "grid" && rootRef.current
            ? gridColumns(rootRef.current)
            : 1;
        setActiveIdx((i) => gridVerticalTarget(i ?? -1, dir, items.length, cols));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const i = activeRef.current;
        if (i != null && i < items.length) onOpenRef.current(items[i].path);
      }
    });
    return () => registerKeyHandler(null);
  });

  if (apps === null) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        正在扫描已安装应用…
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        没有匹配的应用
      </div>
    );
  }

  if (viewMode === "list") {
    return (
      <div className="flex flex-col">
        {list.map((a, i) => {
          const icon = icons[a.path];
          return (
            <div
              key={a.path}
              title={`${a.name}\n${a.path}`}
              onClick={() => onOpen(a.path)}
              onContextMenu={(e) => clickCtx(e, a)}
              className={cn(
                "relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50",
                activeIdx === i && "bg-accent",
              )}
            >
              {isPinned(a) && (
                <Pin className="absolute left-0.5 top-0.5 size-2.5 text-primary" />
              )}
              {icon ? (
                <img
                  src={`data:image/png;base64,${icon}`}
                  className="size-5 shrink-0 object-contain"
                  alt=""
                />
              ) : (
                <FileQuestion className="size-5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
              <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                {a.path}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="grid gap-2"
      style={{
        gridAutoRows: `${gridSize}px`,
        gridTemplateColumns: `repeat(auto-fill, ${gridSize}px)`,
      }}
    >
      {list.map((a, i) => {
        const icon = icons[a.path];
        return (
          <div
            key={a.path}
            title={`${a.name}\n${a.path}`}
            onClick={() => {
              setActiveIdx(i);
              onOpen(a.path);
            }}
            onContextMenu={(e) => clickCtx(e, a)}
            className={cn(
              "relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border transition-colors",
              activeIdx === i
                ? "border-primary bg-accent"
                : "border-transparent hover:bg-accent/50",
            )}
            style={{ padding: gridPadding(gridSize) }}
          >
            {isPinned(a) && (
              <Pin className="absolute right-1 top-1 size-3 text-primary" />
            )}
            {icon ? (
              <img
                src={`data:image/png;base64,${icon}`}
                className="object-contain"
                style={{
                  width: gridIconSize(gridSize),
                  height: gridIconSize(gridSize),
                }}
                alt=""
              />
            ) : (
              <FileQuestion
                className="text-muted-foreground"
                style={{
                  width: gridIconSize(gridSize),
                  height: gridIconSize(gridSize),
                }}
              />
            )}
            <span
              className="w-full truncate text-center leading-tight text-muted-foreground"
              style={{ fontSize: `${gridFontScale(gridSize)}px` }}
            >
              {a.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
