// 剪贴板可复用视图件：右侧操作列、右键菜单、大图预览浮层（从 Clippage 抽出）
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { fmtTime, isImageItem } from "./ui-shared";
import { ContextMenu } from "@/components/ui/context-menu";
import { ContextMenuItem } from "@/components/ui/context-menu-item";
import { ContextMenuDivider } from "@/components/ui/context-menu-divider";
import {
  Copy,
  ExternalLink,
  Eye,
  FolderOpen,
  MessageSquare,
  Pin,
  Smile,
  Trash2,
  Type,
  X,
  Loader2,
} from "lucide-react";

export interface ItemDto {
  id: number;
  kind: string;
  preview: string;
  full: string | null;
  file_count: number;
  pinned: boolean;
  created_at: number;
  note: string | null;
}

/** 右操作列：时间 + 分隔竖线 + 置顶/删除。hover=true 时操作悬停显示（分区文本卡），否则常驻（列表模式） */
export function ItemActionColumn({
  item,
  showTimestamps,
  hover = true,
  onDelete,
  onTogglePin,
}: {
  item: ItemDto;
  showTimestamps: boolean;
  hover?: boolean;
  onDelete: (id: number) => void;
  onTogglePin: (id: number, pinned: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-end border-l pl-2.5",
        hover ? "min-w-[72px] gap-0.5" : "min-w-[64px] gap-1",
      )}
    >
      {showTimestamps && (
        <div className="text-[10px] tabular-nums text-muted-foreground">
          {fmtTime(item.created_at)}
        </div>
      )}
      <div
        className={cn(
          "flex items-center gap-0.5 text-muted-foreground",
          hover && "opacity-0 transition-opacity group-hover:opacity-100",
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item.id);
          }}
          aria-label="删除"
          className="rounded p-1 transition-colors hover:bg-destructive/15 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(item.id, !item.pinned);
          }}
          aria-label={item.pinned ? "取消置顶" : "置顶"}
          className={cn(
            "rounded p-1 transition-colors hover:bg-accent",
            item.pinned ? "text-primary" : "hover:text-foreground",
          )}
        >
          <Pin className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/** 条目右键菜单（按条目类型渲染可用动作） */
export function ClipboardContextMenu({
  menu,
  onClose,
  handlers,
}: {
  menu: { x: number; y: number; item: ItemDto } | null;
  onClose: () => void;
  handlers: {
    onTogglePin: (id: number, pinned: boolean) => void;
    onCopy: (id: number) => void;
    onCopyPlain: (id: number) => void;
    onAddEmoji: (item: ItemDto) => void;
    onViewImage: (item: ItemDto) => void;
    onOpenExternal: (item: ItemDto) => void;
    onOpenLocation: (path: string) => void;
    onEditNote: (item: ItemDto) => void;
    onDelete: (id: number) => void;
  };
}) {
  const item = menu?.item;
  return (
    <ContextMenu visible={!!menu} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={onClose}>
      <ContextMenuItem
        icon={<Pin className="size-3.5" />}
        label={item?.pinned ? "取消固定" : "固定"}
        onClick={() => item && handlers.onTogglePin(item.id, !item.pinned)}
      />
      <ContextMenuItem
        icon={<Copy className="size-3.5" />}
        label="复制到剪贴板"
        onClick={() => item && handlers.onCopy(item.id)}
      />
      {item?.kind === "text" && (
        <ContextMenuItem
          icon={<Type className="size-3.5" />}
          label="复制为纯文本"
          onClick={() => item && handlers.onCopyPlain(item.id)}
        />
      )}
      {item && isImageItem(item) && (
        <ContextMenuItem
          icon={<Smile className="size-3.5" />}
          label="添加为表情"
          onClick={() => handlers.onAddEmoji(item)}
        />
      )}
      {item && isImageItem(item) && (
        <ContextMenuItem
          icon={<Eye className="size-3.5" />}
          label="查看大图"
          onClick={() => handlers.onViewImage(item)}
        />
      )}
      {item && isImageItem(item) && (
        <ContextMenuItem
          icon={<ExternalLink className="size-3.5" />}
          label="用系统看图打开"
          onClick={() => handlers.onOpenExternal(item)}
        />
      )}
      {item?.kind === "files" && (
        <ContextMenuItem
          icon={<FolderOpen className="size-3.5" />}
          label="打开所在位置"
          onClick={() => item && handlers.onOpenLocation(item.preview)}
        />
      )}
      <ContextMenuDivider />
      <ContextMenuItem
        icon={<MessageSquare className="size-3.5" />}
        label="编辑备注"
        onClick={() => item && handlers.onEditNote(item)}
      />
      <ContextMenuItem
        icon={<Trash2 className="size-3.5" />}
        label="删除"
        onClick={() => item && handlers.onDelete(item.id)}
        className="text-destructive"
      />
    </ContextMenu>
  );
}

/** 大图预览浮层：滚轮缩放（50%-400%）、双击复位 */
export function PreviewOverlay({
  preview,
  info,
  loading,
  onClose,
}: {
  preview: { src: string; name: string } | null;
  info: string;
  loading: boolean;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const resetZoom = useCallback(() => setZoom(1), []);

  if (!preview) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div className="relative flex max-h-[92%] max-w-[92%] items-center justify-center">
        {loading && (
          <div className="flex flex-col items-center gap-2 text-white/90">
            <Loader2 className="size-6 animate-spin" />
            <span className="text-xs">加载中…</span>
          </div>
        )}
        {preview.src && (
          <img
            src={preview.src}
            alt=""
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              e.preventDefault();
              setZoom((z) => Math.min(4, Math.max(0.5, z + (e.deltaY < 0 ? 0.1 : -0.1))));
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              resetZoom();
            }}
            className="max-h-[92vh] max-w-[92vw] rounded object-contain shadow-lg transition-transform duration-100"
            style={{ transform: `scale(${zoom})` }}
          />
        )}
        {zoom !== 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              resetZoom();
            }}
            aria-label="重置缩放"
            className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/90 backdrop-blur transition-colors hover:bg-black/80"
          >
            {Math.round(zoom * 100)}% · 双击复位
          </button>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3">
        <span className="max-w-[70%] truncate text-xs text-white/90" title={preview.name}>
          {preview.name}
          {info && <span className="ml-2 opacity-70">· {info}</span>}
        </span>
        <button
          onClick={onClose}
          aria-label="关闭预览"
          className="pointer-events-auto rounded-full bg-black/50 p-1.5 text-white/90 transition-colors hover:bg-black/70"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}