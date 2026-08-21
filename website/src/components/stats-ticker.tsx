import { useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { animate } from "motion";

const STATS = [
  { value: 500, label: "条剪贴板历史", unit: "" },
  { value: 1900, label: "内置表情", unit: "+" },
  { value: 200, label: "单次搜索结果", unit: "" },
  { value: 36, label: "Rust 单元测试", unit: "+" },
];

function AnimatedNum({ target }: { target: number }) {
  const [display, setDisplay] = useState("0");
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { amount: 0.5, once: true });

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, target, {
      duration: 1.4,
      ease: "easeOut",
      onUpdate: (v) => {
        const n = Math.round(v);
        setDisplay(n >= 1000 ? n.toLocaleString("en-US") : String(n));
      },
    });
    return () => controls.stop();
  }, [inView, target]);

  return (
    <span ref={ref} className="tabular-nums">
      {display}
    </span>
  );
}

export function StatsTicker() {
  return (
    <section className="relative overflow-hidden border-y-2 border-emerald-500 bg-emerald-500 text-white">
      <div className="mx-auto grid max-w-6xl grid-cols-2 px-4 sm:px-6 md:grid-cols-4">
        {STATS.map((s, i) => (
          <div
            key={s.label}
            className={`py-8 text-center ${i > 0 ? "md:border-l md:border-emerald-400/30" : ""}`}
          >
            <p className="font-display text-4xl font-bold">
              <AnimatedNum target={s.value} />
              {s.unit}
            </p>
            <p className="mt-1.5 font-display text-xs uppercase tracking-[0.15em] text-emerald-100/80">
              {s.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
