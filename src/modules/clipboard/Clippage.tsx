import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/api";
import { Search, Pin, Trash2, Copy, FolderOpen, Eye, Settings2, GripVertical } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useHorizontalWheel } from "@/lib/use-horizontal-wheel";
import { ClipSettings } from "./ClipSettings";
import { LazyImage } from "@/components/LazyImage";
import { useWindowEntrance } from "@/lib/use-window-entrance";

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

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "avif", "tif", "tiff"];

function isImageItem(item: ItemDto): boolean {
  if (item.kind === "image") return true;
  if (item.kind === "files") {
    const ext = item.preview.split(".").pop()?.toLowerCase() ?? "";
    return IMAGE_EXTS.includes(ext);
  }
  return false;
}

function fileBasename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

const LINE_CLAMP: Record<number, string> = {
  1: "line-clamp-1",
  2: "line-clamp-2",
  3: "line-clamp-3",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 固定板块内可拖拽排序的小条目包装（小尺寸元素，transform 不会触发大卡片渲染问题）
function PinnedSortable({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
  });
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
      className={cn(isDragging && "z-10 opacity-70")}
    >
      {children}
    </div>
  );
}

export function Clippage({ popup = true }: { popup?: boolean }) {
  const entranceRef = useWindowEntrance(popup, ["animate-in", "fade-in-0"]);
  const [items, setItems] = useState<ItemDto[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: ItemDto } | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [fileIcons, setFileIcons] = useState<Record<string, string>>({});
  const [fileThumbs, setFileThumbs] = useState<Record<string, string>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [clipCfg, setClipCfg] = useState<{
    maxItems: number;
    hotkey: string;
    followMouse: boolean;
    cellSize: number;
    textLines: number;
    showTimestamps: boolean;
  } | null>(null);
  const debounce = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refreshClipCfg = useCallback(async () => {
    try {
      const cfg = await getConfig();
      const m = cfg.modules.clipboard ?? {};
      setClipCfg({
        maxItems: (m.max_items as number) ?? 500,
        hotkey: (m.hotkey as string) ?? "Ctrl+Shift+V",
        followMouse: (m.follow_mouse as boolean) ?? true,
        cellSize: (m.cell_size as number) ?? 80,
        textLines: (m.text_lines as number) ?? 2,
        showTimestamps: (m.show_timestamps as boolean) ?? true,
      });
    } catch (e) {
      console.error("load clip config failed", e);
    }
  }, []);

  useEffect(() => {
    refreshClipCfg();
  }, [refreshClipCfg]);

  // 每次呼出（窗口聚焦）刷新配置，跟随/固定模式切换即时生效
  useEffect(() => {
    window.addEventListener("focus", refreshClipCfg);
    return () => window.removeEventListener("focus", refreshClipCfg);
  }, [refreshClipCfg]);

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
      // 预载缩略图（图片条目 + 图片类文件）
      const t: Record<number, string> = {};
      const ft: Record<string, string> = {};
      const pending: Promise<void>[] = [];
      for (const it of list) {
        if (it.kind === "image" && !thumbs[it.id]) {
          pending.push(
            invoke<string | null>("get_thumb", { id: it.id }).then((b) => {
              if (b) t[it.id] = b;
            }),
          );
        } else if (it.kind === "files" && isImageItem(it) && !fileThumbs[it.preview]) {
          pending.push(
            invoke<string | null>("get_file_thumb", { path: it.preview }).then((b) => {
              if (b) ft[it.preview] = b;
            }),
          );
        }
      }
      await Promise.all(pending);
      if (Object.keys(t).length) setThumbs((prev) => ({ ...prev, ...t }));
      if (Object.keys(ft).length) setFileThumbs((prev) => ({ ...prev, ...ft }));
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
      const onDown = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          setMenu(null);
        }
      };
      window.addEventListener("keydown", onKey);
      window.addEventListener("mousedown", onDown);
      return () => {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("mousedown", onDown);
      };
    }
  }, [menu]);

  // 固定位置模式下：拖动弹窗后防抖保存位置（仅弹窗窗口）
  useEffect(() => {
    if (!popup || clipCfg?.followMouse !== false) return;
    const win = getCurrentWindow();
    let t: number | null = null;
    const un = win.onMoved(({ payload }) => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => {
        invoke("save_fixed_pos", { x: payload.x, y: payload.y }).catch(console.error);
      }, 400);
    });
    return () => {
      un.then((fn) => fn());
      if (t) window.clearTimeout(t);
    };
  }, [popup, clipCfg?.followMouse]);

  // 记住弹窗尺寸（仅弹窗窗口，防抖保存）
  useEffect(() => {
    if (!popup) return;
    const win = getCurrentWindow();
    let t: number | null = null;
    const un = win.onResized(({ payload }) => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => {
        invoke("save_popup_size", { width: payload.width, height: payload.height }).catch(
          console.error,
        );
      }, 400);
    });
    return () => {
      un.then((fn) => fn());
      if (t) window.clearTimeout(t);
    };
  }, [popup]);

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
    setMenu(null);
    const path =
      item.kind === "files"
        ? item.preview
        : await invoke<string | null>("get_image_path", { id: item.id });
    if (path) {
      try {
        await openPath(path);
      } catch (e) {
        console.error("open image failed", e);
      }
    }
  };

  const fileIconOf = async (path: string) => {
    if (fileIcons[path]) return;
    const b = await invoke<string | null>("get_file_icon", { path });
    if (b) setFileIcons((prev) => ({ ...prev, [path]: b }));
  };

  const fileThumbOf = async (path: string) => {
    if (fileThumbs[path]) return;
    const b = await invoke<string | null>("get_file_thumb", { path });
    if (b) setFileThumbs((prev) => ({ ...prev, [path]: b }));
  };

  const composite = filter === "all" || filter === "pinned";
  const pinned = filter === "pinned";
  const cellSize = clipCfg?.cellSize ?? 80;
  const textLines = clipCfg?.textLines ?? 2;
  const showTimestamps = clipCfg?.showTimestamps ?? true;
  const imgItems = composite ? items.filter(isImageItem) : [];
  const fileItems = composite
    ? items.filter((it) => it.kind === "files" && !isImageItem(it))
    : [];
  const textItems = composite ? items.filter((it) => it.kind === "text") : [];
  const ordered = composite ? [...imgItems, ...fileItems, ...textItems] : items;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // 固定板块分区拖拽：重排该区固定条目并持久化整组顺序
  const handleSectionDragEnd = (section: "img" | "file" | "text", event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const list = section === "img" ? imgItems : section === "file" ? fileItems : textItems;
    const oldIdx = list.findIndex((it) => String(it.id) === active.id);
    const newIdx = list.findIndex((it) => String(it.id) === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const start =
      section === "img"
        ? 0
        : section === "file"
          ? imgItems.length
          : imgItems.length + fileItems.length;
    const next = arrayMove([...imgItems, ...fileItems, ...textItems], start + oldIdx, start + newIdx);
    setItems(next);
    invoke("set_pin_order", { ids: next.map((it) => it.id) }).catch(console.error);
  };

  const sections: { start: number; end: number; type: "gridWrap" | "list" }[] = composite
    ? [
        { start: 0, end: imgItems.length, type: "list" },
        { start: imgItems.length, end: imgItems.length + fileItems.length, type: "list" },
        { start: imgItems.length + fileItems.length, end: ordered.length, type: "list" },
      ]
    : [
        {
          start: 0,
          end: ordered.length,
          type: filter === "image" || filter === "files" ? "gridWrap" : "list",
        },
      ];

  const { ref: imgScrollRef } = useHorizontalWheel<HTMLDivElement>();
  const { ref: fileScrollRef } = useHorizontalWheel<HTMLDivElement>();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridStep = () => {
    const el = gridRef.current;
    const cell = el?.querySelector<HTMLElement>("[data-cell]");
    if (!el || !cell) return 1;
    const total = cell.offsetWidth + 8;
    if (total <= 0) return 1;
    return Math.max(1, Math.floor(el.clientWidth / total));
  };

  const cellBtn = (
    item: ItemDto,
    index: number,
    size: { w: number; h: number },
    children: React.ReactNode,
  ) => (
    <button
      key={item.id}
      data-index={index}
      data-cell
      onClick={() => doPaste(item.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, item });
      }}
      onMouseEnter={() => setSelected(item.id)}
      className={cn(
        "relative overflow-hidden rounded-md border transition-colors",
        selected === item.id
          ? "border-primary ring-2 ring-primary/40"
          : "border-transparent hover:border-accent",
      )}
      style={{ width: size.w, height: size.h }}
    >
      {children}
      {item.pinned && (
        <Pin className="absolute left-0.5 top-0.5 size-3 text-white drop-shadow" />
      )}
      {showTimestamps && (
        <span className="absolute right-0.5 top-0.5 rounded bg-black/50 px-1 text-[8px] leading-3 text-white">
          {fmtTime(item.created_at)}
        </span>
      )}
    </button>
  );

  const imageCell = (item: ItemDto, index: number) => {
    if (item.kind === "files") {
      const path = item.preview;
      if (fileThumbs[path]) {
        return cellBtn(
          item,
          index,
          { w: cellSize, h: cellSize },
          <img
            src={`data:image/png;base64,${fileThumbs[path]}`}
            className="h-full w-full object-cover"
            alt=""
          />,
        );
      }
      if (path) fileThumbOf(path);
      return cellBtn(
        item,
        index,
        { w: cellSize, h: cellSize },
        <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 p-0.5">
          {fileIcons[path] ? (
            <img
              src={`data:image/png;base64,${fileIcons[path]}`}
              className="size-6 shrink-0 object-contain"
              alt=""
            />
          ) : (
            <div className="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-[9px] text-muted-foreground">
              文件
            </div>
          )}
          <span className="w-full truncate px-1 text-center text-[9px] text-muted-foreground" title={path}>
            {fileBasename(path)}
          </span>
        </div>,
      );
    }
    return cellBtn(
      item,
      index,
      { w: cellSize, h: cellSize },
      thumbs[item.id] ? (
        <LazyImage
          src={`data:image/png;base64,${thumbs[item.id]}`}
          className="h-full w-full"
          alt=""
        />
      ) : (
        <div className="h-full w-full bg-muted" />
      ),
    );
  };

  const fileCell = (item: ItemDto, index: number) => {
    const path = item.preview;
    if (path) fileIconOf(path);
    return cellBtn(
      item,
      index,
      { w: cellSize, h: cellSize },
      <div className="relative h-full w-full">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {fileIcons[path] ? (
            <img
              src={`data:image/png;base64,${fileIcons[path]}`}
              className="size-8 object-contain"
              alt=""
            />
          ) : (
            <div className="flex size-8 items-center justify-center rounded bg-muted text-[9px] text-muted-foreground">
              文件
            </div>
          )}
        </div>
        <span
          className="absolute bottom-1 left-1/2 w-full max-w-full -translate-x-1/2 truncate px-1 text-center text-[9px] text-muted-foreground"
          title={path}
        >
          {fileBasename(path)}
        </span>
      </div>,
    );
  };

  const textRowCard = (item: ItemDto, index: number) => (
    <div
      data-index={index}
      onClick={() => doPaste(item.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, item });
      }}
      onMouseEnter={() => setSelected(item.id)}
      className={cn(
        "flex w-full cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 transition-colors",
        selected === item.id
          ? "border-primary ring-2 ring-primary/40"
          : "border-border bg-card hover:border-accent",
      )}
    >
      <div
        className={cn(
          "whitespace-pre-wrap break-words text-xs leading-relaxed",
          LINE_CLAMP[textLines] ?? "line-clamp-2",
        )}
        title={item.full ?? item.preview}
      >
        {item.preview}
      </div>
      <div className="flex items-center text-[10px] text-muted-foreground">
        {showTimestamps ? (
          <span className="ml-auto">{fmtTime(item.created_at)}</span>
        ) : (
          <span className="ml-auto" />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            del(item.id);
          }}
          aria-label="删除"
          className="ml-0.5 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            togglePin(item.id, !item.pinned);
          }}
          aria-label={item.pinned ? "取消置顶" : "置顶"}
          className={cn(
            "ml-0.5 rounded p-1 transition-colors hover:bg-accent",
            item.pinned ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Pin className="size-3.5" />
        </button>
      </div>
    </div>
  );

  const textRow = (item: ItemDto, index: number) => (
    <li key={item.id}>{textRowCard(item, index)}</li>
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (showSettings) return;
    if (e.key === "Enter" && selected != null && popup) {
      e.preventDefault();
      doPaste(selected);
      return;
    }
    if (e.key === "Escape" && popup) {
      hideWindow();
      return;
    }
    if (e.key === "Delete" && selected != null) {
      del(selected);
      return;
    }
    const idx = ordered.findIndex((i) => i.id === selected);
    if (idx < 0) return;
    const sec = sections.find((s) => idx >= s.start && idx < s.end);
    if (!sec) return;
    const clamp = (d: number) => Math.min(sec.end - 1, Math.max(sec.start, idx + d));
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        next = clamp(1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        next = clamp(-1);
        break;
      case "ArrowDown":
        e.preventDefault();
        next = sec.type === "gridWrap" ? clamp(gridStep()) : clamp(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        next = sec.type === "gridWrap" ? clamp(-gridStep()) : clamp(-1);
        break;
    }
    if (next != null && next !== idx) {
      setSelected(ordered[next].id);
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-index="${next}"]`)
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    }
  };

  return (
    <div
      ref={popup ? entranceRef : undefined}
      className={cn(
        "flex h-full flex-col bg-background text-foreground",
        popup && "animate-in fade-in-0 duration-150",
      )}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2 border-b p-2">
        {popup && (
          <div
            data-tauri-drag-region
            className="flex shrink-0 cursor-grab items-center self-stretch px-2 text-muted-foreground hover:text-foreground"
            title="拖动窗口"
          >
            <GripVertical className="pointer-events-none size-4" />
          </div>
        )}
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          id="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索剪贴板历史…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autoFocus
        />
        {!popup && (
          <button
            onClick={() => {
              if (!clipCfg) refreshClipCfg();
              setShowSettings((v) => !v);
            }}
            aria-label="剪贴板设置"
            className={cn(
              "shrink-0 rounded p-1.5 transition-colors",
              showSettings
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Settings2 className="size-4" />
          </button>
        )}
      </div>

      {showSettings ? (
        <div className="flex-1 overflow-y-auto">
          <ClipSettings
            maxItems={clipCfg?.maxItems ?? 500}
            hotkey={clipCfg?.hotkey ?? "Ctrl+Shift+V"}
            followMouse={clipCfg?.followMouse ?? true}
            onMaxItems={refreshClipCfg}
            onHotkey={refreshClipCfg}
            onFollowMouse={refreshClipCfg}
            onRefresh={refreshClipCfg}
          />
        </div>
      ) : (
        <>
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

      {composite ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          {imgItems.length > 0 && (
            <div ref={imgScrollRef} className="shrink-0 overflow-x-auto px-2 pt-2">
              {pinned ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e) => handleSectionDragEnd("img", e)}
                >
                  <SortableContext
                    items={imgItems.map((it) => String(it.id))}
                    strategy={rectSortingStrategy}
                  >
                    <div
                      className="grid grid-flow-col grid-rows-1 gap-2"
                      style={{ gridAutoColumns: `${cellSize}px` }}
                    >
                      {imgItems.map((item, i) => (
                        <PinnedSortable key={item.id} id={String(item.id)}>
                          {imageCell(item, i)}
                        </PinnedSortable>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <div
                  className="grid grid-flow-col grid-rows-1 gap-2"
                  style={{ gridAutoColumns: `${cellSize}px` }}
                >
                  {imgItems.map((item, i) => imageCell(item, i))}
                </div>
              )}
            </div>
          )}
          {fileItems.length > 0 && (
            <div ref={fileScrollRef} className="shrink-0 overflow-x-auto border-t px-2 pt-2">
              {pinned ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e) => handleSectionDragEnd("file", e)}
                >
                  <SortableContext
                    items={fileItems.map((it) => String(it.id))}
                    strategy={rectSortingStrategy}
                  >
                    <div
                      className="grid grid-flow-col grid-rows-1 gap-2"
                      style={{ gridAutoColumns: `${cellSize}px` }}
                    >
                      {fileItems.map((item, i) => (
                        <PinnedSortable key={item.id} id={String(item.id)}>
                          {fileCell(item, imgItems.length + i)}
                        </PinnedSortable>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <div
                  className="grid grid-flow-col grid-rows-1 gap-2"
                  style={{ gridAutoColumns: `${cellSize}px` }}
                >
                  {fileItems.map((item, i) => fileCell(item, imgItems.length + i))}
                </div>
              )}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-1">
            {ordered.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {search ? "无匹配记录" : "暂无剪贴板记录"}
              </div>
            ) : textItems.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">无文本记录</div>
            ) : pinned ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => handleSectionDragEnd("text", e)}
              >
                <SortableContext
                  items={textItems.map((it) => String(it.id))}
                  strategy={rectSortingStrategy}
                >
                  <div className="space-y-2">
                    {textItems.map((item, i) => (
                      <PinnedSortable key={item.id} id={String(item.id)}>
                        {textRowCard(item, imgItems.length + fileItems.length + i)}
                      </PinnedSortable>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <ul className="space-y-2">
                {textItems.map((item, i) =>
                  textRow(item, imgItems.length + fileItems.length + i),
                )}
              </ul>
            )}
          </div>
        </div>
      ) : filter === "image" ? (
        <div ref={gridRef} className="flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {search ? "无匹配记录" : "暂无图片记录"}
            </div>
          ) : (
            <div
              className="grid gap-2"
              style={{
                gridAutoRows: `${cellSize}px`,
                gridTemplateColumns: `repeat(auto-fill, ${cellSize}px)`,
              }}
            >
              {items.map((item, i) => imageCell(item, i))}
            </div>
          )}
        </div>
      ) : filter === "files" ? (
        <div ref={gridRef} className="flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {search ? "无匹配记录" : "暂无文件记录"}
            </div>
          ) : (
            <div
              className="grid gap-2"
              style={{
                gridAutoRows: `${cellSize}px`,
                gridTemplateColumns: `repeat(auto-fill, ${cellSize}px)`,
              }}
            >
              {items.map((item, i) => fileCell(item, i))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-1">
          {items.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {search ? "无匹配记录" : "暂无文本记录"}
            </div>
          ) : (
            <ul className="space-y-2">{items.map((item, i) => textRow(item, i))}</ul>
          )}
        </div>
      )}
        </>
      )}

      {menu && (
        <div
          ref={menuRef}
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
          {isImageItem(menu.item) && (
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