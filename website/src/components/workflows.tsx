import { motion, useReducedMotion } from "motion/react";
import {
  AppWindow,
  ArrowRight,
  Check,
  ClipboardList,
  Clock,
  Gauge,
  MousePointerClick,
  Search,
  Smile,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

type FlowStep = { icon: LucideIcon; label: string };

type Scenario = {
  name: string;
  tag: string;
  desc: string;
  flow: FlowStep[];
  highlight: string;
  accent: string;
};

const SCENARIOS: Scenario[] = [
  {
    name: "写论文",
    tag: "学习办公",
    desc: "复制引文进历史，旧资料搜索秒回，引用粘贴全程不切窗口，写作时间自动沉淀。",
    flow: [
      { icon: ClipboardList, label: "剪贴板历史" },
      { icon: Search, label: "文件秒搜" },
      { icon: MousePointerClick, label: "跟手粘贴" },
      { icon: Clock, label: "时长统计" },
    ],
    highlight: "使用过的条目自动置顶，下次呼出就在最上面",
    accent: "text-emerald-400",
  },
  {
    name: "编程调试",
    tag: "开发",
    desc: "报错信息复制进历史，DeepSeek 余额跌破预警，应用中心一键启动 IDE。",
    flow: [
      { icon: ClipboardList, label: "剪贴板历史" },
      { icon: Gauge, label: "额度监控" },
      { icon: AppWindow, label: "应用中心" },
    ],
    highlight: "「粘贴为纯文本」让代码粘贴不再带格式",
    accent: "text-cyan-400",
  },
  {
    name: "日常沟通",
    tag: "即时交流",
    desc: "表情直输聊天框，图片文件复制即存，附件定位秒级完成。",
    flow: [
      { icon: Smile, label: "表情直输" },
      { icon: ClipboardList, label: "剪贴板图片" },
      { icon: Search, label: "文件秒搜" },
    ],
    highlight: "1900+ 表情 + 自定义图片，聊天常客都停在「最近」",
    accent: "text-amber-400",
  },
];

export function Workflows() {
  const reduce = useReducedMotion();

  return (
    <section id="workflows" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead
          eyebrow="场景工作流"
          title="一套工具箱，串起一整天"
          sub="每个场景都用得到几个模块的组合，全部收在一个主面板里，呼出即用。"
        />
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {SCENARIOS.map((s, i) => (
          <Reveal key={s.name} delay={i * 0.08}>
            <article className="group flex h-full flex-col rounded-2xl border-2 border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-6 transition-all hover:border-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/5">
              {/* header */}
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold">{s.name}</h3>
                <span className={`rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] ${s.accent}`}>
                  {s.tag}
                </span>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{s.desc}</p>

              {/* 流程管线：模块 → 模块 → 模块 */}
              <div className="mt-5 flex flex-wrap items-center gap-1.5">
                {s.flow.map((step, j) => (
                  <span key={step.label} className="flex items-center gap-1.5">
                    {j > 0 && <ArrowRight className="size-3 shrink-0 text-zinc-600" />}
                    <motion.span
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: "-40px" }}
                      transition={{ duration: 0.3, delay: i * 0.06 + j * 0.05 }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:border-emerald-500/30"
                    >
                      <step.icon className={`size-3.5 ${s.accent}`} />
                      {step.label}
                    </motion.span>
                  </span>
                ))}
              </div>

              {/* 亮点 */}
              <div className="mt-auto flex items-start gap-2 border-t border-white/5 pb-1 pl-1 pt-4">
                <Check className={`mt-0.5 size-3.5 shrink-0 ${s.accent}`} />
                <span className="text-xs leading-relaxed text-zinc-400">{s.highlight}</span>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}