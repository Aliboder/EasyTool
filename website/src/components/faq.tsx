import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

const REPO = "https://github.com/Aliboder/EasyTool";

const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer" className="font-medium text-emerald-600 underline underline-offset-2 dark:text-emerald-400">{text}</a>
);

const QA: { q: string; a: ReactNode }[] = [
  { q: "EasyTool 收费吗？", a: "不收费。MIT 许可证，个人和商业使用均无限制，没有内购、没有广告、没有账号体系。你付出的唯一代价是磁盘空间。" },
  { q: "我的数据会被上传吗？", a: "不会。所有历史与配置都存在本机 SQLite，API 密钥只进 Windows 凭据管理器。EasyTool 没有自建服务器，也不收集任何遥测数据。你甚至可以在断网环境下使用全部功能（额度查询除外）。" },
  { q: "为什么文件搜索需要单独安装 Everything？", a: "EasyTool 直接调用 Everything 的 NTFS 索引引擎，毫秒级返回全盘文件名，而不是自己重复造一个慢索引。Everything 同样免费开源（MIT），安装一次即可，体积不到 2MB。" },
  { q: "支持 macOS 或 Linux 吗？", a: "目前仅支持 Windows 10 / 11 x64。剪贴板监听（WM_CLIPBOARDUPDATE）、全局热键（RegisterHotKey）、表情直输（SendInput）都深度依赖 Win32 API，跨平台需要完全重写底层，暂无计划。" },
  { q: "如何参与贡献？", a: <>欢迎在 GitHub 提交 {link(`${REPO}/issues`, "Issue")} 反馈问题，或直接提 {link(`${REPO}/pulls`, "PR")}。想开发自己的功能模块，先读 {link(`${REPO}/blob/master/docs/module-guide.md`, "模块开发指南")}——一个 manifest.json 加一个 Rust 后端文件和一个 React 前端组件即可接入，壳 UI 自动识别。</> },
  { q: "换电脑怎么迁移数据？", a: "复制 %APPDATA%\\com.aliboder.easytool\\ 整个文件夹到新电脑的相同路径即可。剪贴板历史、配置、消费记录全部迁移。密钥需要重新设置（系统凭据管理器不支持导出）。" },
];

export function Faq() {
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const item = QA[active];

  return (
    <section className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <Reveal>
          <SectionHead no="10" title="常见问题" sub="点击左侧问题，右侧显示答案。" />
        </Reveal>

        {/* desktop: side-by-side */}
        <div className="mt-12 hidden gap-8 md:grid md:grid-cols-[340px_1fr]">
          {/* question list */}
          <div className="space-y-1">
            {QA.map((q, i) => (
              <button
                key={q.q}
                type="button"
                onClick={() => setActive(i)}
                className={`group flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm transition-all ${
                  i === active
                    ? "border-l-2 border-emerald-500 bg-emerald-500/5 font-medium text-emerald-700 dark:text-emerald-300"
                    : "border-l-2 border-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold ${
                  i === active
                    ? "bg-emerald-500 text-white"
                    : "bg-zinc-100 text-zinc-400 group-hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-500 dark:group-hover:bg-zinc-700"
                }`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {q.q}
              </button>
            ))}
          </div>

          {/* answer panel */}
          <div className="relative min-h-[260px] rounded-2xl border-2 border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className="font-mono text-xs uppercase tracking-wider text-emerald-500">
                  Q{String(active + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 font-display text-xl font-bold">{item.q}</h3>
                <div className="mt-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {item.a}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* mobile: accordion */}
        <div className="mt-10 space-y-2 md:hidden">
          {QA.map((q, i) => (
            <details key={q.q} className="group rounded-xl border border-zinc-200 bg-white transition-all open:border-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-900">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 font-mono text-[10px] font-semibold text-zinc-400 group-open:bg-emerald-500 group-open:text-white dark:bg-zinc-800 dark:group-open:bg-emerald-500/20 dark:group-open:text-emerald-400">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 text-sm font-medium">{q.q}</span>
                <span className="size-5 shrink-0 rounded-full border border-zinc-200 text-center leading-5 text-zinc-400 transition-all group-open:border-emerald-500/30 group-open:bg-emerald-500 group-open:text-white group-open:rotate-45 dark:border-zinc-700 dark:group-open:border-emerald-500/20 dark:group-open:bg-emerald-500/20 dark:group-open:text-emerald-400">+</span>
              </summary>
              <div className="px-4 pb-4 pl-13 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {q.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
