import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, useCallback, useRef } from "react";
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
import { FilterBar, FilterType } from "./FilterBar";
import { QuicklaunchSettings } from "./Settings";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ContextMenu } from "@/components/ui/context-menu";
import { ContextMenuItem } from "@/components/ui/context-menu-item";
import { ContextMenuDivider } from "@/components/ui/context-menu-divider";
import { Plus, FolderPlus, Settings2, ClipboardPaste } from "lucide-react";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useModuleConfig } from "@/hooks/useModuleConfig";
import { useWindowEntrance } from "@/lib/use-window-entrance";
import { cn } from "@/lib/utils";

// ==================== 配置类型（对齐文件搜索模块） ====================

interface QuicklaunchConfig {
  viewMode: "grid" | "list";
  sortBy: "manual" | "name" | "created_at";
  sortDesc: boolean;
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
  const [fileIcons, setFileIcons] = useState<Record<string, string>>({});
  const [expandedFolder, setExpandedFolder] = useState<number | null>(null);
  const { prompt, PromptDialog } = usePrompt();
  const containerRef = useRef<HTMLDivElement>(null);
  const entranceRef = useWindowEntrance(popup, ["animate-in", "fade-in-0"]);

  // 统一配置（共享 Hook：读写/键名映射/focus 重读全部内置）
  const { cfg, update: updateConfig } = useModuleConfig("quicklaunch", QL_DEFAULTS);

