import { Database, KeyRound, Keyboard } from "lucide-react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

const PILLARS = [
  {
    no: "01",
    icon: Database,
    title: "本地优先",
    body: "历史记录、配置、消费曲线全部存在本机 SQLite（WAL 模式）。断电不丢数据，断网不影响使用。卸载即清除，不留云尾巴。",
    code: `%APPDATA%\\com.aliboder.easytool\\
├─ config.json     # 应用配置
├─ clipboard.db    # SQLite WAL
└─ images/         # 图片原文`,
  },
  {
    no: "02",
    icon: KeyRound,
    title: "密钥不出系统钥匙串",
    body: "API 密钥只存 Windows 凭据管理器，每个账户独立槽位，互不串用。EasyTool 本身没有自建服务器——你查的是 DeepSeek 和 OpenCode 的余额，数据不过我们的手。",
    code: `keyring::Entry::new(
  "com.aliboder.easytool",
  "deepseek",          // 每账户独立 key_ref
)?`,
  },
  {
    no: "03",
    icon: Keyboard,
    title: "热键驱动",
    body: "全局热键一键呼出，弹窗跟随鼠标、失焦即隐。默认 Ctrl+Shift+E 统一呼出主面板；关闭统一模式后，剪贴板/表情/搜索各有独立热键。所有快捷键均可录制自定义。",
    code: `Ctrl+Shift+E  →  主面板
Ctrl+Shift+V  →  剪贴板
Ctrl+Shift+J  →  表情
Ctrl+Shift+F  →  文件搜索`,
  },
];

export function Pillars() {
  return (
    <section id="why" className="border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <Reveal>
          <SectionHead no="05" title="设计哲学" sub="EasyTool 不只是功能的堆砌——每个决策都有理由。" />
        </Reveal>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.no} delay={i * 0.08}>
              <div className="group h-full rounded-2xl border-2 border-zinc-200 bg-zinc-50 p-6 transition-all hover:border-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/5 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500/20">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <p.icon className="size-5" />
                  </span>
                  <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">{p.no}</span>
                </div>

                <h3 className="mt-4 font-display text-lg font-bold">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{p.body}</p>

                <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-900 p-4 font-mono text-[11px] leading-relaxed text-zinc-300 dark:bg-black dark:text-zinc-400">
                  {p.code}
                </pre>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
