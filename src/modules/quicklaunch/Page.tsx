import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, useCallback } from "react";
import { ItemCard, QuicklaunchItem } from "./ItemCard";
import { FilterBar, FilterType } from "./FilterBar";
import { Button } from "@/components/ui/button";
import { Plus, FolderPlus } from "lucide-react";
import { usePrompt } from "@/components/ui/prompt-dialog";

export function QuicklaunchPage() {
  const [items, setItems] = useState<QuicklaunchItem[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { prompt, PromptDialog } = usePrompt();

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const filterOptions = {
        item_type: filter === "all" ? null : filter,
        search: search || null,
        sort_by: "sort_order",
        sort_desc: false,
      };
      const result = await invoke<QuicklaunchItem[]>("quicklaunch_list_items", {
        filter: filterOptions,
      });
      setItems(result);
    } catch (e) {
      console.error("Failed to fetch items:", e);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

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
        // 判断文件类型
        const isUrl = path.startsWith("http://") || path.startsWith("https://");
        const isFolder = !path.includes(".") && !isUrl;
        const itemType = isUrl ? "url" : isFolder ? "folder" : path.endsWith(".exe") ? "app" : "file";
        const name = path.split(/[\\/]/).pop() || path;
        
        try {
          await invoke("quicklaunch_create_item", {
            itemType,
            name,
            path,
            folderId: null,
          });
        } catch (e) {
          console.error("Failed to create item:", e);
        }
      }
      fetchItems();
    }
  };

  const handleAddFolder = async () => {
    const name = await prompt("新建文件夹", { placeholder: "请输入文件夹名称" });
    if (name) {
      try {
        await invoke("quicklaunch_create_folder", { name });
        fetchItems();
      } catch (e) {
        console.error("Failed to create folder:", e);
      }
    }
  };

  return (
    <div className="flex h-full flex-col">
      {PromptDialog}
      <FilterBar
        filter={filter}
        onFilterChange={setFilter}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        search={search}
        onSearchChange={setSearch}
      />
      <div className="flex-1 overflow-auto p-2">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            加载中...
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="text-sm text-muted-foreground">
              {search ? "没有找到匹配的项目" : "还没有固定任何项目"}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleAddItem}>
                <Plus className="mr-1 h-4 w-4" />
                添加项目
              </Button>
              <Button variant="outline" size="sm" onClick={handleAddFolder}>
                <FolderPlus className="mr-1 h-4 w-4" />
                新建文件夹
              </Button>
            </div>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-6 gap-2">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                viewMode="grid"
                selected={selectedId === item.id}
                onSelect={setSelectedId}
                onOpen={handleOpen}
                onDelete={handleDelete}
                onRename={handleRename}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                viewMode="list"
                selected={selectedId === item.id}
                onSelect={setSelectedId}
                onOpen={handleOpen}
                onDelete={handleDelete}
                onRename={handleRename}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}