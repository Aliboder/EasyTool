import { Download as DownloadIcon, Info, Monitor, Scale, ShieldCheck, Zap } from "lucide-react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

const RELEASE = "https://github.com/Aliboder/EasyTool/releases/latest";

const CHIPS = [
  { icon: Monitor, label: "Windows 10 / 11 x64" },
  { icon: ShieldCheck, label: "安装免管理员权限" },
  { icon: Scale, label: "MIT 免费开源" },
];

const WHAT_YOU_GET = [
  { icon: "🖥️", text: "托盘驻留，开机自启" },
  { icon: "⌨️", text: "全局热键一键呼出" },
  { icon: "📋", text: "剪贴板历史实时记录" },
  { icon: "📊", text: "AI 额度多账户监控" },
  { icon: "😀", text: "1900+ 表情直输" },
  { icon: "🔍", text: "Everything 文件秒搜" },
  { icon: "🚀", text: "快速启动一键直达" },
];

export function Download() {
  return (
    <section id="download" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead no="09" title="现在就装一个" sub="免费开源，装完即用。" />
      </Reveal>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        {/* left: CTA */}
        <Reveal>
          <div className="flex flex-col items-start gap-6">
            <div className="flex flex-wrap gap-2">
              {CHIPS.map((c) => (
                <span key={c.label} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-xs text-zinc-400">
                  <c.icon className="size-3.5 text-emerald-400" />
                  {c.label}
                </span>
              ))}
            </div>

            <a href={RELEASE} target="_blank" rel="noreferrer"
              className="btn-lift inline-flex h-12 items-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 px-8 text-base font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition-all hover:shadow-emerald-500/30">
              <DownloadIcon className="size-5" />
              下载 Windows 版
            </a>
            <p className="font-display text-xs text-zinc-500">v0.4.5 · 2026-08-21 发布 · NSIS 安装包 · 约 8 MB</p>

            <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <p className="text-sm leading-relaxed text-zinc-400">
                「文件秒搜」模块需要单独安装 <a href="https://www.voidtools.com/" target="_blank" rel="noreferrer" className="font-medium text-emerald-400 underline underline-offset-2">Everything</a>（免费开源，MIT 许可）。其余模块开箱即用。
              </p>
            </div>
          </div>
        </Reveal>

        {/* right: what you get */}
        <Reveal delay={0.08}>
          <div className="rounded-2xl border-2 border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-6">
            <div className="flex items-center gap-2.5">
              <Zap className="size-4 text-emerald-400" />
              <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-400">安装后你会得到</h3>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {WHAT_YOU_GET.map((item) => (
                <div key={item.text} className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-sm text-zinc-300 transition-colors hover:border-emerald-500/20">
                  <span className="text-base">{item.icon}</span>
                  {item.text}
                </div>
              ))}
            </div>
            <div className="mt-5 border-t border-white/5 pt-4">
              <p className="text-xs text-zinc-500">安装包通过 GitHub Releases 分发，无第三方下载站。SHA256 校验和附在每个 Release 页面。</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
