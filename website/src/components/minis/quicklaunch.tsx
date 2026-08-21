import { motion } from "motion/react";
import { useState } from "react";

type Item = { icon: string; label: string; type: string };

const ITEMS: Item[] = [
  { icon: "📁", label: "项目文档", type: "folder" },
  { icon: "💻", label: "VS Code", type: "app" },
  { icon: "🌐", label: "GitHub", type: "url" },
  { icon: "📄", label: "开题报告.docx", type: "file" },
  { icon: "🔧", label: "EasyTool", type: "app" },
  { icon: "📊", label: "课程设计", type: "folder" },
  { icon: "🎮", label: "Steam", type: "app" },
  { icon: "📝", label: "笔记.md", type: "file" },
];

const TYPES = ["全部", "应用", "文件", "文件夹", "链接"];

export function MiniQuicklaunch() {
  const [sel, setSel] = useState<number | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");

  return (
    <div>
      {/* filter bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {TYPES.map((t, i) => (
            <button key={t} className={`rounded px-2 py-0.5 text-[10px] transition-colors ${i === 0 ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"}`}>{t}</button>
          ))}
        </div>
        <button onClick={() => setView(view === "grid" ? "list" : "grid")} className="text-zinc-500 hover:text-zinc-300">
          <span className="text-[10px]">{view === "grid" ? "☰" : "⊞"}</span>
        </button>
      </div>

      {/* grid view */}
      {view === "grid" && (
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {ITEMS.map((item, i) => (
            <motion.button
              key={item.label}
              whileTap={{ scale: 0.92 }}
              onClick={() => setSel(i)}
              className={`flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors ${sel === i ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/5 hover:border-white/10"}`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="w-full truncate text-center text-[9px] text-zinc-400">{item.label}</span>
            </motion.button>
          ))}
        </div>
      )}

      {/* list view */}
      {view === "list" && (
        <div className="mt-2 space-y-0.5">
          {ITEMS.map((item, i) => (
            <button
              key={item.label}
              onClick={() => setSel(i)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${sel === i ? "bg-emerald-500/10" : "hover:bg-white/5"}`}
            >
              <span className="text-sm">{item.icon}</span>
              <span className="flex-1 truncate text-[11px] text-zinc-300">{item.label}</span>
              <span className="text-[9px] text-zinc-600">{item.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
