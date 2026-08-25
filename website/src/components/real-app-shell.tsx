import { useState } from "react";
import { ClipboardList, Clock, Gauge, Search, Settings2, Smile } from "lucide-react";

const MODULES = [
  { id: "clipboard", icon: ClipboardList, label: "剪贴板" },
  { id: "quota", icon: Gauge, label: "额度" },
  { id: "emoji", icon: Smile, label: "表情" },
  { id: "search", icon: Search, label: "搜索" },
  { id: "timetracker", icon: Clock, label: "时长" },
];

export function RealAppShell() {
  const [active, setActive] = useState("clipboard");

  return (
    <div className="flex h-[420px] flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-950 font-sans text-zinc-100 shadow-2xl shadow-black/40">
      {/* main content area */}
      <div className="flex-1 overflow-hidden bg-zinc-900 p-4">
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10">
            {(() => {
              const m = MODULES.find((m) => m.id === active);
              if (!m) return null;
              return <m.icon className="size-6 text-emerald-400" />;
            })()}
          </div>
          <p className="mt-3 text-sm font-medium text-zinc-300">
            {MODULES.find((m) => m.id === active)?.label}模块
          </p>
          <p className="mt-1 text-[10px] text-zinc-500">此处为模块主页面内容区域</p>
        </div>
      </div>

      {/* sidebar */}
      <div className="flex items-center border-t border-white/5 bg-zinc-900 px-3 py-2">
        <span className="mr-4 text-xs font-bold text-zinc-400">EasyTool</span>
        <div className="flex flex-1 items-center justify-center gap-1">
          {MODULES.map((m) => (
            <button
              key={m.id}
              onClick={() => setActive(m.id)}
              className={`flex flex-col items-center gap-0.5 rounded-md px-3 py-1 transition-colors ${
                active === m.id ? "bg-white/10 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <m.icon className="size-4" />
              <span className="text-[9px]">{m.label}</span>
            </button>
          ))}
          <button className="flex flex-col items-center gap-0.5 rounded-md px-3 py-1 text-zinc-500 hover:text-zinc-300">
            <Settings2 className="size-4" />
            <span className="text-[9px]">设置</span>
          </button>
        </div>
      </div>
    </div>
  );
}
