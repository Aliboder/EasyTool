import { Reveal } from "./reveal";

const KEYS = [
  { action: "呼出主面板", keys: ["Ctrl", "Shift", "E"] },
  { action: "剪贴板弹窗", keys: ["Ctrl", "Shift", "V"] },
  { action: "表情面板", keys: ["Ctrl", "Shift", "J"] },
  { action: "文件搜索", keys: ["Ctrl", "Shift", "F"] },
];

export function Hotkeys() {
  return (
    <section id="hotkeys" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
          手不离键盘
        </h2>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          全局热键一键呼出，所有快捷键都支持录制自定义。
        </p>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KEYS.map((k, i) => (
          <Reveal key={k.action} delay={i * 0.06}>
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{k.action}</p>
              <div className="mt-4 flex items-center gap-1.5">
                {k.keys.map((key, j) => (
                  <span key={key} className="flex items-center gap-1.5">
                    {j > 0 && (
                      <span aria-hidden className="text-xs text-zinc-400 dark:text-zinc-600">
                        +
                      </span>
                    )}
                    <kbd className="inline-flex min-w-9 justify-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-display text-sm font-medium shadow-sm dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-none">
                      {key}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.2}>
        <p className="mt-6 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          默认统一呼出：<kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-display text-xs dark:border-zinc-700 dark:bg-zinc-800">Ctrl+Shift+E</kbd>{" "}
          打开主面板；关闭统一模式后，各模块独立热键生效。热键均可在设置中录制修改。
        </p>
      </Reveal>
    </section>
  );
}
