// 剪贴板列表共享的纯展示件（从 Clippage 抽出，与主文件无关的状态/项逻辑解耦）
import type { CSSProperties } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "avif", "tif", "tiff"];

export function isImageItem(item: { kind: string; preview: string }): boolean {
  if (item.kind === "image") return true;
  if (item.kind === "files") {
    const ext = item.preview.split(".").pop()?.toLowerCase() ?? "";
    return IMAGE_EXTS.includes(ext);
  }
  return false;
}

export function fileBasename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export const LINE_CLAMP: Record<number, string> = {
  1: "line-clamp-1",
  2: "line-clamp-2",
  3: "line-clamp-3",
};

/** 固定 MM/DD HH:mm（与 App 一致，不做人类化） */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 日期分组的本地键（yyyy-m-d），用于相邻项跨天判断 */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 日期分组标签：今天 / 昨天 / MM/DD 周X */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  const W = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${W[d.getDay()]}`;
}

/** 按天分隔头：居中「今天 · 12」样式，左右细分隔线 */
export function DayHeader({ label, count }: { label: string; count: number }) {
  return (
    <li className="flex items-center gap-3 px-1 py-0.5">
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
        {label} · {count}
      </span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
}

/** 多关键词全部命中高亮（预览/备注共用） */
export function highlight(text: string, kws: string[]): ReactNode {
  const keys = kws.filter((k) => k.length > 0);
  if (!keys.length) return text;
  const pattern = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(${pattern})`, "gi");
  const parts: ReactNode[] = [];
  let lastIdx = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > lastIdx) parts.push(text.slice(lastIdx, idx));
    parts.push(
      <mark key={`${idx}-${m[0]}`} className="rounded-sm bg-emerald-500/25 px-0.5 text-inherit">
        {m[0]}
      </mark>,
    );
    lastIdx = idx + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length ? parts : text;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Icon className="size-10 opacity-40" />
      <div className="text-center">
        <div className="text-sm">{title}</div>
        {description && <div className="mt-1 text-xs opacity-60">{description}</div>}
      </div>
    </div>
  );
}

/** 固定板块内可拖拽排序的小条目包装（小尺寸元素，transform 不会触发大卡片渲染问题） */
export function PinnedSortable({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    willChange: "transform",
  };
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className={cn(isDragging && "z-10 opacity-70")}
    >
      {children}
    </div>
  );
}