const STATS = [
  { value: "500", label: "条剪贴板历史" },
  { value: "1,900+", label: "内置表情" },
  { value: "200", label: "单次搜索结果" },
  { value: "36+", label: "Rust 单元测试" },
];

export function StatsBand() {
  return (
    <section className="border-y border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto grid max-w-6xl grid-cols-2 px-4 sm:px-6 md:grid-cols-4">
        {STATS.map((s, i) => (
          <div
            key={s.label}
            className={`py-10 text-center ${i > 0 ? "md:border-l md:border-zinc-200 md:dark:border-zinc-800" : ""}`}
          >
            <p className="font-display text-4xl font-bold tracking-tight tabular-nums">
              {s.value}
            </p>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
