import { Download, Github } from "lucide-react";
import { MiniPopup } from "./mini-popup";
import { RippleLink } from "./ripple-link";

const REPO = "https://github.com/Aliboder/EasyTool";
const RELEASE = `${REPO}/releases/latest`;

export function Hero() {
  return (
    <section id="top" className="pt-16">
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <div className="relative overflow-hidden border-2 border-zinc-900 bg-[radial-gradient(var(--dot)_1px,transparent_1px)] bg-[length:14px_14px] dark:border-zinc-100">
          {/* masthead */}
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 font-display text-[11px] uppercase tracking-[0.2em] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <span className="flex items-center gap-2.5">
              <span className="inline-block size-3 bg-emerald-500" />
              EASYTOOL
            </span>
            <span>
              vol. <span className="font-bold text-emerald-600 dark:text-emerald-400">0.4.4</span>{" "}
              <span className="text-zinc-400 dark:text-zinc-600">· 2026.08</span>
            </span>
          </div>

          {/* poster grid */}
          <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
            {/* left: copy */}
            <div className="flex flex-col justify-center border-b border-zinc-200 px-6 py-12 sm:px-10 lg:border-b-0 lg:border-r lg:py-20 dark:border-zinc-800">
              <h1 className="overflow-hidden font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
                <span className="press-in block">一个</span>
                <span className="press-in block">
                  <span className="inline-block bg-emerald-500 px-2 text-white">热键</span>，
                </span>
                <span className="press-in block">唤出整套效率工具</span>
              </h1>

              <p className="mt-6 max-w-[42ch] text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                剪贴板历史、AI 额度监控、表情面板、文件秒搜——模块化工具箱，数据全部留在本地。
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <RippleLink
                  href={RELEASE}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-lift inline-flex h-11 items-center gap-2 bg-emerald-500 px-6 font-medium text-zinc-950"
                >
                  <Download className="size-4" />
                  下载 Windows 版
                </RippleLink>
                <RippleLink
                  href={REPO}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-lift inline-flex h-11 items-center gap-2 border-2 border-zinc-900 px-6 font-medium dark:border-zinc-100"
                >
                  <Github className="size-4" />
                  查看源码
                </RippleLink>
              </div>
            </div>

            {/* right: live demo */}
            <div className="flex items-center justify-center p-6 sm:p-10">
              <MiniPopup />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
