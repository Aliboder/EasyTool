import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";
import { RealMainWindow } from "./real-main-window";
import { RealClipboardPopup } from "./real-clipboard-popup";
import { RealEmojiPopup } from "./real-emoji-popup";
import { RealQuotaSettings } from "./real-quota-settings";
import { RealAppShell } from "./real-app-shell";

export function Screenshots() {
  return (
    <section id="screenshots" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead no="06" title="真实界面" sub="全部用代码还原——所见即所得。" />
      </Reveal>

      {/* row 1: main window + clipboard popup */}
      <div className="mt-10 grid grid-cols-1 items-center gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Reveal>
          <RealMainWindow />
        </Reveal>
        <Reveal delay={0.08}>
          <div className="flex justify-center">
            <RealClipboardPopup />
          </div>
        </Reveal>
      </div>

      {/* row 2: app shell + emoji + quota settings */}
      <div className="mt-6 grid grid-cols-1 items-start gap-6 md:grid-cols-3">
        <Reveal delay={0.1}>
          <RealAppShell />
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
    </section>
  );
}
