import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

export function Screenshots() {
  return (
    <section id="screenshots" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead no="07" title="真实界面" sub="主窗口与剪贴板弹窗，一睹为快。" />
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Reveal>
          <div className="group overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 transition-all hover:border-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/5">
            <img
              src="/screenshots/main.png"
              alt="EasyTool 主窗口"
              className="w-full transition-transform duration-500 group-hover:scale-[1.02]"
              loading="lazy"
            />
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="group overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 transition-all hover:border-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/5">
            <img
              src="/screenshots/popup.png"
              alt="EasyTool 剪贴板弹窗"
              className="w-full transition-transform duration-500 group-hover:scale-[1.02]"
              loading="lazy"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
