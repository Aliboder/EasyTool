import { useMemo, useState } from "react";
import { Pin, Search, Settings2, Trash2, ClipboardList } from "lucide-react";
import { cn } from "../lib/cn";

type ClipItem = {
  id: number;
  kind: "text" | "image" | "files";
  text: string;
  time: string;
  pinned: boolean;
};

const SEED: ClipItem[] = [
  { id: 1, kind: "text", text: "开题报告终稿：答辩定在 9 月 12 日上午，PPT 提前一晚发导师邮箱", time: "08/29 14:30", pinned: true },
  { id: 2, kind: "text", text: "git commit -m \"feat: paste plain text option\"", time: "08/29 14:12", pinned: false },
  { id: 3, kind: "image", text: "微信图片_20260827.jpg", time: "08/29 13:58", pinned: false },
  { id: 4, kind: "text", text: "https://github.com/Aliboder/EasyTool/releases", time: "08/29 13:41", pinned: false },
  { id: 5, kind: "files", text: "D:\\资料\\交通运输学\\第3章 交通流理论.pdf", time: "08/29 12:20", pinned: false },
  { id: 6, kind: "text", text: "API Key 已存入 Windows 凭据管理器，每个账户独立槽位", time: "08/29 11:47", pinned: false },
];

const TABS = ["全部", "固定", "文本", "图片", "文件"];
const MAX = 500;

export function RealClipboard() {
  const [items, setItems] = useState<ClipItem[]>(SEED);
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const kws = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((it) => {
      if (tab === 1 && !it.pinned) return false;
      if (tab === 2 && it.kind !== "text") return false;
      if (tab === 3 && it.kind !== "image") return false;
      if (tab === 4 && it.kind !== "files") return false;
      if (kws.length && !kws.every((k) => `${it.text} ${it.time}`.toLowerCase().includes(k))) return false;
      return true;
    });
  }, [items, tab, q]);

  const togglePin = (id: number) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, pinned: !it.pinned } : it)));
  const remove = (id: number) => setItems((prev) => prev.filter((it) => it.id !== id));

  return (
    <div className="flex h-[480px] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white font-sans shadow-2xl shadow-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
        <span className="flex gap-1.5">
          <span className="size-3 rounded-full bg-red-500/80" />
          <span className="size-3 rounded-full bg-yellow-500/80" />
          <span className="size-3 rounded-full bg-emerald-500/80" />
        </span>
        <span className="ml-1.5 text-xs font-medium text-zinc-500">EasyTool · 剪贴板</span>
        <span className="ml-auto rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {items.length}/{MAX} 条
        </span>
      </div>

      {/* 搜索 + 设置 */}
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
        <div className="flex flex-1 items-center gap-2 rounded-lg bg-zinc-100 px-2.5 py-1.5 dark:bg-zinc-800">
          <Search className="size-3.5 shrink-0 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索剪贴板历史…"
            className="w-full bg-transparent text-xs text-zinc-800 outline-none placeholder:text-zinc-500 dark:text-zinc-200 dark:placeholder:text-zinc-500"
          />
        </div>
        <Settings2 className="size-3.5 text-zinc-500" />
      </div>

      {/* Tab */}
      <div className="flex items-center gap-1 border-b border-zinc-100 px-4 py-1.5 dark:border-zinc-800">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] transition-colors",
              i === tab ? "bg-emerald-500/15 font-medium text-emerald-600 dark:text-emerald-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-400">
            <ClipboardList className="size-8 opacity-40" />
            <p className="text-xs">{q ? `未找到匹配「${q}」的记录` : "暂无剪贴板记录"}</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((it) => (
              <li
                key={it.id}
                className="group flex items-center gap-2.5 rounded-lg border border-zinc-100 px-3 py-2 transition-colors hover:border-emerald-500/30 dark:border-zinc-800"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md text-[10px] font-medium",
                    it.kind === "image"
                      ? "bg-cyan-500/10 text-cyan-500"
                      : it.kind === "files"
                        ? "bg-amber-500/10 text-amber-500"
                        : "bg-emerald-500/10 text-emerald-500",
                  )}
                >
                  {it.kind === "text" ? "TXT" : it.kind === "image" ? "IMG" : "FLE"}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">{it.text}</span>
                {/* 固定列：时间 + 分隔竖线 + 操作（与真实 App 对齐） */}
                <span className="flex min-w-[64px] shrink-0 flex-col items-end gap-0.5 border-l pl-2.5">
                  <span className="text-[9px] tabular-nums text-zinc-500 dark:text-zinc-500">{it.time}</span>
                  <span className="flex items-center gap-1 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      aria-label="置顶"
                      onClick={() => togglePin(it.id)}
                      className={cn("rounded p-0.5 hover:text-emerald-500", it.pinned && "text-emerald-500 opacity-100")}
                    >
                      <Pin className="size-3" />
                    </button>
                    <button aria-label="删除" onClick={() => remove(it.id)} className="rounded p-0.5 hover:text-red-500">
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}