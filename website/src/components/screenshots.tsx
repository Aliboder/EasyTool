import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";
import { RealMainWindow } from "./real-main-window";
import { RealClipboardPopup } from "./real-clipboard-popup";
import { RealEmojiPopup } from "./real-emoji-popup";
import { RealQuotaSettings } from "./real-quota-settings";
import { RealAppShell } from "./real-app-shell";
import { RealQuicklaunch } from "./real-quicklaunch";

const UI_ITEMS = [
  { label: "主窗口 · 文件搜索", color: "text-emerald-400" },
  { label: "剪贴板弹窗", color: "text-blue-400" },
  { label: "快速启动面板", color: "text-violet-400" },
  { label: "表情面板", color: "text-amber-400" },
  { label: "额度设置", color: "text-cyan-400" },
  { label: "App 外壳 · 底部导航", color: "text-zinc-400" },
];

export function Screenshots() {
  return (
    <section id="screenshots" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead no="06" title="真实界面" sub="全部用代码还原——所见即所得。" />
      </Reveal>

      {/* legend */}
      <Reveal delay={0.05}>
        <div className="mt-6 flex flex-wrap gap-3">
          {UI_ITEMS.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-xs text-zinc-400">
              <span className={`size-1.5 rounded-full ${item.color.replace("text-", "bg-")}`} />
              {item.label}
            </span>
          ))}
        </div>
      </Reveal>

      {/* row 1: main window + clipboard popup */}
      <div className="mt-8 grid grid-cols-1 items-center gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Reveal>
          <RealMainWindow />
        </Reveal>
        <Reveal delay={0.08}>
          <div className="flex justify-center">
            <RealClipboardPopup />
          </div>
        </Reveal>
      </div>

      {/* row 2: quicklaunch + emoji + quota settings */}
      <div className="mt-6 grid grid-cols-1 items-start gap-6 md:grid-cols-3">
        <Reveal delay={0.1}>
          <RealQuicklaunch />
        </Reveal>
        <Reveal delay={0.15}>
          <div className="flex justify-center">
            <RealEmojiPopup />
          </div>
        </Reveal>
        <Reveal delay={0.2}>
          <RealQuotaSettings />
        </Reveal>
      </div>

      {/* row 3: app shell */}
      <div className="mt-6 flex justify-center">
        <Reveal delay={0.25}>
          <RealAppShell />
        </Reveal>
      </div>
    </section>
  );
}
