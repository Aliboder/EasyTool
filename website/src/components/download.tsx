import { Download as DownloadIcon, Info, Monitor, Scale, ShieldCheck } from "lucide-react";
import { Reveal } from "./reveal";

const RELEASE = "https://github.com/Aliboder/EasyTool/releases/latest";

const CHIPS = [
  { icon: Monitor, label: "Windows 10 / 11 x64" },
  { icon: ShieldCheck, label: "安装免管理员权限" },
  { icon: Scale, label: "MIT 免费开源" },
];

export function Download() {
  return (
    <section id="download" className="mx-auto max-w-6xl px-4 py-24 text-center sm:px-6">
      <Reveal>
        <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
          现在就装一个
        </h2>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">免费开源，装完即用。</p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
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

        <div className="mt-8">
          <a
            href={RELEASE}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-emerald-500 px-8 text-base font-medium text-zinc-950 transition-transform hover:bg-emerald-400 active:scale-[0.98]"
          >
            <DownloadIcon className="size-5" />
            下载 Windows 版
          </a>
          <p className="mt-3 font-display text-xs text-zinc-400 dark:text-zinc-500">
            v0.4.4 · 2026-08-20 发布
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.12}>
        <div className="mx-auto mt-10 flex max-w-xl items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-100/60 p-4 text-left dark:border-zinc-800 dark:bg-zinc-900">
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
      </Reveal>
    </section>
  );
}