  // 框选状态
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);

  // 切换视图（FilterBar 顶栏按钮用）
  const toggleView = useCallback(() => {
    updateConfig({ viewMode: cfg.viewMode === "grid" ? "list" : "grid" });
  }, [updateConfig, cfg.viewMode]);

  // 按需加载文件图标（与剪贴板模块一致）
  const loadFileIcon = useCallback(async (path: string) => {
    setFileIcons((prev) => {
      if (prev[path]) return prev;
      // 异步加载图标，更新状态
      invoke<string | null>("quicklaunch_get_file_icon", { path })
        .then((icon) => {
          if (icon) {
            setFileIcons((prev2) => ({ ...prev2, [path]: icon }));
          }
        })
        .catch((e) => console.error("Failed to load file icon:", e));
      return prev;
    });
  }, []);

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
        // 非手动排序：前端用 localeCompare 做中文拼音排序
        const sorted = [...result].sort((a, b) => {
          if (cfg.sortBy === "name") {
            return a.name.localeCompare(b.name, "zh-CN-u-co-pinyin");
          }
          // created_at: 字符串时间比较（ISO 格式，直接比较即可）
          return a.created_at.localeCompare(b.created_at);
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



  const handleOpen = async (item: QuicklaunchItem) => {
    try {
      await invoke("quicklaunch_open_item", { item });
    } catch (e) {
      console.error("Failed to open item:", e);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await invoke("quicklaunch_delete_item", { id });
      fetchItems();
    } catch (e) {
      console.error("Failed to delete item:", e);
    }
  };

  const handleRename = async (id: number, name: string) => {
    try {
      await invoke("quicklaunch_update_item", { id, name });
      fetchItems();
    } catch (e) {
      console.error("Failed to rename item:", e);
    }
  };

  // 键盘导航：↑↓ 移动高亮、Enter 打开、Delete 删除、Esc 关弹层/隐藏窗口
  const [kbIdx, setKbIdx] = useState<number | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (expandedFolder != null) setExpandedFolder(null);
      else if (popup) getCurrentWindow().hide();
      return;
    }
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setKbIdx((i) => (i == null ? 0 : Math.min(i + 1, items.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setKbIdx((i) => (i == null ? items.length - 1 : Math.max(i - 1, 0)));
    } else if (e.key === "Enter" && kbIdx != null && kbIdx < items.length) {
      e.preventDefault();
      handleOpen(items[kbIdx]);
    } else if (e.key === "Delete" && kbIdx != null && kbIdx < items.length) {
      e.preventDefault();
      handleDelete(items[kbIdx].id);
      setKbIdx(null);
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
      filters: [
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (picked) {
      const paths = Array.isArray(picked) ? picked : [picked];
      for (const path of paths) {
        try {
          await invoke("quicklaunch_add_from_path", { path });
        } catch (e) {
          console.error("Failed to create item:", e);
        }
      }
      fetchItems();
    }
  };

  const handleAddFolder = async () => {
    const name = await prompt("新建分组", { placeholder: "请输入分组名称" });
    if (name && name.trim()) {
      try {
        await invoke("quicklaunch_create_folder", { name: name.trim() });
        fetchFolders();
      } catch (e) {
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
      console.error("Failed to move items to folder:", e);
    }
  };

  const handleRenameFolder = async (name: string) => {
    if (!expandedFolder) return;
    try {
      await invoke("quicklaunch_update_folder", { id: expandedFolder, name });
      fetchFolders();
    } catch (e) {
      console.error("Failed to rename folder:", e);
    }
  };

  const handlePastePath = async () => {
    try {
      const text = await invoke<string>("get_clipboard_text");
      if (text && (text.startsWith("C:\\") || text.startsWith("D:\\") || text.startsWith("http"))) {
        await invoke("quicklaunch_add_from_path", { path: text });
        fetchItems();
      }
    } catch (e) {
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
      <div className="flex items-center border-b px-2 py-1.5">
        <FilterBar
          filter={filter}
          onFilterChange={setFilter}
          viewMode={cfg.viewMode}
          onViewModeChange={toggleView}
          search={search}
          onSearchChange={setSearch}
        />
        <Button
          variant="ghost"
          size="icon"
          className="ml-2 h-7 w-7"
          onClick={() => setShowSettings(true)}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

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
          isSelecting && "cursor-crosshair"
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
                  className="grid gap-2"
                  style={{
                    gridAutoRows: `${cfg.gridSize}px`,
                    gridTemplateColumns: `repeat(auto-fill, ${cfg.gridSize}px)`,
                  }}
                >
                  {/* 显示分组 */}
                  {foldersWithItems.map((folder) => (
                    <div key={`folder-${folder.id}`} data-item-id={folder.id}>
                      <GroupCard
                        id={folder.id}
                        name={folder.name}
                        items={folder.items}
                        gridSize={cfg.gridSize}
                        fileIcons={fileIcons}
                        selected={selectedIds.has(folder.id)}
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
                          selected={selectedIds.has(item.id) || kbIdx === itemIdx}
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
                    <Plus className="text-muted-foreground" style={{ width: cfg.gridSize * 0.5, height: cfg.gridSize * 0.5 }} />
                    <span className="text-muted-foreground" style={{ fontSize: `${Math.max(cfg.gridSize * 0.15, 10)}px` }}>添加</span>
                  </button>
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div
              className="grid gap-2"
              style={{
                gridAutoRows: `${cfg.gridSize}px`,
                gridTemplateColumns: `repeat(auto-fill, ${cfg.gridSize}px)`,
              }}
            >
              {foldersWithItems.map((folder) => (
                <div key={`folder-${folder.id}`} data-item-id={folder.id}>
                  <GroupCard
                    id={folder.id}
                    name={folder.name}
                    items={folder.items}
                    gridSize={cfg.gridSize}
                    fileIcons={fileIcons}
                    selected={selectedIds.has(folder.id)}
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
                    selected={selectedIds.has(item.id) || kbIdx === itemIdx}
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
                <Plus className="text-muted-foreground" style={{ width: cfg.gridSize * 0.5, height: cfg.gridSize * 0.5 }} />
                <span className="text-muted-foreground" style={{ fontSize: `${Math.max(cfg.gridSize * 0.15, 10)}px` }}>添加</span>
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
                          selected={selectedIds.has(item.id) || kbIdx === itemIdx}
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
                    selected={selectedIds.has(item.id) || kbIdx === itemIdx}
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