import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarDays, ClipboardList, Clock, Gauge, Monitor, Search, Smile } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";
import { RealClipboard } from "./real-clipboard";
import { RealMainWindow } from "./real-main-window";
import { RealQuotaSettings } from "./real-quota-settings";
import { RealEmoji } from "./real-emoji";
import { RealTimetracker } from "./real-timetracker";
import { RealCalendar } from "./real-calendar";
import { RealAppShell } from "./real-app-shell";

const MODULES: { id: string; label: string; desc: string; icon: LucideIcon }[] = [
  { id: "clipboard", label: "剪贴板", desc: "500 条历史 · 搜索高亮 · 纯文本粘贴", icon: ClipboardList },
  { id: "search", label: "文件搜索", desc: "Everything 引擎，输入即出结果", icon: Search },
  { id: "quota", label: "额度监控", desc: "多账户余额 · 阈值系统通知", icon: Gauge },
  { id: "emoji", label: "表情面板", desc: "最近使用 · 分类检索 · 自定义导入", icon: Smile },
  { id: "timetracker", label: "时长统计", desc: "排行 + 甘特时间线 + 自动分类", icon: Clock },
  { id: "calendar", label: "日程表", desc: "五视图 · 重复规则 · 到期提醒", icon: CalendarDays },
  { id: "shell", label: "App 外壳", desc: "单窗口 · 底部导航 · 托盘快捷入口", icon: Monitor },
];

export function Screenshots() {
  const [active, setActive] = useState(0);
  // 切换方向（前进 1 / 后退 -1）：决定进出场位移方向，动画不打架
  const [dir, setDir] = useState(1);
  const reduce = useReducedMotion();
  const M = MODULES[active];

  const goTo = (i: number) => {
    if (i === active) return;
    setDir(i > active ? 1 : -1);
    setActive(i);
  };

  const renderComponent = () => {
    switch (M.id) {
      case "clipboard":
        return <RealClipboard />;
      case "search":
        return <RealMainWindow />;
      case "quota":
        return <RealQuotaSettings />;
      case "emoji":
        return <RealEmoji />;
      case "timetracker":
        return <RealTimetracker />;
      case "calendar":
        return <RealCalendar />;
      case "shell":
        return <RealAppShell />;
      default:
        return <RealClipboard />;
    }
  };

  return (
    <section id="screenshots" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead eyebrow="真实界面" title="所见即所得" sub="全部用代码按 v0.9.0 实际界面还原，可以点击、搜索、置顶、删除。" />
      </Reveal>

      <Reveal delay={0.08}>
        <div className="mt-12">
          {/* 主舞台 */}
          <div className="relative overflow-hidden rounded-3xl border-2 border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent">
            {/* 舞台顶栏 */}
            <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-400">
                  <M.icon className="size-3.5" />
                </span>
                <span className="font-display text-sm font-semibold">{M.label}</span>
                <span className="hidden text-xs text-zinc-500 sm:block">{M.desc}</span>
              </div>
              <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                {active + 1} / {MODULES.length}
              </span>
            </div>
            {/* 舞台内容（可横向滚动的小屏）：AnimatePresence 作出入场/退场，方向随切换拖动 */}
            <div className="flex justify-center overflow-x-auto px-4 py-8 sm:px-8">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={M.id}
                  initial={reduce ? false : { opacity: 0, x: 28 * dir, scale: 0.985, filter: "blur(6px)" }}
                  animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
                  exit={reduce ? undefined : { opacity: 0, x: -28 * dir, scale: 0.985, filter: "blur(6px)" }}
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                  className="w-full max-w-xl shrink-0"
                >
                  {renderComponent()}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* 胶片条：模块切换 */}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {MODULES.map((m, i) => (
              <button
                key={m.id}
                onClick={() => goTo(i)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-all",
                  i === active
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
                    : "border-white/10 text-zinc-500 hover:border-white/20 hover:text-zinc-300",
                )}
              >
                <m.icon className="size-4" />
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}