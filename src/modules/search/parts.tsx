// 搜索模块共享工具与可复用视图件（从 SearchView / AppsGrid 抽出）
import { Copy, ExternalLink, FolderOpen, Pin } from "lucide-react";
import { ContextMenu } from "@/components/ui/context-menu";
import { ContextMenuItem } from "@/components/ui/context-menu-item";
import type { ScannedApp } from "./AppsGrid";
// 纯工具（无 UI 依赖）——测试直引 ./search-utils
export {
  Highlight,
  extractKeywords,
  fmtRecent,
  fmtSize,
  fmtTime,
  isImagePath,
} from "./search-utils";
export type { SearchResultDto } from "./search-utils";
import type { SearchResultDto } from "./search-utils";

/** 搜索结果右键菜单 */
export function SearchResultMenu({
  menu,
  onClose,
  onOpen,
  onOpenLocation,
  onCopyPath,
  onCopyFile,
}: {
  menu: { x: number; y: number; item: SearchResultDto } | null;
  onClose: () => void;
  onOpen: (item: SearchResultDto) => void;
  onOpenLocation: (item: SearchResultDto) => void;
  onCopyPath: (item: SearchResultDto) => void;
  onCopyFile: (item: SearchResultDto) => void;
}) {
  return (
    <ContextMenu visible={!!menu} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={onClose}>
      <ContextMenuItem
        icon={<ExternalLink className="size-3.5" />}
        label="打开"
        onClick={() => menu && onOpen(menu.item)}
      />
      <ContextMenuItem
        icon={<FolderOpen className="size-3.5" />}
        label="打开所在位置"
        onClick={() => menu && onOpenLocation(menu.item)}
      />
      <ContextMenuItem
        icon={<Copy className="size-3.5" />}
        label="复制路径"
        onClick={() => menu && onCopyPath(menu.item)}
      />
      <ContextMenuItem
        icon={<Copy className="size-3.5" />}
        label="复制文件"
        onClick={() => menu && onCopyFile(menu.item)}
      />
    </ContextMenu>
  );
}

/** 应用条目右键菜单（应用中心 / 搜索置顶区共用） */
export function AppsContextMenu({
  appMenu,
  pinnedSet,
  onClose,
  onOpen,
  onOpenLocation,
  onTogglePin,
}: {
  appMenu: { x: number; y: number; app: ScannedApp } | null;
  pinnedSet: Set<string>;
  onClose: () => void;
  onOpen: (path: string) => void;
  onOpenLocation: (app: ScannedApp) => void;
  onTogglePin: (app: ScannedApp) => void;
}) {
  return (
    <ContextMenu visible={!!appMenu} x={appMenu?.x ?? 0} y={appMenu?.y ?? 0} onClose={onClose}>
      <ContextMenuItem
        icon={<ExternalLink className="size-3.5" />}
        label="打开"
        onClick={() => {
          if (appMenu) {
            onOpen(appMenu.app.path);
            onClose();
          }
        }}
      />
      <ContextMenuItem
        icon={<FolderOpen className="size-3.5" />}
        label="打开所在位置"
        onClick={() => appMenu && onOpenLocation(appMenu.app)}
      />
      {appMenu && (
        <ContextMenuItem
          icon={<Pin className="size-3.5" />}
          label={pinnedSet.has(appMenu.app.path.toLowerCase()) ? "取消置顶" : "置顶"}
          onClick={() => appMenu && onTogglePin(appMenu.app)}
        />
      )}
    </ContextMenu>
  );
}