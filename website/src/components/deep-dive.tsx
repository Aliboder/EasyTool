import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Clock, ClipboardList, Gauge, Search, Smile } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

type ModuleInfo = {
  id: string;
  name: string;
  icon: LucideIcon;
  tagline: string;
  desc: string;
  features: { icon: string; text: string }[];
  meta: string[];
};

const MODULES: ModuleInfo[] = [
  {
    id: "clipboard", name: "剪贴板历史", icon: ClipboardList,
    tagline: "复制过的一切，随时找回",
    desc: "监听系统剪贴板，自动记录每一次复制。文本、图片、文件分类存储，固定常用项不丢失。",
    features: [
      { icon: "📋", text: "默认保留 500 条，文本 / 图片 / 文件分类记录" },
      { icon: "🖼️", text: "图片自动生成 256px 缩略图，悬停预览大图" },
      { icon: "📌", text: "固定常用条目，拖拽调整顺序，置顶永不挤掉" },
      { icon: "🔍", text: "内容指纹去重，自身写入不误记" },
      { icon: "🎯", text: "弹窗跟随鼠标，失焦自动隐藏，选中即粘贴" },
    ],
    meta: ["Ctrl+Shift+V", "跟随鼠标", "SQLite", "WM_CLIPBOARDUPDATE"],
  },
  {
    id: "quota", name: "额度监控", icon: Gauge,
    tagline: "AI 花销，心里有数",
    desc: "实时监控多个 AI 服务账户余额与消费趋势，阈值告警不遗漏。",
    features: [
      { icon: "👥", text: "DeepSeek / OpenCode Go 多账户，独立密钥与余额" },
      { icon: "⏱️", text: "轮询间隔自由调节（默认 30 秒，最低 5 秒）" },
      { icon: "⚠️", text: "预警 + 告警双阈值，余额吃紧提前知道" },
      { icon: "📊", text: "每账户独立保存 5000 条消费历史" },
      { icon: "🔔", text: "消费突增自动提醒，异常用量不放过" },
    ],
    meta: ["后台轮询", "多账户", "凭据管理器", "reqwest"],
  },
  {
    id: "emoji", name: "表情面板", icon: Smile,
    tagline: "1900+ 表情，一按即出",
    desc: "分类浏览、收藏置顶、多语言搜索。文本表情直输不污染剪贴板。",
    features: [
      { icon: "⭐", text: "分类浏览 + 收藏置顶，常用表情一步直达" },
      { icon: "🔎", text: "中文名 / 英文名 / shortcode 三种方式搜索" },
      { icon: "⌨️", text: "文本表情经 SendInput 直输，不污染剪贴板" },
      { icon: "🎨", text: "系统字体优先渲染，缺失时 Twemoji 兜底" },
      { icon: "✨", text: "图片表情自动写入并粘贴，全流程无感" },
    ],
    meta: ["Ctrl+Shift+J", "跟随鼠标", "SendInput", "Twemoji"],
  },
  {
    id: "search", name: "文件秒搜", icon: Search,
    tagline: "全盘文件，输入即达",
    desc: "调用 Everything NTFS 索引引擎，毫秒级返回全盘文件名结果；内置已安装应用中心。",
    features: [
      { icon: "⚡", text: "基于 Everything 引擎，文件名毫秒级返回" },
      { icon: "🖥️", text: "「应用」Tab = 已安装应用中心，点击即启动" },
      { icon: "🔧", text: "正则、大小写、全字匹配、路径匹配随意组合" },
      { icon: "📐", text: "结果列与排序自定义，列表 / 网格双视图" },
      { icon: "🔗", text: "复制路径自动进入剪贴板历史，跨模块联动" },
    ],
    meta: ["Ctrl+Shift+F", "Everything", "跟随鼠标", "DLL"],
  },
  {
    id: "timetracker", name: "时长统计", icon: Clock,
    tagline: "时间花在哪，一目了然",
    desc: "自动记录前台软件使用时长，多维度排行 + 甘特时间线 + 应用分类，隐私本地存储。",
    features: [
      { icon: "⏱️", text: "今日 / 本周 / 本月总览，昨日对比一目了然" },
      { icon: "📊", text: "应用排行：总时长 + 活跃时长双维度排序" },
      { icon: "📈", text: "每日甘特时间线，翻看任意一天的分布" },
      { icon: "🏷️", text: "自动分类（效率/资源/视听/学习/游戏），可自定义规则" },
      { icon: "😴", text: "离开检测：无键鼠输入自动剔除 AFK 时间" },
    ],
    meta: ["Ctrl+Shift+T", "跟随鼠标", "SQLite", "Win32 钩子"],
  },
];

const MOD_COLORS = ["text-emerald-400", "text-blue-400", "text-amber-400", "text-cyan-400", "text-violet-400"];

export function DeepDive() {
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const mod = MODULES[active];

  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead no="02" title="每个模块，都有真功夫" sub="特性清单直接来自源码——没有营销话术。" />
      </Reveal>

      <Reveal delay={0.08}>
        <div className="mt-10 grid gap-4 md:grid-cols-[240px_1fr] md:gap-8">
          {/* tab list */}
          <div role="tablist" aria-label="模块列表" className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
            {MODULES.map((m, i) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`group relative flex shrink-0 items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm transition-all duration-200 ${
                  i === active
                    ? "bg-emerald-500/10 font-medium text-emerald-500 dark:text-emerald-400"
                    : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300"
                }`}
              >
                <div className={`absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-full bg-emerald-500 transition-all duration-200 ${i === active ? "opacity-100" : "opacity-0"}`} />
                <span className={`flex size-8 items-center justify-center rounded-lg text-xs font-bold transition-all ${
                  i === active ? "bg-emerald-500/15" : "bg-white/5"
                } ${MOD_COLORS[i]}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <span className="block truncate">{m.name}</span>
                  <span className="block truncate text-[10px] text-zinc-600 dark:text-zinc-500">{m.tagline}</span>
                </div>
              </button>
            ))}
          </div>

          {/* detail panel */}
          <div className="min-h-[380px] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-7 md:p-9">
            <AnimatePresence mode="wait">
              <motion.div
                key={mod.id}
                initial={reduce ? false : { opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? undefined : { opacity: 0, x: -20 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* header */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <mod.icon className={`size-5 ${MOD_COLORS[active]}`} />
                      <h3 className="font-display text-2xl font-bold">{mod.tagline}</h3>
                    </div>
                    <p className="mt-2 max-w-[50ch] text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{mod.desc}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white/5 px-3 py-1 font-mono text-xs text-zinc-500">
                    {active + 1}/{MODULES.length}
                  </span>
                </div>

                {/* features */}
                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {mod.features.map((f, i) => (
                    <motion.div
                      key={f.text}
                      initial={reduce ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.04 }}
                      className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3.5 transition-colors hover:border-emerald-500/20"
                    >
                      <span className="mt-0.5 text-base">{f.icon}</span>
                      <span className="text-[13px] leading-snug text-zinc-300">{f.text}</span>
                    </motion.div>
                  ))}
                </div>

                {/* meta */}
                <div className="mt-5 flex flex-wrap gap-2 border-t border-white/5 pt-4">
                  {mod.meta.map((m) => (
                    <span key={m} className="rounded-full bg-emerald-500/10 px-3 py-1 font-mono text-[11px] text-emerald-400/80">{m}</span>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
