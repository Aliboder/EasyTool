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
  onSelect,
  onOpen,
  onContextMenu,
}: GroupCardProps) {
  // 计算2x2网格的单元格大小，留出名称空间
  const nameHeight = Math.max(gridSize * 0.18, 12);
  const padding = gridSize * 0.08;
  const gridArea = gridSize - nameHeight - padding * 2;
  const cellSize = Math.floor((gridArea - 4) / 2); // 4px for gap

  return (
    <div
      className={cn(
        "group relative flex flex-col items-center justify-center gap-1 rounded-md border cursor-pointer transition-colors overflow-hidden",
        selected
          ? "border-primary bg-accent"
          : "border-transparent hover:bg-accent/50"
      )}
      style={{
        width: `${gridSize}px`,
        height: `${gridSize}px`,
        padding: `${padding}px`,
      }}
      onClick={() => onSelect(id)}
      onDoubleClick={() => onOpen(id)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(e, id);
      }}
    >
      {/* 2x2 子项目预览网格 */}
      <div
        className="grid grid-cols-2 grid-rows-2 gap-0.5"
        style={{ width: `${gridArea}px`, height: `${gridArea}px` }}
      >
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
                  style={{ width: cellSize * 0.6, height: cellSize * 0.6 }}
                  alt=""
                />
              ) : (
                <Icon
                  className="text-muted-foreground"
                  style={{ width: cellSize * 0.5, height: cellSize * 0.5 }}
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
      
      {/* 分组名称 */}
      <span
        className="w-full truncate text-center leading-tight"
        style={{ fontSize: `${Math.max(nameHeight * 0.7, 10)}px` }}
        title={name}
      >
        {name}
      </span>
    </div>
  );
}