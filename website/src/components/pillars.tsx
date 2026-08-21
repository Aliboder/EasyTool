import { Reveal } from "./reveal";

const PILLARS = [
  {
    no: "01",
    title: "本地优先",
    body: "数据存在本机 SQLite，密钥进 Windows 凭据管理器，不依赖任何第三方服务器。",
  },
  {
    no: "02",
    title: "模块化架构",
    body: "每个功能是独立模块：可启停、可排序；扩展新模块不需要动其他代码。",
  },
  {
    no: "03",
    title: "热键驱动",
    body: "全局热键一键呼出，弹窗跟随鼠标、失焦即隐，手不离键盘。",
  },
];

export function Pillars() {
  return (
    <section id="why" className="border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <Reveal>
          <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            为什么是 EasyTool
          </h2>
        </Reveal>

        <div className="mt-10 divide-y divide-zinc-200 dark:divide-zinc-800">
          {PILLARS.map((p, i) => (
            <Reveal key={p.no} delay={i * 0.08}>
              <div className="grid gap-3 py-8 md:grid-cols-[120px_240px_1fr] md:items-baseline md:gap-8">
                <span className="font-display text-4xl font-bold text-emerald-500/60 tabular-nums">
                  {p.no}
                </span>
                <h3 className="font-display text-xl font-semibold">{p.title}</h3>
                <p className="max-w-[52ch] leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {p.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
