import { cn } from "@/lib/utils";
import { Folder, File, Globe, AppWindow } from "lucide-react";
import type { QuicklaunchItem } from "./ItemCard";

interface GroupCardProps {
  id: number;
  name: string;
  items: QuicklaunchItem[];
  gridSize: number;
  fileIcons: Record<string, string>;
  selected: boolean;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
  onContextMenu?: (e: React.MouseEvent, id: number) => void;
}

const typeIcons = {
  app: AppWindow,
  file: File,
  folder: Folder,
  url: Globe,
};

export function GroupCard({
  id,
  name,
  items,
  gridSize,
  fileIcons,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
}: GroupCardProps) {
  const iconSize = Math.max(gridSize * 0.35, 16);
  const previewSize = Math.floor((gridSize - 16) / 2);

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-md border cursor-pointer transition-colors overflow-hidden",
        selected
          ? "border-primary bg-accent"
          : "border-transparent hover:bg-accent/50"
      )}
      style={{ height: `${gridSize}px` }}
      onClick={() => onSelect(id)}
      onDoubleClick={() => onOpen(id)}
      onContextMenu={(e) => onContextMenu?.(e, id)}
    >
      {/* 分组名称 */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/50">
        <Folder className="shrink-0 text-muted-foreground" style={{ width: iconSize, height: iconSize }} />
        <span className="truncate text-xs" title={name}>{name}</span>
      </div>
      
      {/* 子项目预览网格 (2x2) */}
      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-0.5 p-1">
        {items.slice(0, 4).map((item) => {
          const Icon = typeIcons[item.item_type];
          return (
            <div
              key={item.id}
              className="flex items-center justify-center rounded bg-muted/30"
              title={item.name}
            >
              {fileIcons[item.path] ? (
                <img
                  src={`data:image/png;base64,${fileIcons[item.path]}`}
                  className="object-contain"
                  style={{ width: previewSize * 0.6, height: previewSize * 0.6 }}
                  alt=""
                />
              ) : (
                <Icon
                  className="text-muted-foreground"
                  style={{ width: previewSize * 0.5, height: previewSize * 0.5 }}
                />
              )}
            </div>
          );
        })}
        {/* 空位占位符 */}
        {Array.from({ length: Math.max(0, 4 - items.length) }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center justify-center rounded bg-muted/20"
          >
            <div className="w-2 h-2 rounded-full bg-muted-foreground/20" />
          </div>
        ))}
      </div>
    </div>
  );
}