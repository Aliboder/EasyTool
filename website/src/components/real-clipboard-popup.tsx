import { FileText, GripVertical, Image, Link2, Pin, Search, Type } from "lucide-react";

const ITEMS = [
  { type: "file", icon: FileText, text: "EasyTool_0.4.4_x64-setup.exe", pinned: true, time: "" },
  { type: "text", icon: Type, text: "开题报告终稿：答辩定在 9 月 12 日上午", pinned: false, time: "刚刚" },
  { type: "link", icon: Link2, text: "api-docs.deepseek.com/zh-cn", pinned: false, time: "1 分钟前" },
  { type: "text", icon: Type, text: "API Key 已存入 Windows 凭据管理器", pinned: false, time: "3 分钟前" },
  { type: "image", icon: Image, text: "Screenshot 2026-08-19 224501.png", pinned: false, time: "8 分钟前" },
  { type: "file", icon: FileText, text: "D:\\资料\\交通运输学\\第3章 交通流理论.pdf", pinned: false, time: "12 分钟前" },
];

const TABS = ["全部", "固定", "文本", "图片", "文件"];

export function RealClipboardPopup() {
  return (
    <div className="flex h-[420px] w-[300px] flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-900 font-sans text-zinc-100 shadow-2xl shadow-black/40">
      {/* top bar */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
        <GripVertical className="size-3.5 text-zinc-600" />
        <Search className="size-3.5 text-zinc-500" />
        <span className="flex-1 text-xs text-zinc-500">搜索剪贴板历史…</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">133</span>
      </div>

      {/* filter tabs */}
      <div className="flex items-center gap-1 border-b border-white/5 px-3 py-1.5">
        {TABS.map((t, i) => (
          <span
            key={t}
            className={`rounded-full px-2.5 py-0.5 text-[10px] ${
              i === 0 ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500"
            }`}
          >
            {t}
          </span>
        ))}
      </div>

      {/* items */}
      <div className="flex-1 overflow-hidden px-1.5 py-1.5">
        {ITEMS.map((item, i) => (
          <div
            key={i}
            className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 ${
              i === 0
                ? "bg-emerald-500/10"
                : "hover:bg-white/5"
            }`}
          >
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-zinc-800">
              <item.icon className="size-3 text-zinc-500" />
            </div>
            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{item.text}</span>
            {item.pinned && <Pin className="size-3 shrink-0 fill-emerald-500 text-emerald-500" />}
            {!item.pinned && item.time && (
              <span className="shrink-0 text-[9px] text-zinc-600">{item.time}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
