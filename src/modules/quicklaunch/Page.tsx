import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ItemCard, QuicklaunchItem } from "./ItemCard";
import { GroupCard } from "./GroupCard";
import { FolderOverlay } from "./FolderOverlay";
import { QuicklaunchSettings } from "./Settings";
import type { ScannedApp } from "./AppPicker";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ContextMenu } from "@/components/ui/context-menu";
import { ContextMenuItem } from "@/components/ui/context-menu-item";
import { ContextMenuDivider } from "@/components/ui/context-menu-divider";
import { Plus, FolderPlus, Settings2, ClipboardPaste, LayoutList, LayoutGrid, FileQuestion, Pin, PinOff } from "lucide-react";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { ModuleHeader, HeaderButton, HeaderSort } from "@/components/module-header";
import { useModuleConfig } from "@/hooks/useModuleConfig";
import { useWindowEntrance } from "@/lib/use-window-entrance";
import { toast } from "@/lib/toast";
import { listen } from "@tauri-apps/api/event";
import { useFileIcons } from "@/hooks/useFileIcons";
import { gridColumns, gridIconSize, gridFontScale, gridVerticalTarget } from "@/lib/grid";
import { cn } from "@/lib/utils";

// ==================== 配置类型（对齐文件搜索模块） ====================

export type FilterType =
  | "all"
  | "app"
  | "file"
  | "folder"
  | "url"
  | "sysapps";

const QL_FILTERS: { id: FilterType; label: string }[] = [
  { id: "all", label: "固定" },
  { id: "sysapps", label: "全部应用" },
  { id: "app", label: "应用" },
  { id: "file", label: "文件" },
  { id: "folder", label: "文件夹" },
  { id: "url", label: "URL" },
];

interface QuicklaunchConfig {
  viewMode: "grid" | "list";
  sortBy: "manual" | "name" | "created_at" | "usage";
  sortDesc: boolean;
  /** 「全部应用」Tab 独立排序记忆 */
  sysSortBy: "name" | "usage";
  sysSortDesc: boolean;
  gridSize: number;
  showExtension: boolean;
  singleClickOpen: boolean;
}

const QL_DEFAULTS: QuicklaunchConfig = {
  viewMode: "grid",
  sortBy: "manual",
  sortDesc: false,
  gridSize: 64,
  showExtension: true,
  singleClickOpen: false,
  sysSortBy: "name",
  sysSortDesc: false,
};

export { QL_DEFAULTS };
export type { QuicklaunchConfig };

// ==================== 内部组件 ====================

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  type: "panel" | "item" | "folder";
  item?: QuicklaunchItem;
  folderId?: number;
  folderPosition?: { x: number; y: number };
}

// 可排序的项目包装组件
function SortableItem({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "z-10 opacity-70")}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

export interface FolderWithItems {
  id: number;
  name: string;
  items: QuicklaunchItem[];
}

