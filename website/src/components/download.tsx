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
  "托盘驻留，开机自启",
  "全局热键一键呼出",
  "剪贴板历史实时记录",
  "AI 额度多账户监控",
  "1900+ 表情直输",
  "Everything 文件秒搜",
  "快速启动一键直达",
];

export function Download() {
  return (
    <section id="download" className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <Reveal>
          <SectionHead no="09" title="现在就装一个" sub="免费开源，装完即用。" />
        </Reveal>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          {/* left: CTA */}
          <Reveal>
            <div className="flex flex-col items-start gap-6">
              <div className="flex flex-wrap gap-2">
                {CHIPS.map((c) => (
                  <span
                    key={c.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
                  >
                    <c.icon className="size-3.5 text-emerald-500" />
                    {c.label}
                  </span>
                ))}
              </div>

              <a
                href={RELEASE}
                target="_blank"
                rel="noreferrer"
                className="btn-lift inline-flex h-12 items-center gap-2 rounded-full bg-emerald-500 px-8 text-base font-medium text-zinc-950"
              >
                <DownloadIcon className="size-5" />
                下载 Windows 版
              </a>
              <p className="font-display text-xs text-zinc-400 dark:text-zinc-500">
                v0.4.5 · 2026-08-21 发布 · NSIS 安装包 · 约 8 MB
              </p>

              <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-100/60 p-4 text-left dark:border-zinc-800 dark:bg-zinc-900">
                <Info className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  「文件秒搜」模块需要单独安装{" "}
                  <a
                    href="https://www.voidtools.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-emerald-600 underline underline-offset-2 dark:text-emerald-400"
                  >
                    Everything
                  </a>{" "}
                  （免费开源，MIT 许可）。其余模块开箱即用。
                </p>
              </div>
            </div>
          </Reveal>

          {/* right: what you get */}
          <Reveal delay={0.08}>
            <div className="rounded-2xl border-2 border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2.5">
                <Zap className="size-4 text-emerald-500" />
                <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  安装后你会得到
                </h3>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {WHAT_YOU_GET.map((item) => (
                  <div key={item} className="flex items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <p className="text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                  安装包通过 GitHub Releases 分发，无第三方下载站。SHA256 校验和附在每个 Release 页面。
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
