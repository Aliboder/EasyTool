import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AppWindow, Check, ClipboardList, Gauge, Search, Smile } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

type ModuleInfo = {
  id: string;
  name: string;
  icon: LucideIcon;
  tagline: string;
  features: string[];
  meta: string[];
};

const MODULES: ModuleInfo[] = [
  {
    id: "clipboard",
    name: "剪贴板历史",
    icon: ClipboardList,
    tagline: "复制过的一切，随时找回",
    features: [
      "默认保留 500 条，文本 / 图片 / 文件分类记录，可单独开关",
      "图片自动生成缩略图，大图悬停即看",
      "固定常用条目，拖拽调整顺序，置顶永不挤掉",
      "内容指纹去重，自身写入不误记",
      "弹窗跟随鼠标，失焦自动隐藏，选中即粘贴",
    ],
    meta: ["Ctrl+Shift+V", "跟随鼠标", "SQLite 本地存储"],
  },
  {
    id: "quota",
    name: "额度监控",
    icon: Gauge,
    tagline: "AI 花销，心里有数",
    features: [
      "DeepSeek / OpenCode Go 多账户，各自独立密钥与余额",
      "轮询间隔自由调节（默认 30 秒，最低 5 秒）",
      "预警 + 告警双阈值，余额吃紧提前知道",
      "每账户独立保存 5000 条消费历史",
      "消费突增自动提醒，异常用量不放过",
    ],
    meta: ["后台轮询", "多账户", "凭据管理器存密钥"],
  },
  {
    id: "emoji",
    name: "表情面板",
    icon: Smile,
    tagline: "1900+ 表情，一按即出",
    features: [
      "分类浏览 + 收藏置顶，常用表情一步直达",
      "中文名 / 英文名 / shortcode 三种方式搜索",
      "文本表情经 SendInput 直输，不污染剪贴板",
      "系统字体优先渲染，缺失时 Twemoji 兜底",
      "图片表情自动写入并粘贴，全流程无感",
    ],
    meta: ["Ctrl+Shift+J", "跟随鼠标", "SendInput 直输"],
  },
  {
    id: "search",
    name: "文件秒搜",
    icon: Search,
    tagline: "全盘文件，输入即达",
    features: [
      "基于 Everything 引擎，文件名毫秒级返回",
      "正则、大小写、全字匹配、路径匹配随意组合",
      "结果列（路径 / 大小 / 修改时间 / 缩略图）与排序自定义",
      "列表 / 网格双视图，单次最多返回 200 条",
      "复制路径自动进入剪贴板历史，跨模块联动",
    ],
    meta: ["Ctrl+Shift+F", "需安装 Everything", "跟随鼠标"],
  },
  {
    id: "quicklaunch",
    name: "快速启动",
    icon: AppWindow,
    tagline: "常用工具，一键直达",
    features: [
      "支持应用、文件、文件夹、网址四种快捷方式",
      "拖拽排序 + 分组管理，自定义布局",
      "网格 / 列表双视图，格子大小可调（48-96px）",
      "支持文件拖入添加、剪贴板粘贴路径",
      "右键菜单：打开 / 打开位置 / 复制路径 / 重命名 / 删除",
    ],
    meta: ["主面板内", "拖拽排序", "SQLite 存储"],
  },
];

export function DeepDive() {
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const mod = MODULES[active];

  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead
          no="02"
          title="每个模块，都有真功夫"
          sub="特性清单直接来自源码——没有营销话术。"
        />
      </Reveal>

      <Reveal delay={0.08}>
        <div className="mt-10 grid gap-4 md:grid-cols-[220px_1fr] md:gap-8">
          <div
            role="tablist"
            aria-label="模块列表"
            className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0"
          >
            {MODULES.map((m, i) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`flex shrink-0 items-center gap-2.5 rounded-xl px-4 py-3 text-sm transition-colors ${
                  i === active
                    ? "bg-emerald-500/10 font-medium text-emerald-600 ring-1 ring-emerald-500/30 dark:text-emerald-400"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                <m.icon className="size-4" />
                {m.name}
              </button>
            ))}
          </div>

          <div className="min-h-[340px] rounded-2xl border border-zinc-200 bg-white p-7 dark:border-zinc-800 dark:bg-zinc-900 md:p-9">
            <AnimatePresence mode="wait">
              <motion.div
                key={mod.id}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <h3 className="font-display text-xl font-semibold">{mod.tagline}</h3>
                <ul className="mt-5 space-y-3">
                  {mod.features.map((f) => (
                    <li key={f} className="feat-row flex gap-3 rounded-lg px-3 py-2 text-sm leading-relaxed">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                      <span className="text-zinc-700 dark:text-zinc-300">{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 flex flex-wrap gap-2 border-t border-zinc-100 pt-5 dark:border-zinc-800">
                  {mod.meta.map((m) => (
                    <span
                      key={m}
                      className="rounded-full bg-zinc-100 px-3 py-1 font-display text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      {m}
                    </span>
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
