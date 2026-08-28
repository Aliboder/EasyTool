import { Database, KeyRound, Keyboard } from "lucide-react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

const PILLARS = [
  {
    no: "01",
    icon: Database,
    title: "本地优先",
    color: "text-emerald-400",
    colorBg: "bg-emerald-500/15",
    body: "历史记录、配置、消费曲线全部存在本机 SQLite（WAL 模式）。断电不丢数据，断网不影响使用。卸载即清除，不留云尾巴。",
    highlights: ["SQLite WAL 模式", "断电不丢数据", "断网可用", "卸载即清除"],
    code: `%APPDATA%\\com.aliboder.easytool\\
├─ config.json     # 应用配置
├─ clipboard.db    # SQLite WAL
├─ images/         # 图片原文
└─ thumbs/         # 缩略图缓存`,
  },
  {
    no: "02",
    icon: KeyRound,
    title: "密钥不出系统钥匙串",
    color: "text-blue-400",
    colorBg: "bg-blue-500/15",
    body: "API 密钥只存 Windows 凭据管理器，每个账户独立槽位，互不串用。EasyTool 本身没有自建服务器——你查的是 DeepSeek 和 OpenCode 的余额，数据不过我们的手。",
    highlights: ["Windows 凭据管理器", "每账户独立槽位", "无自建服务器", "零明文存储"],
    code: `keyring::Entry::new(
  "com.aliboder.easytool",
  "deepseek",          // 每账户独立 key_ref
)?`,
  },
  {
    no: "03",
    icon: Keyboard,
    title: "热键驱动",
    color: "text-amber-400",
    colorBg: "bg-amber-500/15",
    body: "一个全局热键呼出主面板，置顶、点外部自动隐藏、可选跟随鼠标。剪贴板/表情收起时自动回到原窗口（隐藏窗口后注入），不打断工作流。",
    highlights: ["单一全局热键", "主面板置顶", "点外部即隐", "跟手粘贴"],
    code: `Ctrl+Shift+E  →  呼出主面板
（剪贴板 / 额度 / 表情 /
 搜索 / 时长统计
 在面板底部导航间切换）`,
  },
];

export function Pillars() {
  return (
    <section id="design" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead no="04" title="设计哲学" sub="EasyTool 不只是功能的堆砌——每个决策都有理由。" />
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {PILLARS.map((p, i) => (
          <Reveal key={p.no} delay={i * 0.08}>
            <div className="group flex h-full flex-col rounded-2xl border-2 border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-6 transition-all hover:border-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/5">
              {/* header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`flex size-10 items-center justify-center rounded-xl ${p.colorBg}`}>
                    <p.icon className={`size-5 ${p.color}`} />
                  </span>
                  <h3 className="font-display text-lg font-bold">{p.title}</h3>
                </div>
                <span className={`rounded-full px-2.5 py-1 font-display text-[10px] font-bold ${p.colorBg} ${p.color}`}>
                  {p.no}
                </span>
              </div>

              {/* body */}
              <p className="mt-4 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{p.body}</p>

              {/* highlights */}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {p.highlights.map((h) => (
                  <span key={h} className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-zinc-400">{h}</span>
                ))}
              </div>

              {/* code */}
              <div className="mt-auto pt-4">
                <pre className="overflow-x-auto rounded-xl border border-white/5 bg-black/50 p-4 font-mono text-[11px] leading-relaxed text-zinc-400">
                  {p.code}
                </pre>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
