import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

const REPO = "https://github.com/Aliboder/EasyTool";

const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer" className="font-medium text-emerald-600 underline underline-offset-2 dark:text-emerald-400">{text}</a>
);

const QA: { q: string; tag: string; tagColor: string; tagBg: string; a: ReactNode }[] = [
  { q: "EasyTool 收费吗？", tag: "免费", tagColor: "text-emerald-400", tagBg: "bg-emerald-500/15", a: "不收费。MIT 许可证，个人和商业使用均无限制，没有内购、没有广告、没有账号体系。你付出的唯一代价是磁盘空间。" },
  { q: "我的数据会被上传吗？", tag: "隐私", tagColor: "text-blue-400", tagBg: "bg-blue-500/15", a: "不会。所有历史与配置都存在本机 SQLite，API 密钥只进 Windows 凭据管理器。EasyTool 没有自建服务器，也不收集任何遥测数据。你甚至可以在断网环境下使用全部功能（额度查询除外）。" },
  { q: "为什么需要单独安装 Everything？", tag: "依赖", tagColor: "text-amber-400", tagBg: "bg-amber-500/15", a: "EasyTool 直接调用 Everything 的 NTFS 索引引擎，毫秒级返回全盘文件名，而不是自己重复造一个慢索引。Everything 同样免费开源（MIT），安装一次即可，体积不到 2MB。" },
  { q: "支持 macOS 或 Linux 吗？", tag: "平台", tagColor: "text-cyan-400", tagBg: "bg-cyan-500/15", a: "目前仅支持 Windows 10 / 11 x64。剪贴板监听（WM_CLIPBOARDUPDATE）、全局热键（RegisterHotKey）、表情直输（SendInput）都深度依赖 Win32 API，跨平台需要完全重写底层，暂无计划。" },
  { q: "如何参与贡献？", tag: "开源", tagColor: "text-violet-400", tagBg: "bg-violet-500/15", a: <>欢迎在 GitHub 提交 {link(`${REPO}/issues`, "Issue")} 反馈问题，或直接提 {link(`${REPO}/pulls`, "PR")}。想开发自己的功能模块，先读 {link(`${REPO}/blob/master/docs/module-guide.md`, "模块开发指南")}——一个 manifest.json 加一个 Rust 后端文件和一个 React 前端组件即可接入，壳 UI 自动识别。</> },
  { q: "换电脑怎么迁移？", tag: "迁移", tagColor: "text-rose-400", tagBg: "bg-rose-500/15", a: "复制 %APPDATA%\\com.aliboder.easytool\\ 整个文件夹到新电脑的相同路径即可。剪贴板历史、配置、消费记录全部迁移。密钥需要重新设置（系统凭据管理器不支持导出）。" },
];

export function Faq() {
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const item = QA[active];

  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead no="08" title="常见问题" />
      </Reveal>

      <div className="mt-12 hidden gap-6 lg:grid lg:grid-cols-[300px_1fr]">
        {/* question list */}
        <div className="space-y-2">
          {QA.map((q, i) => (
            <button
              key={q.q}
              type="button"
              onClick={() => setActive(i)}
              className={`group relative flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm transition-all duration-200 ${
                i === active
                  ? "bg-emerald-500/8 text-emerald-500 shadow-sm shadow-emerald-500/10 dark:text-emerald-300"
                  : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300"
              }`}
            >
              <div className={`absolute left-0 top-1/2 -translate-y-1/2 h-8 w-[3px] rounded-full bg-emerald-500 transition-all duration-200 ${i === active ? "opacity-100" : "opacity-0"}`} />
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold transition-all duration-200 ${
                i === active ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-zinc-500"
              }`}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1">{q.q}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] transition-all ${i === active ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-zinc-500"}`}>
                {q.tag}
              </span>
            </button>
          ))}
        </div>

        {/* answer panel */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent">
          <span className="pointer-events-none absolute -right-4 -top-6 font-display text-[180px] font-bold leading-none text-zinc-100/80 select-none dark:text-zinc-800/50">
            {String(active + 1).padStart(2, "0")}
          </span>

          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={reduce ? false : { opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 p-8 lg:p-10"
            >
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-emerald-500 px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-wider text-white">
                  Q{String(active + 1).padStart(2, "0")}
                </span>
                <span className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${item.tagBg} ${item.tagColor}`}>
                  {item.tag}
                </span>
              </div>
              <h3 className="mt-5 font-display text-2xl font-bold tracking-tight lg:text-3xl">{item.q}</h3>
              <div className="mt-5 max-w-[56ch] text-[15px] leading-relaxed text-zinc-400">{item.a}</div>
              <div className="mt-8 flex items-center gap-4 text-xs text-zinc-500">
                <span className="flex items-center gap-1.5"><kbd className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px]">↑</kbd><kbd className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px]">↓</kbd>导航</span>
                <span className="flex items-center gap-1.5"><kbd className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>选择</span>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* mobile: accordion */}
      <div className="mt-10 space-y-2 lg:hidden">
        {QA.map((q, i) => (
          <details key={q.q} className="group rounded-xl border border-white/10 transition-all open:border-emerald-500/20">
            <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
              <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold ${i === active ? "bg-emerald-500 text-white" : "bg-white/5 text-zinc-500"}`}>{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1 text-sm font-medium">{q.q}</span>
              <span className={`rounded-full px-2 py-0.5 text-[9px] ${q.tagBg} ${q.tagColor}`}>{q.tag}</span>
            </summary>
            <div className="px-4 pb-4 pl-14 text-sm leading-relaxed text-zinc-400">{q.a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}
