import { invoke } from "@tauri-apps/api/core";
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
import { cn } from "@/lib/utils";

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

export function QuicklaunchPage() {
  const [items, setItems] = useState<QuicklaunchItem[]>([]);
  const [foldersWithItems, setFoldersWithItems] = useState<FolderWithItems[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    type: "panel",
  });
  const [folders, setFolders] = useState<{ id: number; name: string }[]>([]);
  const [gridSize, setGridSize] = useState(64);
  const [sortBy, setSortBy] = useState<"manual" | "name" | "created_at">("manual");
  const [fileIcons, setFileIcons] = useState<Record<string, string>>({});
  const [expandedFolder, setExpandedFolder] = useState<number | null>(null);
  const { prompt, PromptDialog } = usePrompt();
  const containerRef = useRef<HTMLDivElement>(null);

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
    setLoading(true);
    try {
      // 如果是手动排序且有缓存，使用缓存的顺序
      if (sortBy === "manual" && manualOrderRef.current.length > 0) {
        const filterOptions = {
          item_type: filter === "all" ? null : filter,
          search: search || null,
          sort_by: "sort_order",
          sort_desc: false,
        };
        const result = await invoke<QuicklaunchItem[]>("quicklaunch_list_items", {
          filter: filterOptions,
        });
        // 按缓存顺序排序
        const ordered = [...result].sort((a, b) => {
          const aIdx = manualOrderRef.current.indexOf(a.id);
          const bIdx = manualOrderRef.current.indexOf(b.id);
          // 如果都不在缓存中，按 sort_order 排序
          if (aIdx === -1 && bIdx === -1) return a.sort_order - b.sort_order;
          // 如果只有一个在缓存中，缓存的排前面
          if (aIdx === -1) return 1;
          if (bIdx === -1) return -1;
          return aIdx - bIdx;
        });
        setItems(ordered);
        // 加载图标
        for (const item of ordered) {
          if (item.item_type !== "url") {
            loadFileIcon(item.path);
          }
        }
      } else {
        const filterOptions = {
          item_type: filter === "all" ? null : filter,
          search: search || null,
          sort_by: sortBy === "manual" ? "sort_order" : sortBy,
          sort_desc: false,
        };
        const result = await invoke<QuicklaunchItem[]>("quicklaunch_list_items", {
          filter: filterOptions,
        });
        setItems(result);
        // 加载图标
        for (const item of result) {
          if (item.item_type !== "url") {
            loadFileIcon(item.path);
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch items:", e);
    } finally {
      setLoading(false);
    }
  }, [filter, search, sortBy]);

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

  const loadConfig = useCallback(async () => {
    try {
      const config = await invoke<{ modules?: Record<string, Record<string, unknown>> }>("get_config");
      const moduleConfig = config?.modules?.quicklaunch;
      if (moduleConfig) {
        if (moduleConfig.grid_size) setGridSize(moduleConfig.grid_size as number);
        if (moduleConfig.view_mode) setViewMode(moduleConfig.view_mode as "grid" | "list");
        if (moduleConfig.sort_by) setSortBy(moduleConfig.sort_by as "manual" | "name" | "created_at");
      }
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    fetchFolders();
    loadConfig();
  }, [fetchItems, fetchFolders, loadConfig]);



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

  const handleMoveToFolder = async (itemId: number, folderId: number) => {
    try {
      await invoke("quicklaunch_update_item", { id: itemId, folderId });
      fetchItems();
      fetchFolders();
    } catch (e) {
      console.error("Failed to move item to folder:", e);
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
            setTimeout(() => fetchItems(), 500);
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

  const handleContextAction = async (action: string) => {
    const { item } = contextMenu;
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
        if (item) handleOpen(item);
        break;
      case "open-location":
        if (item) {
          await invoke("search_open_file_location", { path: item.path });
        }
        break;
      case "copy-path":
        if (item) {
          await invoke("search_copy_path", { path: item.path });
        }
        break;
      case "rename":
        if (item) {
          const newName = await prompt("重命名", { defaultValue: item.name });
          if (newName && newName !== item.name) {
            handleRename(item.id, newName);
          }
        }
        break;
      case "move-to-folder":
        // 移动功能通过子菜单处理，这里不需要额外操作
        break;
      case "delete":
        if (item) handleDelete(item.id);
        break;
    }
  };

  // 获取当前展开的分组信息
  const expandedFolderData = expandedFolder
    ? foldersWithItems.find((f) => f.id === expandedFolder)
    : null;

  return (
    <div 
      className="relative flex h-full flex-col"
      onContextMenu={(e) => e.preventDefault()}
    >
      {PromptDialog}
      
      {/* 分组展开覆盖层 */}
      {expandedFolderData && (
        <FolderOverlay
          folderName={expandedFolderData.name}
          items={expandedFolderData.items}
          gridSize={gridSize}
          fileIcons={fileIcons}
          selectedId={selectedId}
          anchorPosition={contextMenu.folderPosition}
          onSelect={setSelectedId}
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
          viewMode={viewMode}
          onViewModeChange={setViewMode}
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

      <Drawer open={showSettings} onClose={() => { setShowSettings(false); loadConfig(); }} title="快速启动设置">
        <QuicklaunchSettings
          onRefresh={fetchItems}
          onSettingsChange={(s) => {
            setGridSize(s.grid_size);
            setViewMode(s.view_mode);
            setSortBy(s.sort_by);
          }}
        />
      </Drawer>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-2"
        onContextMenu={handlePanelContextMenu}
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
        ) : viewMode === "grid" ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((item) => String(item.id))} strategy={rectSortingStrategy}>
              <div
                className="grid gap-2"
                style={{
                  gridAutoRows: `${gridSize}px`,
                  gridTemplateColumns: `repeat(auto-fill, ${gridSize}px)`,
                }}
              >
                {/* 显示分组 */}
                {foldersWithItems.map((folder) => (
                  <div key={`folder-${folder.id}`}>
                    <GroupCard
                      id={folder.id}
                      name={folder.name}
                      items={folder.items}
                      gridSize={gridSize}
                      fileIcons={fileIcons}
                      selected={selectedId === folder.id}
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
                {items.map((item) => (
                  <SortableItem key={item.id} id={String(item.id)}>
                    <ItemCard
                      item={item}
                      viewMode="grid"
                      gridSize={gridSize}
                      icon={item.item_type === "url" ? null : fileIcons[item.path]}
                      selected={selectedId === item.id}
                      onSelect={setSelectedId}
                      onOpen={handleOpen}
                      onDelete={handleDelete}
                      onRename={handleRename}
                      onContextMenu={handleItemContextMenu}
                    />
                  </SortableItem>
                ))}
                <button
                  className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/30 cursor-pointer transition-colors hover:bg-accent/50"
                  style={{
                    height: `${gridSize}px`,
                    padding: `${gridSize * 0.1}px`,
                  }}
                  onClick={handleAddItem}
                >
                  <Plus className="text-muted-foreground" style={{ width: gridSize * 0.5, height: gridSize * 0.5 }} />
                  <span className="text-muted-foreground" style={{ fontSize: `${Math.max(gridSize * 0.15, 10)}px` }}>添加</span>
                </button>
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((item) => String(item.id))} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col">
                {items.map((item) => (
                  <SortableItem key={item.id} id={String(item.id)}>
                    <ItemCard
                      item={item}
                      viewMode="list"
                      icon={item.item_type === "url" ? null : fileIcons[item.path]}
                      selected={selectedId === item.id}
                      onSelect={setSelectedId}
                      onOpen={handleOpen}
                      onDelete={handleDelete}
                      onRename={handleRename}
                      onContextMenu={handleItemContextMenu}
                    />
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
                onClick={() => {/* TODO */}}
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
            {folders.length > 0 && contextMenu.item && (
              <ContextMenuItem
                label="移动到文件夹"
                submenu
              >
                {folders.map((folder) => (
                  <ContextMenuItem
                    key={folder.id}
                    label={folder.name}
                    onClick={() => handleMoveToFolder(contextMenu.item!.id, folder.id)}
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
    </div>
  );
}