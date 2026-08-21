const FACTS = [
  "v0.4.5",
  "MIT License",
  "Windows 10 / 11 x64",
  "数据本地存储",
  "Tauri 2 + Rust + React",
];

export function VersionBar() {
  return (
    <div className="border-y border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-5 font-display text-sm text-zinc-500 sm:px-6 dark:text-zinc-400">
        {FACTS.map((f, i) => (
          <span key={f} className="flex items-center gap-8">
            {f}
            {i < FACTS.length - 1 && (
              <span aria-hidden className="size-1 rounded-full bg-emerald-500/50" />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
