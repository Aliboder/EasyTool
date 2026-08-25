import { Download, Github } from "lucide-react";
import { MiniPopup } from "./mini-popup";
import { RippleLink } from "./ripple-link";
import { MagneticLink } from "./magnetic-link";
import { MouseSpotlight } from "./mouse-spotlight";
import { ScrambleText } from "./scramble-text";
import { BlurReveal } from "./blur-reveal";

const REPO = "https://github.com/Aliboder/EasyTool";
const RELEASE = `${REPO}/releases/latest`;

export function Hero() {
  return (
    <section id="top" className="pt-16">
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <MouseSpotlight>
          <div className="relative overflow-hidden border-2 border-white/10 bg-[radial-gradient(var(--dot)_1px,transparent_1px)] bg-[length:14px_14px] shadow-[0_0_80px_-20px_rgba(16,185,129,0.15)]">
            {/* faint emerald sheen sweeping the poster */}
            <div aria-hidden className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(42rem_22rem_at_18%_-10%,rgba(16,185,129,0.14),transparent_55%)]" />
            {/* masthead */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 font-display text-[11px] uppercase tracking-[0.2em] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <span className="flex items-center gap-2.5">
                <span className="inline-block size-3 bg-emerald-500" />
                <ScrambleText text="EASYTOOL" delay={200} speed={40} />
              </span>
              <span>
                vol. <span className="font-bold text-emerald-600 dark:text-emerald-400">0.6.0</span>{" "}
                <span className="text-zinc-400 dark:text-zinc-600">· 2026.08</span>
              </span>
            </div>

            {/* poster grid */}
            <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
              {/* left: copy */}
              <div className="flex flex-col justify-center border-b border-zinc-200 px-6 py-12 sm:px-10 lg:border-b-0 lg:border-r lg:py-20 dark:border-zinc-800">
                <h1 className="font-display text-5xl font-bold leading-[1.08] tracking-tight md:text-6xl lg:text-[3.9rem]">
                  <BlurReveal as="span" className="block">一个</BlurReveal>
                  <BlurReveal as="span" delay={0.1} className="block">
                    <span className="inline-block bg-emerald-500 px-2 text-white">热键</span>，
                  </BlurReveal>
                  <BlurReveal as="span" delay={0.2} className="block whitespace-nowrap">唤出整套效率工具</BlurReveal>
                </h1>

                <BlurReveal delay={0.3}>
                  <p className="mt-6 max-w-[42ch] text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                    剪贴板历史、AI 额度监控、表情面板、文件秒搜、时长统计——模块化工具箱，数据全部留在本地。
                  </p>
                </BlurReveal>

                <BlurReveal delay={0.4}>
                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <MagneticLink
                      href={RELEASE}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-lift inline-flex h-11 items-center gap-2 bg-emerald-500 px-6 font-medium text-zinc-950"
                    >
                      <Download className="size-4" />
                      下载 Windows 版
                    </MagneticLink>
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
                </BlurReveal>
              </div>

              {/* right: live demo (floating) */}
              <div className="flex items-center justify-center p-6 sm:p-10">
                <div className="float-anim">
                  <MiniPopup />
                </div>
              </div>
            </div>
          </div>
        </MouseSpotlight>
      </div>
    </section>
  );
}