/** 系统应用网格（「系统应用」Tab 与顶栏搜索结果共用） */
function SysAppGrid({
  apps,
  search,
  gridSize,
  sortBy,
  sortDesc,
  icons,
  loadIcon,
  onOpen,
  onTogglePin,
}: {
  apps: ScannedApp[] | null;
  search: string;
  gridSize: number;
  sortBy: "name" | "usage";
  sortDesc: boolean;
  icons: Record<string, string>;
  loadIcon: (path: string) => Promise<void>;
  onOpen: (path: string) => void;
  onTogglePin: (app: ScannedApp) => void;
}) {
  const list = useMemo(() => {
    const filtered = (apps ?? []).filter((a) =>
      a.name.toLowerCase().includes(search.trim().toLowerCase()),
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
  }, [apps, search, sortBy, sortDesc]);
  if (apps === null) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        正在扫描系统应用…
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
            title={`${a.name}\n${a.path}${a.fixed ? "\n（已固定，点击打开）" : ""}`}
            onClick={() => onOpen(a.path)}
            className={cn(
              "group relative flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-transparent transition-colors hover:bg-accent/50",
            )}
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
            {/* 已固定常亮角标 */}
            {a.fixed && (
              <Pin className="absolute right-1 top-1 size-3.5 fill-primary text-primary" />
            )}
            {/* 悬浮固定/取消固定按钮（覆盖角标位置） */}
            <button
              title={a.fixed ? "取消固定" : "固定到快速启动"}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(a);
              }}
              className="absolute right-0.5 top-0.5 hidden rounded-md border bg-background/95 p-1 shadow-sm group-hover:flex hover:bg-accent"
            >
              {a.fixed ? (
                <PinOff className="size-3 text-muted-foreground" />
              ) : (
                <Pin className="size-3 fill-primary text-primary" />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function QuicklaunchPage({ popup = false }: { popup?: boolean }) {
  const [items, setItems] = useState<QuicklaunchItem[]>([]);
  const [foldersWithItems, setFoldersWithItems] = useState<FolderWithItems[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    type: "panel",
  });
  const [folders, setFolders] = useState<{ id: number; name: string }[]>([]);
  const [expandedFolder, setExpandedFolder] = useState<number | null>(null);
  const { prompt, PromptDialog } = usePrompt();
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const entranceRef = useWindowEntrance(popup, ["animate-in", "fade-in-0"]);

  // 统一配置（共享 Hook：读写/键名映射/focus 重读全部内置）
  const { cfg, update: updateConfig } = useModuleConfig("quicklaunch", QL_DEFAULTS);

  // 框选状态
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);

  // 切换视图（面板头右侧按钮用）
  const toggleView = useCallback(() => {
    updateConfig({ viewMode: cfg.viewMode === "grid" ? "list" : "grid" });
  }, [updateConfig, cfg.viewMode]);

  // 按需加载文件图标（共享缓存 Hook）
  const { icons: fileIcons, loadIcon: loadFileIcon } = useFileIcons();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => String(item.id) === active.id);
    const newIndex = items.findIndex((item) => String(item.id) === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const newItems = arrayMove(items, oldIndex, newIndex);
    setItems(newItems);

    // 保存手动排序顺序到缓存（用于排序记忆功能）
    manualOrderRef.current = newItems.map((item) => item.id);

    // 保存排序到后端
    invoke("quicklaunch_sort_items", {
      itemIds: newItems.map((item) => item.id),
    }).catch(console.error);
  };

  // 手动排序缓存（用于排序记忆功能）
  const manualOrderRef = useRef<number[]>([]);

  const fetchItems = useCallback(async () => {
    try {
      const filterOptions = {
        item_type: filter === "all" ? null : filter,
        search: search || null,
        sort_by: cfg.sortBy === "manual" ? "sort_order" : cfg.sortBy,
        sort_desc: cfg.sortDesc,
      };
      const result = await invoke<QuicklaunchItem[]>("quicklaunch_list_items", {
        filter: filterOptions,
      });

      if (cfg.sortBy === "manual") {
        if (manualOrderRef.current.length === 0) {
          manualOrderRef.current = result.map((item) => item.id);
        }
        const ordered = [...result].sort((a, b) => {
          const aIdx = manualOrderRef.current.indexOf(a.id);
          const bIdx = manualOrderRef.current.indexOf(b.id);
          if (aIdx === -1 && bIdx === -1) return a.sort_order - b.sort_order;
          if (aIdx === -1) return 1;
          if (bIdx === -1) return -1;
          return aIdx - bIdx;
        });
        setItems(ordered);
        for (const item of ordered) {
          if (item.item_type !== "url") loadFileIcon(item.path);
        }
      } else {
        // 非手动排序：名称走拼音 localeCompare；频率按累计次数；方向系数使升降序生效
        const sorted = [...result].sort((a, b) => {
          if (cfg.sortBy === "usage") {
            return cfg.sortDesc
              ? a.usage_count - b.usage_count
              : b.usage_count - a.usage_count;
          }
          const cmp =
            cfg.sortBy === "name"
              ? a.name.localeCompare(b.name, "zh-CN-u-co-pinyin")
              : a.created_at.localeCompare(b.created_at);
          return cfg.sortDesc ? -cmp : cmp;
        });
        setItems(sorted);
        for (const item of sorted) {
          if (item.item_type !== "url") loadFileIcon(item.path);
        }
      }
    } catch (e) {
      console.error("Failed to fetch items:", e);
    }
  }, [filter, search, cfg.sortBy, cfg.sortDesc, loadFileIcon]);

  const fetchFolders = useCallback(async () => {
    try {
      const result = await invoke<{ id: number; name: string }[]>("quicklaunch_list_folders", {
        parentId: null,
      });
      setFolders(result);
      
      // 获取分组及其子项目
      const foldersWithItemsResult = await invoke<[any, any[]][]>("quicklaunch_list_folders_with_items");
      const foldersWithItemsData: FolderWithItems[] = foldersWithItemsResult.map(([folder, items]) => ({
        id: folder.id,
        name: folder.name,
        items: items,
      }));
      setFoldersWithItems(foldersWithItemsData);
      
      // 加载子项目的图标
      for (const folderData of foldersWithItemsResult) {
        for (const item of folderData[1]) {
          if (item.item_type !== "url") {
            loadFileIcon(item.path);
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch folders:", e);
    }
  }, [loadFileIcon]);

  useEffect(() => {
    fetchItems().then(() => setLoading(false));
    fetchFolders();
  }, [fetchItems, fetchFolders]);

  // 后台前台监测推送：局部更新命中条目的使用次数（不整表刷新）
  useEffect(() => {
    const un = listen<{ id: number; usage_count: number }[]>(
      "quicklaunch://usage",
      (e) => {
        const map = new Map(e.payload.map((u) => [u.id, u.usage_count]));
        setItems((prev) =>
          prev.map((it) =>
            map.has(it.id) ? { ...it, usage_count: map.get(it.id)! } : it,
          ),
        );
        setFoldersWithItems((prev) =>
          prev.map((f) => ({
            ...f,
            items: f.items.map((it) =>
              map.has(it.id)
                ? { ...it, usage_count: map.get(it.id)! }
                : it,
            ),
          })),
        );
      },
    );
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  // 系统应用库：进入页面与固定项变化后重新扫描（后台线程，带 fixed 标记）
  const [sysApps, setSysApps] = useState<ScannedApp[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    invoke<ScannedApp[]>("quicklaunch_scan_apps", {
      fixedPaths: items.map((i) => i.path),
    })
      .then((res) => {
        if (!cancelled) setSysApps(res);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [items]);

  const openSysApp = async (path: string) => {
    try {
      await invoke("quicklaunch_open_path", { path });
    } catch (e) {
      toast(`打开失败：${e}`);
    }
  };

  // 全部应用 Tab：一键固定 / 取消固定（按解析目标匹配）
  const togglePinSysApp = async (a: ScannedApp) => {
    try {
      if (a.fixed) {
        await invoke("quicklaunch_unpin_by_target", { path: a.path });
        toast(`已取消固定「${a.name}」`);
      } else {
        await invoke("quicklaunch_add_from_path", { path: a.path });
        toast(`已固定「${a.name}」`);
      }
      fetchItems();
    } catch (e) {
      toast(String(e));
    }
  };



  const handleOpen = async (item: QuicklaunchItem) => {
    try {
      await invoke("quicklaunch_open_item", { item });
    } catch (e) {
      toast(`打开失败：${e}`);
      console.error("Failed to open item:", e);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await invoke("quicklaunch_delete_item", { id });
      fetchItems();
    } catch (e) {
      toast(`删除失败：${e}`);
      console.error("Failed to delete item:", e);
    }
  };

  const handleRename = async (id: number, name: string) => {
    try {
      await invoke("quicklaunch_update_item", { id, name });
      fetchItems();
    } catch (e) {
      toast(`重命名失败：${e}`);
      console.error("Failed to rename item:", e);
    }
  };

  // 键盘导航：↑↓ 移动高亮（网格模式按列数跳行）、Enter 打开、Delete 删除、Esc 关弹层/隐藏窗口
  const [kbIdx, setKbIdx] = useState<number | null>(null);

  // 键盘导航序列：网格视图下分组卡排在条目前面，需计入偏移（列表视图无分组卡）
  const kbGroupCount = cfg.viewMode === "grid" ? foldersWithItems.length : 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (expandedFolder != null) setExpandedFolder(null);
      else if (popup) getCurrentWindow().hide();
      return;
    }
    // 系统应用 Tab 是启动器网格，暂不支持键盘导航
    if (filter === "sysapps") return;
    const total = kbGroupCount + items.length;
    if (!total) return;
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (dir !== 0) {
      e.preventDefault();
      const cols =
        cfg.viewMode === "grid" && gridRef.current
          ? gridColumns(gridRef.current)
          : 1;
      setKbIdx((i) => gridVerticalTarget(i ?? -1, dir, total, cols));
    } else if (e.key === "Enter" && kbIdx != null && kbIdx < total) {
      e.preventDefault();
      if (kbIdx < kbGroupCount) {
        setExpandedFolder(foldersWithItems[kbIdx]?.id ?? null);
      } else {
        const it = items[kbIdx - kbGroupCount];
        if (it) handleOpen(it);
      }
    } else if (
      e.key === "Delete" &&
      kbIdx != null &&
      kbIdx >= kbGroupCount &&
      kbIdx < total
    ) {
      e.preventDefault();
      const it = items[kbIdx - kbGroupCount];
      if (it) {
        handleDelete(it.id);
        setKbIdx(null);
      }
    }
  };

  // 鼠标按下事件（开始框选）
  const handleMouseDown = (e: React.MouseEvent) => {
    // 只在左键点击空白区域时开始框选
    if (e.button !== 0) return;
    if (e.target !== containerRef.current) return;
    
    setIsSelecting(true);
    setSelectionStart({ x: e.clientX, y: e.clientY });
    setSelectionEnd({ x: e.clientX, y: e.clientY });
    
    // 如果没有按住 Ctrl，清空选中
    if (!e.ctrlKey) {
      setSelectedIds(new Set());
    }
  };

  // 鼠标移动事件（更新框选区域）
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting) return;
    setSelectionEnd({ x: e.clientX, y: e.clientY });
  };

  // 鼠标抬起事件（结束框选，选中框内项目）
  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isSelecting) return;
    setIsSelecting(false);
    
    if (!selectionStart || !selectionEnd) return;
    
    // 计算框选区域
    const minX = Math.min(selectionStart.x, selectionEnd.x);
    const maxX = Math.max(selectionStart.x, selectionEnd.x);
    const minY = Math.min(selectionStart.y, selectionEnd.y);
    const maxY = Math.max(selectionStart.y, selectionEnd.y);
    
    // 如果框选区域太小，视为点击
    if (maxX - minX < 5 && maxY - minY < 5) {
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }
    
    // 找到框选区域内的项目
    const container = containerRef.current;
    if (!container) return;
    
    const newSelectedIds = new Set(e.ctrlKey ? selectedIds : []);
    
    const itemElements = container.querySelectorAll("[data-item-id]");
    itemElements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const itemId = Number(el.getAttribute("data-item-id"));
      
      // 检查元素是否在框选区域内
      if (
        rect.left < maxX &&
        rect.right > minX &&
        rect.top < maxY &&
        rect.bottom > minY
      ) {
        newSelectedIds.add(itemId);
      }
    });
    
    setSelectedIds(newSelectedIds);
    setSelectionStart(null);
    setSelectionEnd(null);
  };

  // 项目点击事件（支持 Ctrl 多选）
  const handleItemSelect = (id: number, e?: React.MouseEvent) => {
    if (e?.ctrlKey) {
      // Ctrl + 点击：追加/移除选中
      setSelectedIds((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
        return newSet;
      });
    } else {
      // 普通点击：只选中当前项目
      setSelectedIds(new Set([id]));
    }
  };

  const handleAddItem = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "所有文件", extensions: ["*"] }],
    });
    if (picked) {
      await addPaths(Array.isArray(picked) ? picked : [picked]);
    }
  };

  // 批量添加；重复内容由后端内容级判重拦截
  const addPaths = async (paths: string[]) => {
    for (const path of paths) {
      try {
        await invoke("quicklaunch_add_from_path", { path });
      } catch (e) {
        toast(`添加失败：${e}`);
        console.error("Failed to create item:", e);
      }
    }
    fetchItems();
  };

  const handleAddFolder = async () => {
    const name = await prompt("新建分组", { placeholder: "请输入分组名称" });
    if (name && name.trim()) {
      try {
        await invoke("quicklaunch_create_folder", { name: name.trim() });
        fetchFolders();
      } catch (e) {
        toast(`新建分组失败：${e}`);
        console.error("Failed to create folder:", e);
      }
    }
  };

  const handleMoveToFolder = async (itemIds: number[], folderId: number) => {
    try {
      for (const itemId of itemIds) {
        await invoke("quicklaunch_update_item", { id: itemId, folderId });
      }
      fetchItems();
      fetchFolders();
    } catch (e) {
      toast(`移动失败：${e}`);
      console.error("Failed to move items to folder:", e);
    }
  };

  const handleRenameFolder = async (name: string) => {
    if (!expandedFolder) return;
    try {
      await invoke("quicklaunch_update_folder", { id: expandedFolder, name });
      fetchFolders();
    } catch (e) {
      toast(`重命名分组失败：${e}`);
      console.error("Failed to rename folder:", e);
    }
  };

  const handlePastePath = async () => {
    try {
      const text = await invoke<string>("get_clipboard_text");
      if (text && (text.startsWith("C:\\") || text.startsWith("D:\\") || text.startsWith("http"))) {
        await invoke("quicklaunch_add_from_path", { path: text });
        fetchItems();
      } else {
        toast("剪贴板内容不是文件路径或链接");
      }
    } catch (e) {
      toast(`粘贴失败：${e}`);
      console.error("Failed to paste path:", e);
    }
  };

  // 文件拖拽处理（使用 Tauri 的 onDragDropEvent API）
  // 文件拖拽处理
  const dragDropUnlistenRef = useRef<(() => void) | null>(null);
  const processedPathsRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    // 如果已经添加过监听器，先移除
    if (dragDropUnlistenRef.current) {
      dragDropUnlistenRef.current();
      dragDropUnlistenRef.current = null;
    }

    const setupDragDrop = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<{ paths: string[] }>(
        "tauri://drag-drop",
        (event) => {
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            for (const path of paths) {
              if (!processedPathsRef.current.has(path)) {
                processedPathsRef.current.add(path);
                invoke("quicklaunch_add_from_path", { path }).catch((err) => {
                  console.error("Failed to add dropped file:", err);
                });
              }
            }
            // 延迟清理去重集合，允许同一文件在不同拖入操作中被添加
            setTimeout(() => {
              fetchItems();
              processedPathsRef.current.clear();
            }, 1000);
          }
        }
      );
      return unlisten;
    };

    setupDragDrop().then((fn) => {
      dragDropUnlistenRef.current = fn;
    });

    return () => {
      if (dragDropUnlistenRef.current) {
        dragDropUnlistenRef.current();
        dragDropUnlistenRef.current = null;
      }
    };
  }, []);

  // 面板右键菜单
  const handlePanelContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      type: "panel",
    });
  };

  // 项目右键菜单
  const handleItemContextMenu = (e: React.MouseEvent, item: QuicklaunchItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      type: "item",
      item,
    });
  };

  // 获取要操作的项目列表（优先使用多选，否则使用右键点击的项目）
  const getTargetItems = (): QuicklaunchItem[] => {
    if (selectedIds.size > 0) {
      // 有多选项目时，操作所有选中的项目
      return items.filter((item) => selectedIds.has(item.id));
    }
    // 否则只操作右键点击的项目
    return contextMenu.item ? [contextMenu.item] : [];
  };

  const handleContextAction = async (action: string) => {
    const targetItems = getTargetItems();
    setContextMenu((prev) => ({ ...prev, visible: false }));

    switch (action) {
      case "add-item":
        handleAddItem();
        break;
      case "add-folder":
        handleAddFolder();
        break;
      case "paste-path":
        handlePastePath();
        break;
      case "open":
        for (const item of targetItems) {
          handleOpen(item);
        }
        break;
      case "open-location":
        for (const item of targetItems) {
          await invoke("search_open_file_location", { path: item.path });
        }
        break;
      case "copy-path":
        for (const item of targetItems) {
          await invoke("search_copy_path", { path: item.path });
        }
        toast(targetItems.length > 1 ? `已复制 ${targetItems.length} 条路径` : "已复制路径");
        break;
      case "rename":
        if (targetItems.length === 1) {
          const newName = await prompt("重命名", { defaultValue: targetItems[0].name });
          if (newName && newName !== targetItems[0].name) {
            handleRename(targetItems[0].id, newName);
          }
        }
        break;
      case "move-to-folder":
        // 移动功能通过子菜单处理
        break;
      case "delete":
        for (const item of targetItems) {
          await handleDelete(item.id);
        }
        break;
    }
  };

  // 获取当前展开的分组信息
  const expandedFolderData = expandedFolder
    ? foldersWithItems.find((f) => f.id === expandedFolder)
    : null;

  return (
    <div
      ref={popup ? entranceRef : undefined}
      className={cn(
        "relative flex h-full flex-col",
        popup && "animate-in fade-in-0 duration-150",
      )}
      onContextMenu={(e) => e.preventDefault()}
    >
      {PromptDialog}
      
      {/* 分组展开覆盖层 */}
      {expandedFolderData && (
        <FolderOverlay
          folderName={expandedFolderData.name}
          items={expandedFolderData.items}
          gridSize={cfg.gridSize}
          fileIcons={fileIcons}
          selectedId={selectedIds.size > 0 ? Array.from(selectedIds)[0] : null}
          anchorPosition={contextMenu.folderPosition}
          singleClickOpen={cfg.singleClickOpen}
          onSelect={(id) => setSelectedIds(id ? new Set([id]) : new Set())}
          onOpen={handleOpen}
          onDelete={handleDelete}
          onRename={handleRename}
          onContextMenu={handleItemContextMenu}
          onRenameFolder={handleRenameFolder}
          onClose={() => setExpandedFolder(null)}
        />
      )}
      <ModuleHeader
        search={{
          value: search,
          onChange: setSearch,
          placeholder:
            filter === "sysapps" ? "搜索全部应用…" : "搜索固定项…",
          autoFocus: true,
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
              title="快速启动设置"
              active={showSettings}
              onClick={() => setShowSettings(true)}
            >
              <Settings2 className="size-4" />
            </HeaderButton>
          </>
        }
        tabs={QL_FILTERS.map((f) => ({ id: f.id, label: f.label }))}
        activeTab={filter}
        onTabChange={(id) => setFilter(id as FilterType)}
        tabsTrailing={
          filter === "sysapps" ? (
            <HeaderSort
              fields={[
                { id: "name", label: "名称" },
                { id: "usage", label: "频率" },
              ]}
              value={cfg.sysSortBy}
              onChange={(id) =>
                updateConfig({ sysSortBy: id as "name" | "usage" })
              }
              desc={cfg.sysSortDesc}
              onDescToggle={() => updateConfig({ sysSortDesc: !cfg.sysSortDesc })}
            />
          ) : (
            <HeaderSort
              fields={[
                { id: "manual", label: "手动" },
                { id: "name", label: "名称" },
                { id: "created_at", label: "添加时间" },
                { id: "usage", label: "频率" },
              ]}
              value={cfg.sortBy}
              onChange={(id) =>
                updateConfig({ sortBy: id as QuicklaunchConfig["sortBy"] })
              }
              desc={cfg.sortDesc}
              onDescToggle={() => updateConfig({ sortDesc: !cfg.sortDesc })}
            />
          )
        }
      />

      <Drawer open={showSettings} onClose={() => setShowSettings(false)} title="快速启动设置">
        <QuicklaunchSettings
          cfg={cfg}
          onUpdate={updateConfig}
        />
      </Drawer>

      <div
        ref={containerRef}
        className={cn(
          "flex-1 overflow-auto p-2 relative select-none",
          isSelecting && "cursor-crosshair",
        )}
        onContextMenu={handlePanelContextMenu}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            加载中...
          </div>
        ) : filter === "sysapps" ? (
          <SysAppGrid
            apps={sysApps}
            search={search}
            gridSize={cfg.gridSize}
            sortBy={cfg.sysSortBy}
            sortDesc={cfg.sysSortDesc}
            icons={fileIcons}
            loadIcon={loadFileIcon}
            onOpen={openSysApp}
            onTogglePin={togglePinSysApp}
          />
        ) : items.length === 0 && !search ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="text-sm text-muted-foreground">拖拽文件到此处固定</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleAddItem}>
                <Plus className="mr-1 h-4 w-4" />
                添加项目
              </Button>
              <Button variant="outline" size="sm" onClick={handleAddFolder}>
                <FolderPlus className="mr-1 h-4 w-4" />
                新建分组
              </Button>
            </div>
          </div>
        ) : items.length === 0 && search ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            没有找到匹配的项目
          </div>
        ) : cfg.viewMode === "grid" ? (
          cfg.sortBy === "manual" ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map((item) => String(item.id))} strategy={rectSortingStrategy}>
                <div
                  ref={gridRef}
                  className="grid gap-2"
                  style={{
                    gridAutoRows: `${cfg.gridSize}px`,
                    gridTemplateColumns: `repeat(auto-fill, ${cfg.gridSize}px)`,
                  }}
                >
                  {/* 显示分组 */}
                  {foldersWithItems.map((folder, folderIdx) => (
                    <div key={`folder-${folder.id}`} data-item-id={folder.id}>
                      <GroupCard
                        id={folder.id}
                        name={folder.name}
                        items={folder.items}
                        gridSize={cfg.gridSize}
                        fileIcons={fileIcons}
                        selected={selectedIds.has(folder.id) || kbIdx === folderIdx}
                        onSelect={(id) => {
                          setExpandedFolder(id);
                        }}
                        onOpen={(id) => {
                          setExpandedFolder(id);
                        }}
                        onContextMenu={(e, id) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setContextMenu({
                            visible: true,
                            x: e.clientX,
                            y: e.clientY,
                            type: "folder",
                            folderId: id,
                            folderPosition: { x: e.clientX, y: e.clientY },
                          });
                        }}
                      />
                    </div>
                  ))}
                  
                  {/* 显示项目 */}
                  {items.map((item, itemIdx) => (
                    <SortableItem key={item.id} id={String(item.id)}>
                      <div data-item-id={item.id}>
                        <ItemCard
                          item={item}
                          viewMode="grid"
                          gridSize={cfg.gridSize}
                          icon={item.item_type === "url" ? null : fileIcons[item.path]}
                          showExtension={cfg.showExtension}
                          singleClickOpen={cfg.singleClickOpen}
                          selected={selectedIds.has(item.id) || kbIdx === kbGroupCount + itemIdx}
                          onSelect={(id, e) => handleItemSelect(id, e)}
                          onOpen={handleOpen}
                          onDelete={handleDelete}
                          onRename={handleRename}
                          onContextMenu={handleItemContextMenu}
                        />
                      </div>
                    </SortableItem>
                  ))}
                  <button
                    className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/30 cursor-pointer transition-colors hover:bg-accent/50"
                    style={{
                      height: `${cfg.gridSize}px`,
                      padding: `${cfg.gridSize * 0.1}px`,
                    }}
                    onClick={handleAddItem}
                  >
                    <Plus className="text-muted-foreground" style={{ width: gridIconSize(cfg.gridSize), height: gridIconSize(cfg.gridSize) }} />
                    <span className="text-muted-foreground" style={{ fontSize: `${gridFontScale(cfg.gridSize)}px` }}>添加</span>
                  </button>
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div
              ref={gridRef}
              className="grid gap-2"
              style={{
                gridAutoRows: `${cfg.gridSize}px`,
                gridTemplateColumns: `repeat(auto-fill, ${cfg.gridSize}px)`,
              }}
            >
              {foldersWithItems.map((folder, folderIdx) => (
                <div key={`folder-${folder.id}`} data-item-id={folder.id}>
                  <GroupCard
                    id={folder.id}
                    name={folder.name}
                    items={folder.items}
                    gridSize={cfg.gridSize}
                    fileIcons={fileIcons}
                    selected={selectedIds.has(folder.id) || kbIdx === folderIdx}
                    onSelect={(id) => { setExpandedFolder(id); }}
                    onOpen={(id) => { setExpandedFolder(id); }}
                    onContextMenu={(e, id) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        visible: true, x: e.clientX, y: e.clientY,
                        type: "folder", folderId: id, folderPosition: { x: e.clientX, y: e.clientY },
                      });
                    }}
                  />
                </div>
              ))}
              {items.map((item, itemIdx) => (
                <div key={item.id} data-item-id={item.id}>
                  <ItemCard
                    item={item}
                    viewMode="grid"
                    gridSize={cfg.gridSize}
                    icon={item.item_type === "url" ? null : fileIcons[item.path]}
                    showExtension={cfg.showExtension}
                    singleClickOpen={cfg.singleClickOpen}
                    selected={selectedIds.has(item.id) || kbIdx === kbGroupCount + itemIdx}
                    onSelect={(id, e) => handleItemSelect(id, e)}
                    onOpen={handleOpen}
                    onDelete={handleDelete}
                    onRename={handleRename}
                    onContextMenu={handleItemContextMenu}
                  />
                </div>
              ))}
              <button
                className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/30 cursor-pointer transition-colors hover:bg-accent/50"
                style={{ height: `${cfg.gridSize}px`, padding: `${cfg.gridSize * 0.1}px` }}
                onClick={handleAddItem}
              >
                <Plus className="text-muted-foreground" style={{ width: gridIconSize(cfg.gridSize), height: gridIconSize(cfg.gridSize) }} />
                <span className="text-muted-foreground" style={{ fontSize: `${gridFontScale(cfg.gridSize)}px` }}>添加</span>
              </button>
            </div>
          )
        ) : (
          cfg.sortBy === "manual" ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map((item) => String(item.id))} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col">
                  {items.map((item, itemIdx) => (
                    <SortableItem key={item.id} id={String(item.id)}>
                      <div data-item-id={item.id}>
                        <ItemCard
                          item={item}
                          viewMode="list"
                          icon={item.item_type === "url" ? null : fileIcons[item.path]}
                          showExtension={cfg.showExtension}
                          singleClickOpen={cfg.singleClickOpen}
                          selected={selectedIds.has(item.id) || kbIdx === kbGroupCount + itemIdx}
                          onSelect={(id, e) => handleItemSelect(id, e)}
                          onOpen={handleOpen}
                          onDelete={handleDelete}
                          onRename={handleRename}
                          onContextMenu={handleItemContextMenu}
                        />
                      </div>
                    </SortableItem>
                  ))}
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors hover:bg-accent/50 text-muted-foreground"
                    onClick={handleAddItem}
                  >
                    <Plus className="h-4 w-4" />
                    <span className="text-sm">添加项目</span>
                  </button>
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="flex flex-col">
              {items.map((item, itemIdx) => (
                <div key={item.id} data-item-id={item.id}>
                  <ItemCard
                    item={item}
                    viewMode="list"
                    icon={item.item_type === "url" ? null : fileIcons[item.path]}
                    showExtension={cfg.showExtension}
                    singleClickOpen={cfg.singleClickOpen}
                    selected={selectedIds.has(item.id) || kbIdx === kbGroupCount + itemIdx}
                    onSelect={(id, e) => handleItemSelect(id, e)}
                    onOpen={handleOpen}
                    onDelete={handleDelete}
                    onRename={handleRename}
                    onContextMenu={handleItemContextMenu}
                  />
                </div>
              ))}
              <button
                className="flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors hover:bg-accent/50 text-muted-foreground"
                onClick={handleAddItem}
              >
                <Plus className="h-4 w-4" />
                <span className="text-sm">添加项目</span>
              </button>
            </div>
          )
        )}

        {/* 顶栏搜索扩展：固定项结果下方追加「系统中的应用」，点击直接启动 */}
        {search && filter !== "sysapps" && sysApps !== null && (
          <div className="mt-3 border-t pt-2">
            <div className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
              系统中的应用
            </div>
            <SysAppGrid
              apps={sysApps}
              search={search}
              gridSize={cfg.gridSize}
              sortBy={cfg.sysSortBy}
              sortDesc={cfg.sysSortDesc}
              icons={fileIcons}
              loadIcon={loadFileIcon}
              onOpen={openSysApp}
              onTogglePin={togglePinSysApp}
            />
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
      >
        {contextMenu.type === "panel" ? (
          <>
            <ContextMenuItem
              icon={<Plus className="h-4 w-4" />}
              label="添加项目"
              onClick={() => handleContextAction("add-item")}
            />
            <ContextMenuItem
              icon={<FolderPlus className="h-4 w-4" />}
              label="新建分组"
              onClick={() => handleContextAction("add-folder")}
            />
            <ContextMenuItem
              icon={<ClipboardPaste className="h-4 w-4" />}
              label="粘贴路径"
              onClick={() => handleContextAction("paste-path")}
            />
          </>
        ) : contextMenu.type === "folder" ? (
          <>
            <ContextMenuItem
              label="打开"
              onClick={() => {
                if (contextMenu.folderId) {
                  setExpandedFolder(contextMenu.folderId);
                }
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
            />
            <ContextMenuItem
              label="重命名"
              onClick={async () => {
                if (contextMenu.folderId) {
                  const folder = folders.find((f) => f.id === contextMenu.folderId);
                  if (folder) {
                    const newName = await prompt("重命名分组", { defaultValue: folder.name });
                    if (newName && newName !== folder.name) {
                      try {
                        await invoke("quicklaunch_update_folder", { id: contextMenu.folderId, name: newName });
                        fetchFolders();
                      } catch (e) {
                        toast(`重命名分组失败：${e}`);
                        console.error("Failed to rename folder:", e);
                      }
                    }
                  }
                }
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
            />
            <ContextMenuDivider />
            <ContextMenuItem
              label="删除"
              onClick={async () => {
                if (contextMenu.folderId) {
                  try {
                    await invoke("quicklaunch_delete_folder", { id: contextMenu.folderId });
                    fetchFolders();
                    fetchItems();
                  } catch (e) {
                    toast(`删除分组失败：${e}`);
                    console.error("Failed to delete folder:", e);
                  }
                }
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
              className="text-destructive"
            />
          </>
        ) : (
          <>
            <ContextMenuItem
              label="打开"
              onClick={() => handleContextAction("open")}
            />
            {contextMenu.item?.item_type === "app" && (
              <ContextMenuItem
                label="以管理员身份运行"
                onClick={async () => {
                  if (contextMenu.item) {
                    try {
                      await invoke("quicklaunch_open_item_as_admin", { item: contextMenu.item });
                    } catch (e) {
                      toast(`以管理员身份运行失败：${e}`);
                      console.error("Failed to open as admin:", e);
                    }
                  }
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
              />
            )}
            <ContextMenuItem
              label="打开文件所在位置"
              onClick={() => handleContextAction("open-location")}
            />
            <ContextMenuDivider />
            <ContextMenuItem
              label="复制路径"
              onClick={() => handleContextAction("copy-path")}
            />
            <ContextMenuItem
              label="重命名"
              onClick={() => handleContextAction("rename")}
            />
            <ContextMenuDivider />
            {folders.length > 0 && getTargetItems().length > 0 && (
              <ContextMenuItem
                label="移动到文件夹"
                submenu
              >
                {folders.map((folder) => (
                  <ContextMenuItem
                    key={folder.id}
                    label={folder.name}
                    onClick={() => {
                      const targetItems = getTargetItems();
                      handleMoveToFolder(
                        targetItems.map((item) => item.id),
                        folder.id
                      );
                    }}
                  />
                ))}
              </ContextMenuItem>
            )}
            <ContextMenuDivider />
            <ContextMenuItem
              label="删除"
              onClick={() => handleContextAction("delete")}
              className="text-destructive"
            />
          </>
        )}
      </ContextMenu>

      {/* 框选框 */}
      {isSelecting && selectionStart && selectionEnd && (
        <div
          className="fixed border border-primary/50 bg-primary/10 pointer-events-none z-40"
          style={{
            left: Math.min(selectionStart.x, selectionEnd.x),
            top: Math.min(selectionStart.y, selectionEnd.y),
            width: Math.abs(selectionEnd.x - selectionStart.x),
            height: Math.abs(selectionEnd.y - selectionStart.y),
          }}
        />
      )}
    </div>
  );
}