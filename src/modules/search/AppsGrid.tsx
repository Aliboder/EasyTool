import { useEffect, useMemo, useRef, useState } from "react";
import { FileQuestion } from "lucide-react";
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

/** 搜索结果置顶区：匹配应用以网格图标卡片展示 */
export function AppsSection({
  apps,
  onOpen,
  gridSize,
  icons,
  loadIcon,
}: {
  apps: ScannedApp[];
  onOpen: (path: string) => void;
  gridSize: number;
  icons: Record<string, string>;
  loadIcon: (path: string) => Promise<void>;
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
  }) {
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (apps ?? []).filter((a) =>
      a.name.toLowerCase().includes(q),
    );
    // 频率降序为"最常用在前"，方向可翻转；名称按中文拼音
    if (sortBy === "usage") {
      return filtered.sort((a, b) =>
        sortDesc ? a.usage_count - b.usage_count : b.usage_count - a.usage_count,
      );
    }
    return filtered.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "zh-CN-u-co-pinyin");
      return sortDesc ? -cmp : cmp;
    });
  }, [apps, query, sortBy, sortDesc]);

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
          if (!icons[a.path]) loadIcon(a.path);
          const icon = icons[a.path];
          return (
            <div
              key={a.path}
              title={`${a.name}\n${a.path}`}
              onClick={() => onOpen(a.path)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50",
                activeIdx === i && "bg-accent",
              )}
            >
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
        if (!icons[a.path]) loadIcon(a.path);
        const icon = icons[a.path];
        return (
          <div
            key={a.path}
            title={`${a.name}\n${a.path}`}
            onClick={() => {
              setActiveIdx(i);
              onOpen(a.path);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border transition-colors",
              activeIdx === i
                ? "border-primary bg-accent"
                : "border-transparent hover:bg-accent/50",
            )}
            style={{ padding: gridPadding(gridSize) }}
          >
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
