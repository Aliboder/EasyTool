import { ArrowRight } from "lucide-react";
import { Reveal } from "./reveal";

const RELEASES = "https://github.com/Aliboder/EasyTool/releases";

// 摘要取自各版本 git 提交记录
const LOG = [
  {
    version: "v0.4.4",
    date: "2026-08-20",
    summary: "表情支持 SendInput 直输与收藏置顶；剪贴板自写守卫加固，链路覆盖更完整。",
  },
  {
    version: "v0.4.3",
    date: "",
    summary: "修复拖动标题栏窗口消失、启动闪默认尺寸等窗口体验问题。",
  },
  {
    version: "v0.4.2",
    date: "",
    summary: "表情模块切回不再卡顿；剪贴板新增内容指纹比对，防止误记。",
  },
  {
    version: "v0.4.1",
    date: "",
    summary: "全量代码审查修复：锁外网络请求、热键解析缓存、图片编码优化等。",
  },
];

export function Changelog() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
              持续更新
            </h2>
            <p className="mt-3 text-zinc-600 dark:text-zinc-400">
              小步快跑，每个版本都解决真实问题。
            </p>
          </div>
          <a
            href={RELEASES}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
          >
            完整更新日志
            <ArrowRight className="size-4" />
          </a>
        </div>
      </Reveal>

      <div className="mt-10 space-y-0 border-l border-zinc-200 pl-6 dark:border-zinc-800">
        {LOG.map((item, i) => (
          <Reveal key={item.version} delay={i * 0.06}>
            <div className="relative pb-8 last:pb-0">
              <span className="absolute -left-[31px] top-1.5 size-2.5 rounded-full border-2 border-emerald-500 bg-zinc-50 dark:bg-zinc-950" />
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-display font-semibold">{item.version}</span>
                {item.date && (
                  <span className="font-display text-xs text-zinc-400 dark:text-zinc-500">
                    {item.date}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {item.summary}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
