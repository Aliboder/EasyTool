import { useState } from "react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";
import { RealMainWindow } from "./real-main-window";
import { RealQuotaSettings } from "./real-quota-settings";
import { RealAppShell } from "./real-app-shell";
import { RealTimetracker } from "./real-timetracker";

const MODULES = [
  { id: "timetracker", label: "时长统计", desc: "排行 + 时间线 + 分类", color: "text-violet-400" },
  { id: "search", label: "文件搜索", desc: "Everything 引擎，输入即出结果", color: "text-emerald-400" },
  { id: "quota", label: "额度监控", desc: "多账户余额追踪", color: "text-cyan-400" },
  { id: "shell", label: "App 外壳", desc: "底部导航模块切换", color: "text-zinc-400" },
];

export function Screenshots() {
  const [active, setActive] = useState(0);

  const renderComponent = () => {
    switch (MODULES[active].id) {
      case "timetracker": return <RealTimetracker />;
      case "search": return <RealMainWindow />;
      case "quota": return <RealQuotaSettings />;
      case "shell": return <RealAppShell />;
      default: return <RealMainWindow />;
    }
  };

  return (
    <section id="screenshots" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead no="06" title="真实界面" sub="全部用代码还原——所见即所得。" />
      </Reveal>

      <Reveal delay={0.08}>
        <div className="mt-10 grid gap-8 lg:grid-cols-[220px_1fr]">
          {/* left: module selector */}
          <div className="space-y-2">
            {MODULES.map((m, i) => (
              <button
                key={m.id}
                onClick={() => setActive(i)}
                className={`group flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm transition-all duration-200 ${
                  i === active
                    ? "bg-emerald-500/10 text-emerald-500 shadow-sm shadow-emerald-500/10 dark:text-emerald-400"
                    : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300"
                }`}
              >
                <div className={`absolute left-0 top-1/2 -translate-y-1/2 h-8 w-[3px] rounded-full bg-emerald-500 transition-all duration-200 ${i === active ? "opacity-100" : "opacity-0"}`} />
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold transition-all ${
                  i === active ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-zinc-500"
                }`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <span className="block truncate font-medium">{m.label}</span>
                  <span className="block truncate text-[10px] text-zinc-600 dark:text-zinc-500">{m.desc}</span>
                </div>
              </button>
            ))}
          </div>

          {/* right: live component */}
          <div className="min-h-[500px] overflow-hidden rounded-2xl border-2 border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2.5 py-1 font-display text-[10px] font-bold ${MODULES[active].color.replace("text-", "bg-")}/15 ${MODULES[active].color}`}>
                  {String(active + 1).padStart(2, "0")}
                </span>
                <span className="font-display font-semibold">{MODULES[active].label}</span>
              </div>
              <span className="font-mono text-xs text-zinc-500">{active + 1}/{MODULES.length}</span>
            </div>
            <div className="flex justify-center">
              {renderComponent()}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
