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
import { FilterBar, FilterType } from "./FilterBar";
import { QuicklaunchSettings } from "./Settings";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Plus, FolderPlus, Settings2, ClipboardPaste } from "lucide-react";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { cn } from "@/lib/utils";

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  type: "panel" | "item";
  item?: QuicklaunchItem;
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

export function QuicklaunchPage() {
  const [items, setItems] = useState<QuicklaunchItem[]>([]);
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
  const { prompt, PromptDialog } = usePrompt();
  const containerRef = useRef<HTMLDivElement>(null);

  // 按需加载文件图标（与剪贴板模块一致）
  const loadFileIcon = useCallback(async (path: string) => {
    if (fileIcons[path]) return;
    try {
      const icon = await invoke<string | null>("quicklaunch_get_file_icon", { path });
      if (icon) {
        setFileIcons((prev) => ({ ...prev, [path]: icon }));
      }
    } catch (e) {
      console.error("Failed to load file icon:", e);
    }
  }, [fileIcons]);

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
    } catch (e) {
      console.error("Failed to fetch folders:", e);
    }
  }, []);

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

  // 关闭右键菜单
  useEffect(() => {
    const handleClick = () => setContextMenu((prev) => ({ ...prev, visible: false }));
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu((prev) => ({ ...prev, visible: false }));
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

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

  // 文件拖拽处理（用于从桌面拖入文件）
  const handleFileDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    // 尝试从 dataTransfer 获取文件路径（Tauri 支持）
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      try {
        // Tauri 的 File 对象有 path 属性
        const path = (file as File & { path?: string }).path || file.name;
        await invoke("quicklaunch_add_from_path", { path });
      } catch (err) {
        console.error("Failed to add dropped file:", err);
      }
    }
    fetchItems();
  };

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
        // TODO: 显示文件夹子菜单
        break;
      case "delete":
        if (item) handleDelete(item.id);
        break;
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      {PromptDialog}
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
        onDragOver={handleFileDragOver}
        onDrop={handleDrop}
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
      {contextMenu.visible && (
        <div
          className="fixed z-50 min-w-[180px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
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
              <div className="my-1 h-px bg-border" />
              <ContextMenuItem
                label="复制路径"
                onClick={() => handleContextAction("copy-path")}
              />
              <ContextMenuItem
                label="重命名"
                onClick={() => handleContextAction("rename")}
              />
              <div className="my-1 h-px bg-border" />
              {folders.length > 0 && (
                <div className="relative group">
                  <ContextMenuItem
                    label="移动到文件夹"
                    submenu
                  />
                  <div className="absolute left-full top-0 hidden min-w-[120px] rounded-md border bg-popover p-1 shadow-md group-hover:block">
                    {folders.map((folder) => (
                      <ContextMenuItem
                        key={folder.id}
                        label={folder.name}
                        onClick={() => {/* TODO: 移动到文件夹 */}}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div className="my-1 h-px bg-border" />
              <ContextMenuItem
                label="删除"
                onClick={() => handleContextAction("delete")}
                className="text-destructive"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ContextMenuItem({
  icon,
  label,
  onClick,
  className,
  submenu,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
  submenu?: boolean;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
        className
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {submenu && <span className="text-muted-foreground">▶</span>}
    </button>
  );
}