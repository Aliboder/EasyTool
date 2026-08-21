import { Github } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

const LINKS = [
  { href: "#modules", label: "模块" },
  { href: "#why", label: "特性" },
  { href: "#screenshots", label: "界面" },
  { href: "#download", label: "下载" },
];

const REPO = "https://github.com/Aliboder/EasyTool";

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-zinc-200/70 bg-zinc-50/80 backdrop-blur-md dark:border-zinc-800/70 dark:bg-zinc-950/80">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
          <span className="inline-block size-2.5 rounded-[4px] bg-emerald-500" />
          EASYTOOL
        </a>

        <div className="hidden items-center gap-7 text-sm text-zinc-600 md:flex dark:text-zinc-400">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-emerald-600 dark:hover:text-emerald-400">
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub 仓库"
            className="flex size-9 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 transition-colors hover:border-emerald-500/60 hover:text-emerald-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-emerald-400"
          >
            <Github className="size-4" />
          </a>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
