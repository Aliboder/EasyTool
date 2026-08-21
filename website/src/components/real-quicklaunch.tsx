import { useState } from "react";
import { Folder, FileText, Globe, Settings2, AppWindow, Search, Grid3X3, List } from "lucide-react";

type Item = { icon: LucideIcon | string; label: string; type: string; color?: string };
import type { LucideIcon } from "lucide-react";

const ITEMS: Item[] = [
  { icon: Folder, label: "项目文档", type: "folder", color: "text-yellow-400" },
  { icon: AppWindow, label: "VS Code", type: "app", color: "text-blue-400" },
  { icon: Globe, label: "GitHub", type: "url", color: "text-zinc-300" },
  { icon: FileText, label: "开题报告.docx", type: "file", color: "text-blue-300" },
  { icon: AppWindow, label: "EasyTool", type: "app", color: "text-emerald-400" },
  { icon: Folder, label: "课程设计", type: "folder", color: "text-yellow-400" },
  { icon: AppWindow, label: "Steam", type: "app", color: "text-blue-500" },
  { icon: FileText, label: "笔记.md", type: "file", color: "text-zinc-400" },
];

const TYPES = ["全部", "应用", "文件", "文件夹", "链接"];

export function RealQuicklaunch() {
  const [sel, setSel] = useState(0);
  const [view, setView] = useState<"grid" | "list">("grid");

  return (
    <div className="flex h-[420px] flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-900 font-sans text-zinc-100 shadow-2xl shadow-black/40">
      {/* top bar */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
        <Search className="size-4 shrink-0 text-zinc-500" />
        <span className="flex-1 text-sm text-zinc-500">搜索快捷方式…</span>
        <button onClick={() => setView(view === "grid" ? "list" : "grid")} className="text-zinc-500 hover:text-zinc-300">
          {view === "grid" ? <List className="size-4" /> : <Grid3X3 className="size-4" />}
        </button>
        <Settings2 className="size-4 text-zinc-500" />
      </div>

      {/* filter bar */}
      <div className="flex items-center gap-1 border-b border-white/5 px-3 py-2">
        {TYPES.map((t, i) => (
          <button key={t} className={`rounded-md px-2 py-1 text-[11px] transition-colors ${i === 0 ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"}`}>{t}</button>
        ))}
      </div>

      {/* grid view */}
      {view === "grid" && (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-4 gap-2">
            {ITEMS.map((item, i) => (
              <button
                key={item.label}
                onClick={() => setSel(i)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border p-2.5 transition-colors ${i === sel ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/5 hover:border-white/10"}`}
              >
                {typeof item.icon === "string" ? (
                  <span className="text-2xl">{item.icon}</span>
                ) : (
                  <item.icon className={`size-7 ${item.color}`} />
                )}
                <span className="w-full truncate text-center text-[10px] text-zinc-400">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* list view */}
      {view === "list" && (
        <div className="flex-1 overflow-y-auto px-1 py-1">
          {ITEMS.map((item, i) => (
            <button
              key={item.label}
              onClick={() => setSel(i)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${i === sel ? "bg-emerald-500/10" : "hover:bg-white/5"}`}
            >
              {typeof item.icon === "string" ? (
                <span className="text-lg">{item.icon}</span>
              ) : (
                <item.icon className={`size-5 ${item.color}`} />
              )}
              <span className="flex-1 truncate text-xs text-zinc-200">{item.label}</span>
              <span className="text-[10px] text-zinc-600">{item.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
