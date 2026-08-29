import { useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

const STATS = [
  { value: 500, label: "条剪贴板历史", unit: "" },
  { value: 1900, label: "内置表情", unit: "+" },
  { value: 116, label: "Rust 单元测试", unit: "+" },
  { value: 48, label: "前端单元测试", unit: "" },
  { value: 6, label: "功能模块", unit: "" },
];

function StepCount({ target }: { target: number }) {
  const [display, setDisplay] = useState("0");
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { amount: 0.5, once: true });

  useEffect(() => {
    if (!inView) return;
    const steps = Math.min(target, 30);
    const stepDuration = 40;
    let current = 0;
    const timer = setInterval(() => {
      current++;
      const progress = current / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      const val = Math.round(eased * target);
      setDisplay(val >= 1000 ? val.toLocaleString("en-US") : String(val));
      if (current >= steps) clearInterval(timer);
    }, stepDuration);
    return () => clearInterval(timer);
  }, [inView, target]);

  return (
    <span ref={ref} className="stat-num tabular-nums cursor-default">
      {display}
    </span>
  );
}

export function StatsTicker() {
  return (
    <section className="relative overflow-hidden border-y-2 border-emerald-500 bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.1),transparent_70%)]" />
      <div className="relative mx-auto grid max-w-6xl grid-cols-2 px-4 sm:px-6 md:grid-cols-5">
        {STATS.map((s, i) => (
          <div key={s.label} className={`py-8 text-center ${i > 0 ? "border-l border-emerald-400/30" : ""}`}>
            <p className="font-display text-3xl font-bold md:text-4xl">
              <StepCount target={s.value} />
              {s.unit}
            </p>
            <p className="mt-1.5 font-display text-[11px] uppercase tracking-[0.15em] text-emerald-100/80">
              {s.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
