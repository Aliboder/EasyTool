import { Check, Copy, Pin } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { ItemIcon, type ClipType } from "./item-icon";

type Entry = { id: number; type: ClipType; text: string; time: string };

const ENTRIES: Entry[] = [
  { id: 1, type: "text", text: "明天上午十点，实验楼 302 开题预答辩", time: "08/29 14:30" },
  { id: 2, type: "link", text: "docs.qq.com/sheet/交通流理论复习表", time: "08/29 14:12" },
  { id: 3, type: "image", text: "微信图片_20260814.jpg · 820 KB", time: "08/29 13:58" },
  { id: 4, type: "file", text: "D:\\课程设计\\信号交叉口仿真.vi", time: "08/29 13:41" },
  { id: 5, type: "text", text: "「城市轨道交通行车组织」课程笔记节选", time: "08/29 12:20" },
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

  // 固定条目置顶在前（内部保持原序）
  const sorted = [...ENTRIES].sort(
    (a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)),
  );

  return (
    <ul className="space-y-1">
      {sorted.map((e) => (
        <li
          key={e.id}
          className="group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <ItemIcon type={e.type} />
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300">
            {e.text}
          </span>
          {/* 固定列：时间 + 分割竖线 + 悬停操作（与真实 App 对齐） */}
          <span className="flex min-w-[58px] shrink-0 flex-col items-end gap-0.5 border-l pl-2">
            <span className="text-[9px] tabular-nums text-zinc-500 dark:text-zinc-500">{e.time}</span>
            <span className="flex items-center gap-1 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                aria-label={pinned.has(e.id) ? "取消固定" : "固定"}
                onClick={() => togglePin(e.id)}
                className="transition-colors hover:text-emerald-500"
              >
                <Pin className={cn("size-3", pinned.has(e.id) && "fill-emerald-500 text-emerald-500")} />
              </button>
              <button
                type="button"
                aria-label="复制"
                onClick={() => copy(e.id)}
                className="transition-colors hover:text-emerald-500"
              >
                {copied === e.id ? (
                  <Check className="size-3 text-emerald-500" />
                ) : (
                  <Copy className="size-3" />
                )}
              </button>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}