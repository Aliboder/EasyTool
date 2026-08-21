import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ItemCard } from "./ItemCard";
import type { QuicklaunchItem } from "./ItemCard";

interface FolderOverlayProps {
  folderName: string;
  items: QuicklaunchItem[];
  gridSize: number;
  fileIcons: Record<string, string>;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onOpen: (item: QuicklaunchItem) => void;
  onDelete: (id: number) => void;
  onRename: (id: number, name: string) => void;
  onContextMenu: (e: React.MouseEvent, item: QuicklaunchItem) => void;
  onRenameFolder: (name: string) => void;
  onClose: () => void;
}

export function FolderOverlay({
  folderName,
  items,
  gridSize,
  fileIcons,
  selectedId,
  onSelect,
  onOpen,
  onDelete,
  onRename,
  onContextMenu,
  onRenameFolder,
  onClose,
}: FolderOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folderName);

  // 点击外部区域关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // 延迟添加事件监听，避免立即触发
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  // ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // 计算展开后的网格大小
  const expandedGridSize = Math.min(gridSize * 1.2, 96);
  const cols = Math.min(Math.ceil(Math.sqrt(items.length)), 6);

  const handleRenameSubmit = () => {
    if (editName.trim() && editName !== folderName) {
      onRenameFolder(editName.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setEditName(folderName);
      setIsEditing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={overlayRef}
        className={cn(
          "relative rounded-2xl bg-background p-6 shadow-2xl",
          "animate-in zoom-in-95 fade-in-0 duration-200"
        )}
        style={{
          minWidth: `${expandedGridSize * cols + 48}px`,
          maxWidth: "90vw",
        }}
      >
        {/* 分组名称（可编辑） */}
        <div className="mb-4 text-center">
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleKeyDown}
              className="text-lg font-semibold text-center bg-transparent border-b border-primary outline-none"
              autoFocus
            />
          ) : (
            <h3
              className="text-lg font-semibold cursor-pointer hover:text-primary transition-colors"
              onClick={() => {
                setEditName(folderName);
                setIsEditing(true);
              }}
              title="点击编辑名称"
            >
              {folderName}
            </h3>
          )}
        </div>

        {/* 子项目网格 */}
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${cols}, ${expandedGridSize}px)`,
          }}
        >
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              viewMode="grid"
              gridSize={expandedGridSize}
              icon={item.item_type === "url" ? null : fileIcons[item.path]}
              selected={selectedId === item.id}
              onSelect={onSelect}
              onOpen={onOpen}
              onDelete={onDelete}
              onRename={onRename}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>

        {/* 关闭提示文字 */}
        <div className="mt-4 text-center text-xs text-muted-foreground">
          点击空白处可关闭
        </div>
      </div>
    </div>
  );
}