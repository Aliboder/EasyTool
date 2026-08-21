import { AppWindow, ClipboardList, Gauge, Search, Smile } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";
import { MiniClipboard } from "./minis/clipboard";
import { MiniQuota } from "./minis/quota";
import { MiniEmoji } from "./minis/emoji";
import { MiniSearch } from "./minis/search";
import { MiniQuicklaunch } from "./minis/quicklaunch";

function Card({
  icon: Icon,
  title,
  desc,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMouseMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
  };

  return (
    <Reveal className={className}>
      <div
        ref={ref}
        onMouseMove={onMouseMove}
        className="bento-card flex h-full flex-col rounded-2xl border-2 border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="relative z-10 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
            <Icon className="size-4.5" />
          </span>
          <h3 className="font-display text-lg font-semibold">{title}</h3>
        </div>
        <p className="relative z-10 mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          {desc}
        </p>
        <div className="relative z-10 mt-5 flex-1">{children}</div>
      </div>
    </Reveal>
  );
}

export function Bento() {
  return (
    <section id="modules" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead
          no="01"
          title="五个模块，各司其职"
          sub="下面的演示都是真实交互，不是截图——动手试试。"
        />
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-6">
        <Card
          icon={ClipboardList}
          title="剪贴板历史"
          desc="文本、图片、文件统统记住。悬停任意条目，试试固定和复制。"
          className="md:col-span-3 md:row-span-2"
        >
          <MiniClipboard />
        </Card>

        <Card
          icon={Gauge}
          title="额度监控"
          desc="多账户余额与消费曲线，低于阈值自动告警。切换账户看看。"
          className="md:col-span-3"
        >
          <MiniQuota />
        </Card>

        <Card
          icon={Smile}
          title="表情面板"
          desc="点一下，试试手感。"
          className="md:col-span-3"
        >
          <MiniEmoji />
        </Card>

        <Card
          icon={AppWindow}
          title="快速启动"
          desc="应用、文件、文件夹、网址，拖拽排序一键直达。"
          className="md:col-span-3"
        >
          <MiniQuicklaunch />
        </Card>

        <Card
          icon={Search}
          title="文件秒搜"
          desc="Everything 全文引擎，输入即出结果（需安装 Everything）。"
          className="md:col-span-6"
        >
          <MiniSearch />
        </Card>
      </div>
    </section>
  );
}
