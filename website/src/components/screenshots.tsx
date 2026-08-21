import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";
import { RealMainWindow } from "./real-main-window";
import { RealClipboardPopup } from "./real-clipboard-popup";

export function Screenshots() {
  return (
    <section id="screenshots" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead no="06" title="真实界面" sub="用代码还原的界面——所见即所得。" />
      </Reveal>

      <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <Reveal>
          <RealMainWindow />
        </Reveal>
        <Reveal delay={0.1}>
          <div className="flex justify-center">
            <RealClipboardPopup />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
