import { cn } from "@/lib/utils";
import { File, Folder, Globe, AppWindow } from "lucide-react";
import { useState } from "react";

export interface QuicklaunchItem {
  id: number;
  item_type: "app" | "file" | "folder" | "url";
  name: string;
  path: string;
  icon_path: string | null;
  folder_id: number | null;
  sort_order: number;
  created_at: string;
}

interface ItemCardProps {
  item: QuicklaunchItem;
  viewMode: "grid" | "list";
  selected: boolean;
  onSelect: (id: number) => void;
  onOpen: (item: QuicklaunchItem) => void;
  onDelete?: (id: number) => void;
  onRename: (id: number, name: string) => void;
  onContextMenu?: (e: React.MouseEvent, item: QuicklaunchItem) => void;
}

const typeIcons = {
  app: AppWindow,
  file: File,
  folder: Folder,
  url: Globe,
};

export function ItemCard({
  item,
  viewMode,
  selected,
  onSelect,
  onOpen,
  onDelete: _onDelete,
  onRename,
  onContextMenu,
}: ItemCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);

  const Icon = typeIcons[item.item_type];

  const handleClick = () => {
    onSelect(item.id);
  };

  const handleDoubleClick = () => {
    onOpen(item);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu?.(e, item);
  };

  const handleRename = () => {
    if (editName.trim() && editName !== item.name) {
      onRename(item.id, editName.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRename();
    } else if (e.key === "Escape") {
      setEditName(item.name);
      setIsEditing(false);
    }
  };

  if (viewMode === "grid") {
    return (
      <div
        className={cn(
          "group relative flex flex-col items-center justify-center gap-2 rounded-md border p-2 cursor-pointer transition-colors overflow-hidden",
          selected
            ? "border-primary bg-accent"
            : "border-transparent hover:bg-accent/50"
        )}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <div className="flex items-center justify-center">
          {item.icon_path ? (
            <img
              src={`data:image/png;base64,${item.icon_path}`}
              className="h-10 w-10 object-contain"
              alt=""
            />
          ) : (
            <Icon className="h-10 w-10 text-muted-foreground" />
          )}
        </div>
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={handleKeyDown}
            className="w-full text-center text-xs bg-transparent border border-primary outline-none"
            autoFocus
          />
        ) : (
          <span
            className="w-full truncate text-center text-xs"
            title={item.name}
          >
            {item.name}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors",
        selected ? "bg-accent" : "hover:bg-accent/50"
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center">
        {item.icon_path ? (
          <img
            src={`data:image/png;base64,${item.icon_path}`}
            className="h-full w-full object-contain"
            alt=""
          />
        ) : (
          <Icon className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={handleKeyDown}
            className="w-full text-sm bg-transparent border border-primary outline-none"
            autoFocus
          />
        ) : (
          <div className="truncate text-sm">{item.name}</div>
        )}
        <div className="truncate text-[10px] text-muted-foreground">
          {item.path}
        </div>
      </div>
    </div>
  );
}