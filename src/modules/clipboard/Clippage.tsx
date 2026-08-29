import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { ModuleHeader, HeaderButton } from "@/components/module-header";
import { useModuleConfig } from "@/hooks/useModuleConfig";
import { useFileIcons } from "@/hooks/useFileIcons";
import { CLIPBOARD_DEFAULTS } from "./config";
import { Drawer } from "@/components/ui/drawer";
import { Pin, FolderOpen, Settings2, StickyNote, SearchX, ClipboardList, ImageOff, FileQuestion, Type, Image } from "lucide-react";
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
  rectSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useHorizontalWheel } from "@/lib/use-horizontal-wheel";
import { toast } from "@/lib/toast";
import { ClipSettings } from "./ClipSettings";
import { LazyImage } from "@/components/LazyImage";
import {
  ItemActionColumn,
  ClipboardContextMenu,
  PreviewOverlay,
  type ItemDto,
} from "./parts";
import {
  EmptyState,
  PinnedSortable,
  LINE_CLAMP,
  DayHeader,
  dayKey,
  dayLabel,
  fileBasename,
  fmtTime,
  highlight,
  isImageItem,
} from "./ui-shared";

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

export function Clippage() {
  const [allItems, setAllItems] = useState<ItemDto[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: ItemDto } | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  // 文件图标/缩略图缓存（共享 Hook）
  const { icons: fileIcons, thumbs: fileThumbs, loadIcon: fileIconOf, loadThumb: fileThumbOf } = useFileIcons();
  const [showSettings, setShowSettings] = useState(false);
  // 统一配置（共享 Hook：读写/键名映射/focus 重读全部内置）
  const { cfg: clipCfg, update: updateClipCfg } = useModuleConfig("clipboard", CLIPBOARD_DEFAULTS);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // 图片尺寸/体积角标（大图预览头部展示）
  const [previewInfo, setPreviewInfo] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");

  // 本地搜索：根据 search + filter 内存过滤（纳秒级，无需 IPC）
  const items = useMemo(() => {
    let result = allItems;
    // 按类型过滤
    if (filter === "pinned") {
      result = result.filter((it) => it.pinned);
    } else if (filter === "text") {
      result = result.filter((it) => it.kind === "text");
    } else if (filter === "image") {
      result = result.filter(isImageItem);
    } else if (filter === "files") {
      result = result.filter((it) => it.kind === "files" && !isImageItem(it));
    }
    // 按关键词过滤（内容 + 文件路径 + 备注）；空格分词，多个词需全部命中（AND）
    const kws = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (kws.length > 0) {
      result = result.filter((it) => {
        const hay = `${it.preview} ${it.full ?? ""} ${it.note ?? ""}`.toLowerCase();
        return kws.every((k) => hay.includes(k));
      });
    }
    return result;
  }, [allItems, search, filter]);

  // 搜索关键词（供高亮与空结果提示共用）
  const searchKws = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search],
  );

  // 加载全部数据（一次性，不再每次搜索都调用）
  const load = useCallback(async () => {
    try {
      const list = await invoke<ItemDto[]>("get_all_history");
      setAllItems(list);
      setSelected((cur) => (list.some((i) => i.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch (e) {
      console.error("load history failed", e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const un = listen("clipboard://changed", () => load());
    return () => {
      un.then((fn) => fn());
    };
  }, [load]);

  // 缩略图预载：rAF 分片（每帧 6 张），避免图片历史多时全量并发 IPC
  useEffect(() => {
    const images = items.filter(
      (it) =>
        (it.kind === "image" && !thumbs[it.id]) ||
        (it.kind === "files" && isImageItem(it) && !fileThumbs[it.preview]),
    );
    if (!images.length) return;
    let i = 0;
    const BATCH = 6;
    const tick = () => {
      const end = Math.min(i + BATCH, images.length);
      for (; i < end; i++) {
        const it = images[i];
        if (it.kind === "image") {
          invoke<string | null>("get_thumb", { id: it.id }).then((b) => {
            if (b) setThumbs((prev) => ({ ...prev, [it.id]: b! }));
          });
        } else {
          fileThumbOf(it.preview);
        }
      }
      if (i < images.length) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [items, thumbs, fileThumbs, fileThumbOf]);

  const onSearchChange = (v: string) => {
    setSearch(v);
  };

  const doPaste = async (id: number) => {
    try {
      await invoke("paste_item", { id });
    } catch (e) {
      // 失败保留窗口：toast 渲染在本窗口内，先隐藏=错误完全不可见（表现为"点了没反应"）
      toast(String(e));
      return;
    }
    hideWindow();
  };

  const togglePin = async (id: number, pinned: boolean) => {
    try {
      await invoke("pin_item", { id, pinned });
      await load();
    } catch (e) {
      toast(String(e));
    } finally {
      setMenu(null);
    }
  };

  const del = async (id: number) => {
    if (!window.confirm("确定要删除这条记录吗？")) return;
    try {
      await invoke("delete_item", { id });
      await load();
    } catch (e) {
      toast(String(e));
    } finally {
      setMenu(null);
    }
  };

  const copy = async (id: number) => {
    try {
      await invoke("copy_item", { id });
    } catch (e) {
      toast(String(e));
    } finally {
      setMenu(null);
    }
  };

  // 复制为纯文本（不保留富文本格式）
  const copyPlain = async (id: number) => {
    try {
      await invoke("copy_item", { id, plain: true });
      toast("已复制为纯文本");
    } catch (e) {
      toast(String(e));
    } finally {
      setMenu(null);
    }
  };

  // 用系统默认程序打开原图（图片条目存的是应用内部副本，交给系统看图）
  const openImageExternal = async (item: ItemDto) => {
    setMenu(null);
    try {
      const path =
        item.kind === "files"
          ? item.preview
          : await invoke<string | null>("get_image_path", { id: item.id });
      if (!path) {
        toast("图片文件不存在");
        return;
      }
      await invoke("open_file", { path });
    } catch (e) {
      toast(String(e));
    }
  };

  const viewImage = async (item: ItemDto) => {
    setMenu(null);
    setPreviewLoading(true);
    setPreviewInfo("");
    setPreview({ src: "", name: item.kind === "files" ? fileBasename(item.preview) : "剪贴板图片" });
    try {
      const b64 =
        item.kind === "files"
          ? await invoke<string | null>("get_file_preview", { path: item.preview })
          : await invoke<string | null>("get_image", { id: item.id });
      if (b64) {
        setPreview({ src: `data:image/png;base64,${b64}`, name: item.kind === "files" ? fileBasename(item.preview) : "剪贴板图片" });
      } else {
        setPreview(null);
        console.error("preview image is empty");
      }
    } catch (e) {
      console.error("load preview failed", e);
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
    // 图片条目附带尺寸与体积（异步取，失败静默）
    if (item.kind === "image") {
      try {
        const info = await invoke<{ width: number; height: number; bytes: number } | null>(
          "get_image_size",
          { id: item.id },
        );
        if (info) {
          const mb = info.bytes / 1024 / 1024;
          setPreviewInfo(
            `${info.width}×${info.height} · ${mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(info.bytes / 1024))} KB`}`,
          );
        }
      } catch {
        // 静默失败
      }
    }
  };

  const addAsEmoji = async (item: ItemDto) => {
    setMenu(null);
    try {
      await invoke("add_clipboard_item_as_emoji", { id: item.id });
      toast("已添加为表情");
    } catch (e) {
      toast(String(e));
    }
  };

  const startEditNote = (item: ItemDto) => {
    setMenu(null);
    setEditingNoteId(item.id);
    setEditingNoteValue(item.note ?? "");
  };

  const saveNote = async () => {
    if (editingNoteId === null) return;
    try {
      const note = editingNoteValue.trim() || null;
      await invoke("set_item_note", { id: editingNoteId, note });
      await load();
    } catch (e) {
      toast(String(e));
    } finally {
      setEditingNoteId(null);
    }
  };

  const composite = filter === "all" || filter === "pinned";
  const pinned = filter === "pinned";
  const cellSize = clipCfg.cellSize;
  const textLines = clipCfg.textLines;
  const showTimestamps = clipCfg.showTimestamps;
  const listMode = clipCfg.listMode;
  const imgItems = composite ? items.filter(isImageItem) : [];
  const fileItems = composite
    ? items.filter((it) => it.kind === "files" && !isImageItem(it))
    : [];
  const textItems = composite ? items.filter((it) => it.kind === "text") : [];
  // 列表模式：全部条目（含各单类型 Tab）统一按时间倒序排列，不分区
  const ordered = listMode ? items : composite ? [...imgItems, ...fileItems, ...textItems] : items;

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
    setAllItems(next);
    invoke("set_pin_order", { ids: next.map((it) => it.id) }).catch(console.error);
  };

  const sections: { start: number; end: number; type: "gridWrap" | "list" }[] = listMode
    ? [{ start: 0, end: ordered.length, type: "list" }]
    : composite
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
  const textListRef = useRef<HTMLDivElement | null>(null);

  // 按天分组渲染：相邻条目跨天时插入分组头；不改变条目顺序与 data-index
  // （键盘导航按 ordered 索引定位，头部不占索引号）
  const groupedNodes = (
    rows: ItemDto[],
    rowFn: (it: ItemDto, idx: number) => React.ReactNode,
  ): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    let lastKey: string | null = null;
    let group: { it: ItemDto; idx: number }[] = [];
    const flush = () => {
      if (!group.length) return;
      const first = group[0].it;
      nodes.push(
        <DayHeader key={`h-${dayKey(first.created_at)}`} label={dayLabel(first.created_at)} count={group.length} />,
      );
      for (const g of group) nodes.push(rowFn(g.it, g.idx));
      group = [];
    };
    rows.forEach((it, idx) => {
      const k = dayKey(it.created_at);
      if (lastKey !== null && k !== lastKey) flush();
      lastKey = k;
      group.push({ it, idx });
    });
    flush();
    return nodes;
  };

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
        "flex w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
        selected === item.id
          ? "border-primary ring-2 ring-primary/40"
          : "border-border bg-card hover:border-accent",
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "whitespace-pre-wrap break-words text-xs leading-relaxed",
            LINE_CLAMP[textLines] ?? "line-clamp-2",
          )}
          title={item.full ?? item.preview}
        >
          {highlight(item.preview, searchKws)}
        </div>
        {editingNoteId === item.id ? (
          <input
            type="text"
            value={editingNoteValue}
            onChange={(e) => setEditingNoteValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveNote();
              if (e.key === "Escape") setEditingNoteId(null);
            }}
            onBlur={saveNote}
            placeholder="输入备注（可选）"
            autoFocus
            onClick={(e) => e.stopPropagation()}
            className="mt-1 w-full rounded border bg-muted px-2 py-1 text-[10px] outline-none focus:border-primary"
          />
        ) : item.note ? (
          <div className="mt-1 flex items-center gap-1 truncate text-[10px] text-muted-foreground" title={item.note}>
            <StickyNote className="size-3 shrink-0" />
            <span className="truncate">{highlight(item.note, searchKws)}</span>
          </div>
        ) : null}
      </div>
      <ItemActionColumn
        item={item}
        showTimestamps={showTimestamps}
        onDelete={del}
        onTogglePin={togglePin}
      />
    </div>
  );

  const textRow = (item: ItemDto, index: number) => (
    <li key={item.id}>{textRowCard(item, index)}</li>
  );

  // 列表模式通用行：图标 | 内容 | 时间（右侧操作常驻）——图片/文件/文本共用
  const listRowCard = (item: ItemDto, index: number) => {
    const isFile = item.kind === "files";
    const isImg = item.kind === "image" || (isFile && isImageItem(item));
    let iconBox: React.ReactNode;
    if (item.kind === "image") {
      iconBox = thumbs[item.id] ? (
        <img
          src={`data:image/png;base64,${thumbs[item.id]}`}
          className="size-9 shrink-0 rounded-md object-cover"
          alt=""
        />
      ) : (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <Image className="size-4 text-muted-foreground" />
        </div>
      );
    } else if (isFile) {
      const path = item.preview;
      if (isImg && fileThumbs[path]) {
        iconBox = (
          <img
            src={`data:image/png;base64,${fileThumbs[path]}`}
            className="size-9 shrink-0 rounded-md object-cover"
            alt=""
          />
        );
      } else if (fileIcons[path]) {
        iconBox = (
          <img
            src={`data:image/png;base64,${fileIcons[path]}`}
            className="size-9 shrink-0 rounded-md bg-muted p-1 object-contain"
            alt=""
          />
        );
      } else {
        iconBox = (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
            <FolderOpen className="size-4 text-muted-foreground" />
          </div>
        );
      }
    } else {
      iconBox = (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10">
          <Type className="size-4 text-emerald-500" />
        </div>
      );
    }
    const title = isFile ? `${fileBasename(item.preview)}\n${item.preview}` : (item.full ?? item.preview);
    return (
      <div
        data-index={index}
        onClick={() => doPaste(item.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, item });
        }}
        onMouseEnter={() => setSelected(item.id)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
          selected === item.id
            ? "border-primary ring-2 ring-primary/40"
            : "border-border bg-card hover:border-accent",
        )}
      >
        {iconBox}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "text-xs leading-relaxed",
              item.kind === "text" ? (LINE_CLAMP[textLines] ?? "line-clamp-2") : "truncate",
            )}
            title={title}
          >
            {item.kind === "text"
              ? highlight(item.preview, searchKws)
              : isFile
                ? fileBasename(item.preview)
                : (item.preview || "剪贴板图片")}
          </div>
          {isFile && <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.preview}</div>}
        </div>
        {/* 右侧：时间 + 常驻操作 */}
        <ItemActionColumn
          item={item}
          showTimestamps={showTimestamps}
          hover={false}
          onDelete={del}
          onTogglePin={togglePin}
        />
      </div>
    );
  };

  const listRow = (item: ItemDto, index: number) => (
    <li key={item.id}>{listRowCard(item, index)}</li>
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (showSettings) return;
    if (e.key === "Escape") {
      if (menu) {
        setMenu(null); // 右键菜单开着时 Esc 只关菜单，不隐藏整窗
        return;
      }
      if (preview) {
        setPreview(null);
        return;
      }
    }
    // 右键菜单/大图预览打开时，Enter/数字键不触发粘贴
    if (menu || preview) return;
    // Enter 粘贴选中项：键盘流闭合（触控笔/纯键盘用户）
    if (e.key === "Enter" && selected != null) {
      e.preventDefault();
      doPaste(selected);
      return;
    }
    // 数字键 1-9 直贴第 N 条（焦点在搜索框时正常输入数字）
    if (e.key >= "1" && e.key <= "9") {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const target = ordered[Number(e.key) - 1];
      if (target) {
        e.preventDefault();
        doPaste(target.id);
      }
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
      className={cn(
        "relative flex h-full flex-col bg-background text-foreground",
      )}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ModuleHeader
        search={{
          value: search,
          onChange: onSearchChange,
          placeholder: "搜索剪贴板历史…",
          autoFocus: true,
          trailing: search.trim() ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {items.length} 条结果
            </span>
          ) : null,
        }}
        actions={
          <HeaderButton
            title="剪贴板设置"
            active={showSettings}
            onClick={() => setShowSettings((v) => !v)}
          >
            <Settings2 className="size-4" />
          </HeaderButton>
        }
        tabs={FILTERS.map((f) => ({ id: f.id, label: f.label }))}
        activeTab={filter}
        onTabChange={(id) => setFilter(id as Filter)}
      />

      <>

      {allItems.length >= 500 && (
        <div className="flex shrink-0 items-center justify-center gap-1 border-b bg-amber-500/10 px-3 py-1 text-[10px] text-amber-600 dark:text-amber-400">
          <ClipboardList className="size-3" />
          已达 500 条上限，复制新内容会自动替换最旧记录
        </div>
      )}

      {listMode ? (
        <div ref={textListRef} className="flex-1 overflow-y-auto p-1">
          {items.length === 0 ? (
            <EmptyState
              icon={search ? SearchX : ClipboardList}
              title={
                search
                  ? `未找到匹配「${search}」的记录`
                  : filter === "text"
                    ? "暂无文本记录"
                    : filter === "image"
                      ? "暂无图片记录"
                      : filter === "files"
                        ? "暂无文件记录"
                        : "暂无剪贴板记录"
              }
              description={!search ? "复制内容后会自动出现在这里" : undefined}
            />
          ) : (
            <ul className="space-y-1">
              {groupedNodes(ordered, (it, idx) => listRow(it, idx))}
            </ul>
          )}
        </div>
      ) : composite ? (
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
              <EmptyState
                icon={search ? SearchX : ClipboardList}
                title={search ? `未找到匹配「${search}」的记录` : "暂无剪贴板记录"}
                description={!search ? "复制内容后会自动出现在这里" : undefined}
              />
            ) : textItems.length === 0 ? (
              <EmptyState icon={ClipboardList} title="无文本记录" />
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
              <ul className="space-y-1">
                {groupedNodes(textItems, (it, idx) =>
                  textRow(it, imgItems.length + fileItems.length + idx),
                )}
              </ul>
            )}
          </div>
        </div>
      ) : filter === "image" ? (
        <div ref={gridRef} className="flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <EmptyState
              icon={search ? SearchX : ImageOff}
              title={search ? `未找到匹配「${search}」的记录` : "暂无图片记录"}
              description={!search ? "复制图片后会自动出现在这里" : undefined}
            />
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
            <EmptyState
              icon={search ? SearchX : FileQuestion}
              title={search ? `未找到匹配「${search}」的记录` : "暂无文件记录"}
              description={!search ? "复制文件后会自动出现在这里" : undefined}
            />
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
        <div ref={textListRef} className="flex-1 overflow-y-auto p-1">
          {items.length === 0 ? (
            <EmptyState
              icon={search ? SearchX : ClipboardList}
              title={search ? `未找到匹配「${search}」的记录` : "暂无文本记录"}
              description={!search ? "复制文本后会自动出现在这里" : undefined}
            />
          ) : (
            <ul className="space-y-1">{groupedNodes(items, textRow)}</ul>
          )}
        </div>
      )}
        </>

      <ClipboardContextMenu
        menu={menu}
        onClose={() => setMenu(null)}
        handlers={{
          onTogglePin: togglePin,
          onCopy: copy,
          onCopyPlain: copyPlain,
          onAddEmoji: addAsEmoji,
          onViewImage: viewImage,
          onOpenExternal: openImageExternal,
          onOpenLocation: (path) => {
            invoke("open_file_location", { path }).catch(console.error);
            setMenu(null);
          },
          onEditNote: startEditNote,
          onDelete: del,
        }}
      />

      <PreviewOverlay
        preview={preview}
        info={previewInfo}
        loading={previewLoading}
        onClose={() => setPreview(null)}
      />

      <Drawer open={showSettings} onClose={() => setShowSettings(false)} title="剪贴板设置">
        <ClipSettings cfg={clipCfg} onUpdate={updateClipCfg} />
      </Drawer>
    </div>
  );
}