import { useState } from "react";
import { useToast } from "./toast";
import { SectionHead } from "./section-head";

type Hotkey = {
  action: string;
  keys: string[];
  desc: string;
  toast: string;
  module: string;
  color: string;
  colorBg: string;
};

const HOTKEYS: Hotkey[] = [
  { action: "主面板", keys: ["Ctrl", "Shift", "E"], desc: "统一呼出模式下打开主窗口，集成全部模块。关闭统一模式后，此热键可自定义。", toast: "主面板已打开", module: "全部模块", color: "text-emerald-400", colorBg: "bg-emerald-500/15" },
  { action: "剪贴板", keys: ["Ctrl", "Shift", "V"], desc: "直接呼出剪贴板弹窗，跟随鼠标。搜索、固定、复制一步到位。", toast: "剪贴板弹窗", module: "剪贴板历史", color: "text-blue-400", colorBg: "bg-blue-500/15" },
  { action: "表情面板", keys: ["Ctrl", "Shift", "J"], desc: "弹出表情选择器，分类浏览 + 收藏夹，选中即直输到当前输入框。", toast: "表情面板已呼出", module: "表情面板", color: "text-amber-400", colorBg: "bg-amber-500/15" },
  { action: "文件搜索", keys: ["Ctrl", "Shift", "F"], desc: "调用 Everything 引擎秒搜全盘文件名，结果支持复制路径/直接打开。", toast: "文件搜索已就绪", module: "文件秒搜", color: "text-cyan-400", colorBg: "bg-cyan-500/15" },
];

const KB_ROWS = [
  ["Esc","F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"],
  ["`","1","2","3","4","5","6","7","8","9","0","-","=","Del"],
  ["Tab","Q","W","E","R","T","Y","U","I","O","P","[","]","\\"],
  ["Caps","A","S","D","F","G","H","J","K","L",";","'","Enter"],
  ["Shift","Z","X","C","V","B","N","M",",",".","/","Shift"],
  ["Ctrl","Fn","Win","Alt","Space","Alt","Win","Menu","Ctrl"],
];

const WIDE = new Set(["Shift","Ctrl","Alt","Enter","Tab","Caps"]);

function Keyboard({ active }: { active: number }) {
  const hl = new Set<string>();
  if (active >= 0 && active < HOTKEYS.length) {
    HOTKEYS[active].keys.forEach((k) => hl.add(k.toLowerCase()));
  }
  const hk = HOTKEYS[active];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5 shadow-2xl shadow-black/40">
      <div className={`absolute inset-0 opacity-20 transition-all duration-500 ${hk.colorBg}`} />
      <div className="relative space-y-1.5">
        {KB_ROWS.map((row, ri) => (
          <div key={ri} className="flex gap-1.5">
            {row.map((key) => {
              const isHL = hl.has(key.toLowerCase());
              const w = key === "Space" ? "w-[180px]" : key.length > 3 ? "min-w-[48px]" : WIDE.has(key) ? "min-w-[52px]" : "min-w-[32px]";
              return (
                <span key={`${ri}-${key}`} className={`flex h-9 items-center justify-center rounded-lg border px-1.5 font-mono text-[10px] transition-all duration-300 ${w} ${isHL ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]" : "border-white/5 bg-zinc-800/80 text-zinc-500"}`}>
                  {key}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Hotkeys() {
  const toast = useToast();
  const [active, setActive] = useState(0);
  const hk = HOTKEYS[active];

  return (
    <section id="hotkeys" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <SectionHead no="03" title="手不离键盘" sub="全局热键一键呼出，所有快捷键都支持录制自定义。" />

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-4">
          <Keyboard active={active} />
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`flex size-6 items-center justify-center rounded-md text-xs font-bold ${hk.colorBg} ${hk.color}`}>{String(active + 1).padStart(2, "0")}</span>
                <span className="font-display font-semibold">{hk.action}</span>
              </div>
              <span className="font-mono text-xs text-zinc-500">{active + 1}/{HOTKEYS.length}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">{hk.desc}</p>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[10px] text-zinc-600">关联模块：</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${hk.colorBg} ${hk.color}`}>{hk.module}</span>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            默认统一呼出模式：仅 <kbd className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 font-display text-[10px]">Ctrl+Shift+E</kbd> 生效。关闭统一模式后各模块独立热键生效。均可在设置中录制修改。
          </p>
        </div>

        <div className="space-y-3">
          {HOTKEYS.map((h, i) => (
            <button key={h.action} type="button" onClick={() => { setActive(i); toast(h.toast, h.keys.join("+")); }}
              className={`group flex w-full items-start gap-4 rounded-xl border-2 p-4 text-left transition-all duration-200 ${i === active ? "border-emerald-500/30 bg-gradient-to-r from-emerald-500/5 to-transparent shadow-sm shadow-emerald-500/10" : "border-white/5 bg-gradient-to-r from-white/[0.01] to-transparent hover:border-white/10 hover:bg-white/[0.02]"}`}>
              <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold ${i === active ? `${h.colorBg} ${h.color}` : "bg-zinc-800 text-zinc-500"}`}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span className={`font-display font-semibold ${i === active ? "text-white" : "text-zinc-300"}`}>{h.action}</span>
                  <div className="flex gap-1">
                    {h.keys.map((k, j) => (
                      <span key={k} className="flex items-center gap-1">
                        {j > 0 && <span className="text-[10px] text-zinc-600">+</span>}
                        <kbd className={`inline-flex min-w-[36px] justify-center rounded border px-2 py-0.5 font-mono text-[11px] ${i === active ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-white/10 bg-zinc-800 text-zinc-400"}`}>{k}</kbd>
                      </span>
                    ))}
                  </div>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${h.colorBg} ${h.color}`}>{h.module}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{h.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
