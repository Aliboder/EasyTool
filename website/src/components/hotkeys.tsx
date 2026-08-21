import { useState } from "react";
import { useToast } from "./toast";
import { SectionHead } from "./section-head";

type Hotkey = {
  action: string;
  keys: string[];
  desc: string;
  toast: string;
};

const HOTKEYS: Hotkey[] = [
  { action: "主面板", keys: ["Ctrl", "Shift", "E"], desc: "统一呼出模式下打开主窗口，集成全部模块。关闭统一模式后，此热键可自定义。", toast: "主面板已打开" },
  { action: "剪贴板", keys: ["Ctrl", "Shift", "V"], desc: "直接呼出剪贴板弹窗，跟随鼠标。搜索、固定、复制一步到位。", toast: "剪贴板弹窗" },
  { action: "表情面板", keys: ["Ctrl", "Shift", "J"], desc: "弹出表情选择器，分类浏览 + 收藏夹，选中即直输到当前输入框。", toast: "表情面板已呼出" },
  { action: "文件搜索", keys: ["Ctrl", "Shift", "F"], desc: "调用 Everything 引擎秒搜全盘文件名，结果支持复制路径/直接打开。", toast: "文件搜索已就绪" },
];

function Keyboard({ active }: { active: number }) {
  const rows = [
    ["Esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"],
    ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "Del"],
    ["Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\"],
    ["Caps", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter"],
    ["Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Shift"],
    ["Ctrl", "Fn", "Win", "Alt", "Space", "Alt", "Win", "Menu", "Ctrl"],
  ];

  const highlighted = new Set<string>();
  if (active >= 0 && active < HOTKEYS.length) {
    HOTKEYS[active].keys.forEach((k) => highlighted.add(k.toLowerCase()));
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/5 bg-zinc-900 p-4">
      <div className="space-y-1">
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-1">
            {row.map((key) => {
              const k = key.toLowerCase();
              const isHL = highlighted.has(k);
              const w = key === "Space" ? "w-[180px]" : key.length > 3 ? "min-w-[48px]" : key === "Shift" || key === "Ctrl" || key === "Alt" || key === "Enter" || key === "Tab" || key === "Caps" ? "min-w-[52px]" : "min-w-[32px]";
              return (
                <span
                  key={`${ri}-${key}`}
                  className={`flex h-8 items-center justify-center rounded-md border px-1.5 font-mono text-[10px] transition-all duration-200 ${w} ${
                    isHL
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-400 shadow-sm shadow-emerald-500/20"
                      : "border-white/5 bg-zinc-800 text-zinc-500"
                  }`}
                >
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

  return (
    <section id="hotkeys" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <SectionHead no="03" title="手不离键盘" sub="全局热键一键呼出，所有快捷键都支持录制自定义。" />

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1.4fr]">
        {/* left: keyboard visualization */}
        <div>
          <Keyboard active={active} />
          <p className="mt-4 text-xs text-zinc-500">
            默认统一呼出模式：仅{" "}
            <kbd className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 font-display text-[10px]">Ctrl+Shift+E</kbd>{" "}
            生效。关闭统一模式后，剪贴板/表情/搜索各有独立热键。均可在设置中录制修改。
          </p>
        </div>

        {/* right: hotkey cards */}
        <div className="space-y-3">
          {HOTKEYS.map((h, i) => (
            <button
              key={h.action}
              type="button"
              onClick={() => { setActive(i); toast(h.toast, h.keys.join("+")); }}
              className={`group flex w-full items-start gap-4 rounded-xl border-2 p-4 text-left transition-all duration-200 ${
                i === active
                  ? "border-emerald-500/30 bg-emerald-500/5 shadow-sm shadow-emerald-500/10"
                  : "border-white/5 hover:border-white/10 hover:bg-white/[0.02]"
              }`}
            >
              <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold ${
                i === active ? "bg-emerald-500 text-white" : "bg-zinc-800 text-zinc-500"
              }`}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span className={`font-display font-semibold ${i === active ? "text-white" : "text-zinc-300"}`}>{h.action}</span>
                  <div className="flex gap-1">
                    {h.keys.map((k, j) => (
                      <span key={k} className="flex items-center gap-1">
                        {j > 0 && <span className="text-[10px] text-zinc-600">+</span>}
                        <kbd className={`inline-flex min-w-[36px] justify-center rounded border px-2 py-0.5 font-mono text-[11px] ${
                          i === active
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border-white/10 bg-zinc-800 text-zinc-400"
                        }`}>{k}</kbd>
                      </span>
                    ))}
                  </div>
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
