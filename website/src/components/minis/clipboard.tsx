import { Check, Copy, Pin } from "lucide-react";
import { useState } from "react";
import { ItemIcon, type ClipType } from "./item-icon";

type Entry = { id: number; type: ClipType; text: string };

const ENTRIES: Entry[] = [
  { id: 1, type: "text", text: "明天上午十点，实验楼 302 开题预答辩" },
  { id: 2, type: "link", text: "docs.qq.com/sheet/交通流理论复习表" },
  { id: 3, type: "image", text: "微信图片_20260814.jpg · 820 KB" },
  { id: 4, type: "file", text: "D:\\课程设计\\信号交叉口仿真.vi" },
  { id: 5, type: "text", text: "「城市轨道交通行车组织」课程笔记节选" },
];

export function MiniClipboard() {
  const [pinned, setPinned] = useState<Set<number>>(() => new Set([2]));
  const [copied, setCopied] = useState<number | null>(null);

  const togglePin = (id: number) =>
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = (id: number) => {
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 900);
  };

  const sorted = [...ENTRIES].sort(
    (a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)),
  );

  return (
    <ul className="space-y-1">
      {sorted.map((e) => (
        <li
          key={e.id}
          className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <ItemIcon type={e.type} />
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300">
            {e.text}
          </span>
          <span className="flex size-5 shrink-0 items-center justify-center">
            {pinned.has(e.id) && (
              <Pin className="size-3.5 fill-emerald-500 text-emerald-500 group-hover:hidden" />
            )}
          </span>
          <span className="hidden shrink-0 items-center gap-1 group-hover:flex">
            <button
              type="button"
              aria-label={pinned.has(e.id) ? "取消固定" : "固定"}
              onClick={() => togglePin(e.id)}
              className="text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <Pin
                className={`size-3.5 ${pinned.has(e.id) ? "fill-emerald-500 text-emerald-500" : ""}`}
              />
            </button>
            <button
              type="button"
              aria-label="复制"
              onClick={() => copy(e.id)}
              className="text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {copied === e.id ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
