import { Github } from "lucide-react";

const REPO = "https://github.com/Aliboder/EasyTool";

export function Footer() {
  return (
    <footer className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
            <span className="inline-block size-2.5 rounded-[4px] bg-emerald-500" />
            EASYTOOL
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Windows 效率工具箱 · 用 Tauri 2 + Rust + React 打造
          </p>
        </div>

        <div className="flex items-center gap-6 text-sm text-zinc-500 dark:text-zinc-400">
          <a href={REPO} target="_blank" rel="noreferrer" className="transition-colors hover:text-emerald-600 dark:hover:text-emerald-400">
            GitHub
          </a>
          <a href={`${REPO}/releases`} target="_blank" rel="noreferrer" className="transition-colors hover:text-emerald-600 dark:hover:text-emerald-400">
            Releases
          </a>
          <a href={`${REPO}/issues`} target="_blank" rel="noreferrer" className="transition-colors hover:text-emerald-600 dark:hover:text-emerald-400">
            Issues
          </a>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub 仓库"
            className="text-zinc-400 transition-colors hover:text-emerald-600 dark:hover:text-emerald-400"
          >
            <Github className="size-4" />
          </a>
        </div>
      </div>

      <p className="mt-8 border-t border-zinc-200 pt-6 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        © 2026 Aliboder · MIT License
      </p>
    </footer>
  );
}
