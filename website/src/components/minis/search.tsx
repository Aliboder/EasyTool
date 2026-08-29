import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

type Result = { name: string; path: string };

const FILES: Result[] = [
  { name: "交通流理论_第3章.pdf", path: "D:\\资料\\交通运输学" },
  { name: "开题报告_v3.docx", path: "D:\\SystemFiles\\Documents" },
  { name: "交叉口仿真数据.xlsx", path: "D:\\课程设计" },
  { name: "EasyTool_0.7.0_x64-setup.exe", path: "D:\\Downloads" },
  { name: "轨道交通行车组织.mp4", path: "E:\\网课录播" },
  { name: "毕业设计参考文献汇总.pdf", path: "D:\\资料\\文献" },
  { name: "实验数据采集.py", path: "D:\\Code\\sensor-lab" },
  { name: "英语六级高频词汇.txt", path: "D:\\资料\\英语" },
];

// 多关键词全部命中 + 全部位置高亮（与 App 一致）
function highlight(text: string, q: string): ReactNode {
  const kws = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!kws.length) return text;
  const pattern = kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(${pattern})`, "gi");
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <mark key={`${idx}-${m[0]}`} className="rounded-sm bg-emerald-500/25 px-0.5 text-inherit">
        {m[0]}
      </mark>,
    );
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

export function MiniSearch() {
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const kws = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!kws.length) return FILES.slice(0, 4);
    return FILES.filter((f) => {
      const hay = `${f.name} ${f.path}`.toLowerCase();
      return kws.every((k) => hay.includes(k));
    });
  }, [q]);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] md:gap-6">
      <div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="试试输入「pdf」或「D:\\资料」"
            aria-label="搜索文件"
            className="h-10 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-emerald-500"
          />
        </div>
        <p className="mt-2 pl-1 text-xs text-zinc-400 dark:text-zinc-500">
          Everything 引擎 · 输入即出结果
        </p>
      </div>

      <div className="min-w-0">
        {results.length === 0 ? (
          <div className="flex h-full min-h-24 items-center justify-center rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
            没有匹配的文件，换个关键词试试
          </div>
        ) : (
          <ul className="space-y-0.5">
            {results.map((f) => (
              <li
                key={f.name}
                className="flex items-baseline gap-3 rounded-lg px-3 py-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="shrink-0 text-sm font-medium">
                  {highlight(f.name, q.trim())}
                </span>
                <span className="min-w-0 truncate text-xs text-zinc-400 dark:text-zinc-500">
                  {f.path}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
