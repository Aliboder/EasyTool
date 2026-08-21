import { useState } from "react";
import { FileText, Folder, Image, LayoutGrid, LayoutList, Search, Settings2 } from "lucide-react";

const FILES = [
  { icon: FileText, name: "交通流理论_第3章.pdf", path: "D:\\资料\\交通运输学", size: "2.4 MB", time: "2026-08-12", type: "doc" },
  { icon: Image, name: "微信图片_20260814.jpg", path: "D:\\微信文件", size: "820 KB", time: "2026-08-14", type: "image" },
  { icon: FileText, name: "开题报告_v3.docx", path: "D:\\SystemFiles\\Documents", size: "156 KB", time: "2026-08-10", type: "doc" },
  { icon: Folder, name: "课程设计", path: "D:\\", size: "—", time: "2026-07-20", type: "folder" },
  { icon: FileText, name: "交叉口仿真数据.xlsx", path: "D:\\课程设计", size: "1.1 MB", time: "2026-08-08", type: "doc" },
  { icon: FileText, name: "EasyTool_0.4.5_x64-setup.exe", path: "D:\\Downloads", size: "8.2 MB", time: "2026-08-21", type: "doc" },
  { icon: Image, name: "毕业合照.jpg", path: "D:\\微信文件", size: "3.2 MB", time: "2026-07-15", type: "image" },
  { icon: FileText, name: "数据结构复习笔记.md", path: "D:\\资料\\编程", size: "42 KB", time: "2026-08-18", type: "doc" },
];

const FILTERS = ["全部", "文件夹", "文件", "文档", "图片", "视频", "音频", "压缩"];

export function RealMainWindow() {
  const [sel, setSel] = useState(0);
  const [view, setView] = useState<"list" | "grid">("list");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(0);

  const files = FILES.filter((f) => {
    const matchQ = !q || f.name.toLowerCase().includes(q.toLowerCase()) || f.path.toLowerCase().includes(q.toLowerCase());
    const matchType = filter === 0 || f.type === ["", "folder", "doc", "doc", "image", "", "", ""][filter];
    return matchQ && matchType;
  });

  return (
    <div className="flex h-[480px] flex-col overflow-hidden rounded-2xl border-2 border-white/10 bg-zinc-900 font-sans text-zinc-100 shadow-2xl shadow-black/40">
      {/* title bar */}
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <div className="flex gap-1.5">
          <span className="size-3 rounded-full bg-red-500/80" />
          <span className="size-3 rounded-full bg-yellow-500/80" />
          <span className="size-3 rounded-full bg-emerald-500/80" />
        </div>
        <span className="ml-2 text-xs text-zinc-500">EasyTool · 文件搜索</span>
      </div>

      {/* search bar */}
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
        <Search className="size-4 shrink-0 text-zinc-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入关键词搜索文件…"
          className="flex-1 bg-transparent text-sm text-zinc-300 outline-none placeholder:text-zinc-600"
        />
        {q && <span className="text-[10px] text-zinc-500">{files.length} 个结果</span>}
        <button onClick={() => setView(view === "list" ? "grid" : "list")} className="text-zinc-500 hover:text-zinc-300">
          {view === "list" ? <LayoutGrid className="size-4" /> : <LayoutList className="size-4" />}
        </button>
        <Settings2 className="size-4 text-zinc-500" />
      </div>

      {/* filter bar */}
      <div className="flex items-center gap-1 border-b border-white/5 px-4 py-2">
        {FILTERS.map((f, i) => (
          <button key={f} onClick={() => setFilter(i)} className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${i === filter ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"}`}>
            {f}
          </button>
        ))}
      </div>

      {/* status */}
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-1.5">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        <span className="text-[10px] text-zinc-500">Everything 已连接 · {files.length} 项</span>
      </div>

      {/* list view */}
      {view === "list" && (
        <div className="flex-1 overflow-y-auto px-1 py-1">
          {files.map((f, i) => (
            <button
              key={f.name}
              onClick={() => setSel(i)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${i === sel ? "bg-emerald-500/10" : "hover:bg-white/5"}`}
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
                <f.icon className="size-3.5 text-zinc-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-zinc-200">{f.name}</p>
                <p className="truncate text-[10px] text-zinc-500">{f.path}</p>
              </div>
              <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{f.size}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{f.time}</span>
            </button>
          ))}
        </div>
      )}

      {/* grid view */}
      {view === "grid" && (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-4 gap-2">
            {files.map((f, i) => (
              <button
                key={f.name}
                onClick={() => setSel(i)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border p-2.5 transition-colors ${i === sel ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/5 hover:border-white/10"}`}
              >
                <div className="flex size-10 items-center justify-center rounded-lg bg-zinc-800">
                  <f.icon className="size-5 text-zinc-400" />
                </div>
                <span className="w-full truncate text-center text-[9px] text-zinc-400">{f.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
