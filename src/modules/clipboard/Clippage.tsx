import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { Search, Pin, Trash2, Copy, FolderOpen, Eye } from "lucide-react";

interface ItemDto {
  id: number;
  kind: string;
  preview: string;
  full: string | null;
  thumb: string | null;
  file_count: number;
  pinned: boolean;
  created_at: number;
}

type Filter = "all" | "pinned" | "text" | "image" | "files";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "pinned", label: "固定" },
  { id: "text", label: "文本" },
  { id: "image", label: "图片" },
  { id: "files", label: "文件" },
];

function hideWindow() {
  getCurrentWindow().hide();
}

export function Clippage({ popup = true }: { popup?: boolean }) {
  const [items, setItems] = useState<ItemDto[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: ItemDto } | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [fileIcons, setFileIcons] = useState<Record<string, string>>({});
  const debounce = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await invoke<ItemDto[]>("get_history", {
        filter: search,
        kind: filter === "all" ? null : filter,
        limit: 200,
        offset: 0,
      });
      setItems(list);
      setSelected((cur) => (list.some((i) => i.id === cur) ? cur : (list[0]?.id ?? null)));
      // 预载缩略图
      const t: Record<number, string> = {};
      const pending: Promise<void>[] = [];
      for (const it of list) {
        if (it.kind === "image" && !thumbs[it.id]) {
          pending.push(
            invoke<string | null>("get_thumb", { id: it.id }).then((b) => {
              if (b) t[it.id] = b;
            }),
          );
        }
      }
      await Promise.all(pending);
      if (Object.keys(t).length) setThumbs((prev) => ({ ...prev, ...t }));
    } catch (e) {
      console.error("load history failed", e);
    }
  }, [search, filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const un = listen("clipboard://changed", () => load());
    return () => {
      un.then((fn) => fn());
    };
  }, [load]);

  useEffect(() => {
    if (menu) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setMenu(null);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [menu]);

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      setSearch((prev) => prev);
    }, 200);
  };

  const doPaste = async (id: number) => {
    if (!popup) {
      // 主窗口内嵌模式：粘贴回唤起前窗口并隐藏主窗口（统一呼出模式下保持跟手粘贴）
      await invoke("paste_item", { id });
      hideWindow();
      return;
    }
    await invoke("paste_item", { id });
    hideWindow();
  };

  const togglePin = async (id: number, pinned: boolean) => {
    await invoke("pin_item", { id, pinned });
    setMenu(null);
    await load();
  };

  const del = async (id: number) => {
    await invoke("delete_item", { id });
    setMenu(null);
    await load();
  };

  const copy = async (id: number) => {
    await invoke("copy_item", { id });
    setMenu(null);
  };

  const viewImage = async (item: ItemDto) => {
    const b64 = await invoke<string | null>("get_image", { id: item.id });
    if (b64) {
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(
          `<body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="data:image/png;base64,${b64}" style="max-width:95vw;max-height:95vh"/></body>`,
        );
      }
    }
    setMenu(null);
  };

  const fileIconOf = async (path: string) => {
    if (fileIcons[path]) return;
    const b = await invoke<string | null>("get_file_icon", { path });
    if (b) setFileIcons((prev) => ({ ...prev, [path]: b }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = items.findIndex((i) => i.id === selected);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = items[(idx + 1) % items.length];
      if (next) setSelected(next.id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = items[(idx - 1 + items.length) % items.length];
      if (next) setSelected(next.id);
    } else if (e.key === "Enter" && selected != null && popup) {
      e.preventDefault();
      doPaste(selected);
    } else if (e.key === "Escape" && popup) {
      hideWindow();
    } else if (e.key === "Delete" && selected != null) {
      del(selected);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b p-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          id="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索剪贴板历史…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autoFocus
        />
      </div>

      <div className="flex gap-1 border-b px-2 py-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded px-2 py-0.5 text-xs transition-colors",
              filter === f.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {search ? "无匹配记录" : "暂无剪贴板记录"}
          </div>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => doPaste(item.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, item });
                  }}
                  onMouseEnter={() => setSelected(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                    selected === item.id ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  {item.kind === "image" ? (
                    thumbs[item.id] ? (
                      <img
                        src={`data:image/png;base64,${thumbs[item.id]}`}
                        className="size-9 shrink-0 rounded object-cover"
                        alt=""
                      />
                    ) : (
                      <div className="size-9 shrink-0 rounded bg-muted" />
                    )
                  ) : item.kind === "files" ? (
                    (() => {
                      const path = item.preview;
                      if (path) fileIconOf(path);
                      return fileIcons[path] ? (
                        <img
                          src={`data:image/png;base64,${fileIcons[path]}`}
                          className="size-9 shrink-0 rounded object-contain"
                          alt=""
                        />
                      ) : (
                        <div className="flex size-9 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                          文件
                        </div>
                      );
                    })()
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs" title={item.full ?? item.preview}>
                      {item.preview}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      {item.kind === "files" && <span>{item.file_count} 个文件</span>}
                      {item.kind === "image" && <span>图片</span>}
                      {item.pinned && <Pin className="size-2.5" />}
                      <span className="ml-auto">
                        {new Date(item.created_at).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {menu && (
        <div
          className="fixed z-50 min-w-36 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
            onClick={() => togglePin(menu.item.id, !menu.item.pinned)}
          >
            <Pin className="size-3.5" />
            {menu.item.pinned ? "取消固定" : "固定"}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
            onClick={() => copy(menu.item.id)}
          >
            <Copy className="size-3.5" />
            复制到剪贴板
          </button>
          {menu.item.kind === "image" && (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
              onClick={() => viewImage(menu.item)}
            >
              <Eye className="size-3.5" />
              查看大图
            </button>
          )}
          {menu.item.kind === "files" && (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
              onClick={() => {
                invoke("open_file_location", { path: menu.item.preview });
                setMenu(null);
              }}
            >
              <FolderOpen className="size-3.5" />
              打开所在位置
            </button>
          )}
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-destructive hover:bg-accent"
            onClick={() => del(menu.item.id)}
          >
            <Trash2 className="size-3.5" />
            删除
          </button>
        </div>
      )}
    </div>
  );
}