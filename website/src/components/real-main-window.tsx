import { FileText, Folder, Image, LayoutGrid, Search, Settings2 } from "lucide-react";

const FILES = [
  { icon: FileText, name: "交通流理论_第3章.pdf", path: "D:\\资料\\交通运输学", size: "2.4 MB", time: "2026-08-12" },
  { icon: Image, name: "微信图片_20260814.jpg", path: "D:\\微信文件", size: "820 KB", time: "2026-08-14" },
  { icon: FileText, name: "开题报告_v3.docx", path: "D:\\SystemFiles\\Documents", size: "156 KB", time: "2026-08-10" },
  { icon: Folder, name: "课程设计", path: "D:\\", size: "—", time: "2026-07-20" },
  { icon: FileText, name: "交叉口仿真数据.xlsx", path: "D:\\课程设计", size: "1.1 MB", time: "2026-08-08" },
  { icon: FileText, name: "EasyTool_0.4.4_x64-setup.exe", path: "D:\\Downloads", size: "8.2 MB", time: "2026-08-20" },
];

const FILTERS = ["全部", "文件夹", "文件", "文档", "图片", "视频", "音频", "压缩"];

export function RealMainWindow() {
  return (
    <div className="flex h-[420px] flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-900 font-sans text-zinc-100 shadow-2xl shadow-black/40">
      {/* top bar */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
        <Search className="size-4 shrink-0 text-zinc-500" />
        <span className="flex-1 bg-transparent text-sm text-zinc-400">输入关键词搜索文件…</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">共 10771 项</span>
        <LayoutGrid className="size-4 text-zinc-500" />
        <Settings2 className="size-4 text-zinc-500" />
      </div>

      {/* filter bar */}
      <div className="flex items-center gap-1 border-b border-white/5 px-3 py-2">
        {FILTERS.map((f, i) => (
          <span
            key={f}
            className={`rounded-md px-2 py-1 text-[11px] ${
              i === 0 ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500"
            }`}
          >
            {f}
          </span>
        ))}
      </div>

      {/* status bar */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        <span className="text-[10px] text-zinc-500">Everything 已连接</span>
      </div>

      {/* file list */}
      <div className="flex-1 overflow-hidden px-1 py-1">
        {FILES.map((f, i) => (
          <div
            key={f.name}
            className={`flex items-center gap-2.5 rounded-md px-2 py-2 ${
              i === 0 ? "bg-emerald-500/10" : "hover:bg-white/5"
            }`}
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded bg-zinc-800">
              <f.icon className="size-3.5 text-zinc-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-zinc-200">{f.name}</p>
              <p className="truncate text-[10px] text-zinc-500">{f.path}</p>
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{f.size}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{f.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
