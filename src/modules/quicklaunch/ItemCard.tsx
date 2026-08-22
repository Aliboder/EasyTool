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
  gridSize?: number;
  icon?: string | null;
  showExtension?: boolean;
  onSelect: (id: number, e?: React.MouseEvent) => void;
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

// 获取显示名称（根据 showExtension 设置决定是否显示后缀名）
function getDisplayName(name: string, showExtension: boolean): string {
  if (showExtension) return name;
  const lastDotIndex = name.lastIndexOf('.');
  if (lastDotIndex > 0) {
    return name.substring(0, lastDotIndex);
  }
  return name;
}

export function ItemCard({
  item,
  viewMode,
  selected,
  gridSize = 64,
  icon,
  showExtension = true,
  onSelect,
  onOpen,
  onDelete: _onDelete,
  onRename,
  onContextMenu,
}: ItemCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);

  const Icon = typeIcons[item.item_type];

  const handleClick = (e: React.MouseEvent) => {
    onSelect(item.id, e);
  };

  const handleDoubleClick = () => {
    onOpen(item);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
    const iconSize = Math.max(gridSize * 0.5, 24);
    return (
      <div
        className={cn(
          "group relative flex flex-col items-center justify-center gap-1 rounded-md border cursor-pointer transition-colors min-h-0",
          selected
            ? "border-primary bg-accent"
            : "border-transparent hover:bg-accent/50"
        )}
        style={{ padding: `${gridSize * 0.1}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <div className="flex shrink-0 items-center justify-center">
          {icon ? (
            <img
              src={`data:image/png;base64,${icon}`}
              className="object-contain"
              style={{ width: iconSize, height: iconSize }}
              alt=""
            />
          ) : (
            <Icon className="text-muted-foreground" style={{ width: iconSize, height: iconSize }} />
          )}
        </div>
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={handleKeyDown}
            className="w-full min-w-0 text-center bg-transparent border border-primary outline-none truncate"
            style={{ fontSize: `${Math.max(gridSize * 0.15, 10)}px` }}
            autoFocus
          />
        ) : (
          <span
            className="w-full min-w-0 truncate text-center leading-tight"
            style={{ fontSize: `${Math.max(gridSize * 0.15, 10)}px` }}
            title={item.name}
          >
            {getDisplayName(item.name, showExtension)}
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
        {icon ? (
          <img
            src={`data:image/png;base64,${icon}`}
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
          <div className="truncate text-sm">{getDisplayName(item.name, showExtension)}</div>
        )}
        <div className="truncate text-[10px] text-muted-foreground">
          {item.path}
        </div>
      </div>
    </div>
  );
}