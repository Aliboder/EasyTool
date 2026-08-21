import { FileText, Image as ImageIcon, Link2, Type } from "lucide-react";

export type ClipType = "text" | "link" | "image" | "file";

const MAP: Record<ClipType, typeof Type> = {
  text: Type,
  link: Link2,
  image: ImageIcon,
  file: FileText,
};

export function ItemIcon({ type }: { type: ClipType }) {
  const Icon = MAP[type];
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      <Icon className="size-3.5" />
    </span>
  );
}
