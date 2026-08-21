import { Download, Github } from "lucide-react";
import { MiniPopup } from "./mini-popup";

const REPO = "https://github.com/Aliboder/EasyTool";
const RELEASE = `${REPO}/releases/latest`;

export function Hero() {
  return (
    <section id="top" className="pt-16">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-16 sm:px-6 min-h-[calc(100dvh-4rem)] content-center lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            开源免费 · MIT · v0.4.4
          </p>

          <h1 className="mt-5 font-display text-5xl font-bold leading-[1.15] tracking-tight md:text-6xl">
            一个<span className="text-emerald-600 dark:text-emerald-400">热键</span>，
            唤出整套效率工具
          </h1>

          <p className="mt-5 max-w-[42ch] leading-relaxed text-zinc-600 dark:text-zinc-400">
            剪贴板历史、AI 额度监控、表情面板、文件秒搜——模块化工具箱，数据全部留在本地。
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={RELEASE}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-emerald-500 px-6 font-medium text-zinc-950 transition-transform hover:bg-emerald-400 active:scale-[0.98]"
            >
              <Download className="size-4" />
              下载 Windows 版
            </a>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-full border border-zinc-300 px-6 font-medium text-zinc-700 transition-colors hover:border-emerald-500/60 hover:text-emerald-600 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-emerald-400"
            >
              <Github className="size-4" />
              查看源码
            </a>
          </div>
        </div>

        <div className="flex justify-center lg:justify-end">
          <MiniPopup />
        </div>
      </div>
    </section>
  );
}
