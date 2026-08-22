import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { ItemCard } from "./ItemCard";
import type { QuicklaunchItem } from "./ItemCard";

interface FolderOverlayProps {
  folderName: string;
  items: QuicklaunchItem[];
  gridSize: number;
  fileIcons: Record<string, string>;
  selectedId: number | null;
  anchorPosition?: { x: number; y: number };
  singleClickOpen?: boolean;
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
  anchorPosition,
  singleClickOpen = false,
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

  // 计算展开窗口的位置
  const calculatePosition = () => {
    if (!anchorPosition) {
      // 没有锚点位置时，居中显示
      return {};
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const overlayWidth = expandedGridSize * cols + 64;
    const overlayHeight = expandedGridSize * Math.ceil(items.length / cols) + 200;
    const padding = 16;

    let x = anchorPosition.x;
    let y = anchorPosition.y;

    // 优先显示在分组的右下方
    x = anchorPosition.x + padding;
    y = anchorPosition.y + padding;

    // 右侧超出：显示在分组左侧
    if (x + overlayWidth > viewportWidth - padding) {
      x = anchorPosition.x - overlayWidth - padding;
    }

    // 底部超出：显示在分组上方
    if (y + overlayHeight > viewportHeight - padding) {
      y = anchorPosition.y - overlayHeight - padding;
    }

    // 左侧超出：确保不超出左边界
    if (x < padding) {
      x = padding;
    }

    // 顶部超出：确保不超出上边界
    if (y < padding) {
      y = padding;
    }

    return { left: x, top: y };
  };

  const positionStyle = anchorPosition ? calculatePosition() : {};

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xl animate-in fade-in-0 duration-200">
      <div
        ref={overlayRef}
        className={cn(
          "absolute rounded-2xl bg-background/95 backdrop-blur-2xl px-4 py-3 shadow-2xl shadow-primary/10 border border-white/10",
          "animate-in zoom-in-95 fade-in-0 duration-300",
          !anchorPosition && "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        )}
        style={{
          ...positionStyle,
          minWidth: `${expandedGridSize * cols + 64}px`,
          maxWidth: "90vw",
        }}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* 顶部信息标题区 */}
        <div className="flex items-center justify-center gap-2 py-0.5">
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleKeyDown}
              className="text-sm font-semibold text-center bg-transparent border-b border-primary outline-none"
              style={{ width: `${Math.max(editName.length * 0.8, 4)}ch` }}
              autoFocus
            />
          ) : (
            <span
              className="text-sm font-semibold cursor-pointer hover:text-primary transition-colors"
              onClick={() => {
                setEditName(folderName);
                setIsEditing(true);
              }}
              title="点击编辑名称"
            >
              {folderName}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">
            ({items.length})
          </span>
        </div>

        {/* 分隔线 */}
        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent mb-6" />

        {/* 中部图标陈列区 */}
        <div
          className="grid gap-2 justify-center py-2"
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
              singleClickOpen={singleClickOpen}
              onSelect={onSelect}
              onOpen={onOpen}
              onDelete={onDelete}
              onRename={onRename}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>

        {/* 底部提示区 */}
        <div className="mt-1 pt-1 border-t border-border/30">
          <p className="text-center text-[9px] text-muted-foreground/60">
            点击空白处或 <kbd className="px-0.5 py-px rounded bg-muted/50 text-[8px] font-mono">ESC</kbd> 关闭
          </p>
        </div>
      </div>
    </div>
  );
}