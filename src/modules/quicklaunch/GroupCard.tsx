import { cn } from "@/lib/utils";
import { File, Globe, AppWindow } from "lucide-react";
import type { QuicklaunchItem } from "./ItemCard";

interface GroupCardProps {
  id: number;
  name: string;
  items: QuicklaunchItem[];
  gridSize: number;
  fileIcons: Record<string, string>;
  selected: boolean;
  expanded: boolean;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
  onContextMenu?: (e: React.MouseEvent, id: number) => void;
}

const typeIcons = {
  app: AppWindow,
  file: File,
  folder: File,
  url: Globe,
};

export function GroupCard({
  id,
  name,
  items,
  gridSize,
  fileIcons,
  selected,
  expanded: _expanded,
  onSelect,
  onOpen,
  onContextMenu,
}: GroupCardProps) {
  const previewSize = Math.floor((gridSize - 20) / 2);

  return (
    <div
      className={cn(
        "group relative flex flex-col items-center justify-center gap-1 rounded-md border cursor-pointer transition-colors overflow-hidden",
        selected
          ? "border-primary bg-accent"
          : "border-transparent hover:bg-accent/50"
      )}
      style={{ padding: `${gridSize * 0.1}px` }}
      onClick={() => onSelect(id)}
      onDoubleClick={() => onOpen(id)}
      onContextMenu={(e) => onContextMenu?.(e, id)}
    >
      {/* 2x2 子项目预览网格 */}
      <div className="grid grid-cols-2 grid-rows-2 gap-0.5">
        {items.slice(0, 4).map((item) => {
          const Icon = typeIcons[item.item_type];
          return (
            <div
              key={item.id}
              className="flex items-center justify-center rounded bg-muted/30"
              style={{ width: previewSize, height: previewSize }}
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
            style={{ width: previewSize, height: previewSize }}
          >
            <div className="w-2 h-2 rounded-full bg-muted-foreground/20" />
          </div>
        ))}
      </div>
      
      {/* 分组名称（与普通项目一致） */}
      <span
        className="w-full truncate text-center leading-tight"
        style={{ fontSize: `${Math.max(gridSize * 0.15, 10)}px` }}
        title={name}
      >
        {name}
      </span>
    </div>
  );
}