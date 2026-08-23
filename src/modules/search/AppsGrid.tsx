import { useMemo } from "react";
import { FileQuestion } from "lucide-react";
import { gridIconSize, gridFontScale } from "@/lib/grid";

export interface ScannedApp {
  name: string;
  path: string;
  usage_count: number;
}

/** 搜索结果置顶区：紧凑的应用胶囊列表 */
export function AppsSection({
  apps,
  onOpen,
}: {
  apps: ScannedApp[];
  onOpen: (path: string) => void;
}) {
  if (apps.length === 0) return null;
  return (
    <div className="border-b p-2">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">应用</div>
      <div className="flex flex-wrap gap-1">
        {apps.map((a) => (
          <button
            key={a.path}
            title={a.path}
            onClick={() => onOpen(a.path)}
            className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent"
          >
            <span className="max-w-[160px] truncate">{a.name}</span>
          </button>
        ))}
      </div>
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
        {list.map((a) => {
          if (!icons[a.path]) loadIcon(a.path);
          const icon = icons[a.path];
          return (
            <div
              key={a.path}
              title={`${a.name}\n${a.path}`}
              onClick={() => onOpen(a.path)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50"
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
      className="grid gap-2"
      style={{
        gridAutoRows: `${gridSize}px`,
        gridTemplateColumns: `repeat(auto-fill, ${gridSize}px)`,
      }}
    >
      {list.map((a) => {
        if (!icons[a.path]) loadIcon(a.path);
        const icon = icons[a.path];
        return (
          <div
            key={a.path}
            title={`${a.name}\n${a.path}`}
            onClick={() => onOpen(a.path)}
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-transparent transition-colors hover:bg-accent/50"
            style={{ padding: `${gridSize * 0.1}px` }}
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
