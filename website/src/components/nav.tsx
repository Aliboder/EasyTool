import { Github } from "lucide-react";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "#modules", label: "模块" },
  { href: "#hotkeys", label: "快捷键" },
  { href: "#design", label: "设计" },
  { href: "#data", label: "数据" },
  { href: "#screenshots", label: "界面" },
  { href: "#download", label: "下载" },
];

const REPO = "https://github.com/Aliboder/EasyTool";

export function Nav() {
  const [active, setActive] = useState("");

  useEffect(() => {
    const sections = LINKS.map((l) => document.getElementById(l.href.slice(1))).filter(Boolean) as HTMLElement[];
    if (!sections.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActive("#" + e.target.id);
            break;
          }
        }
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/5 bg-zinc-950/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-white">
          <span className="inline-block size-2.5 rounded-[4px] bg-emerald-500" />
          EASYTOOL
        </a>
        <div className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={`nav-link transition-colors hover:text-white ${active === l.href ? "active" : ""}`}>
              {l.label}
            </a>
          ))}
        </div>
        <a href={REPO} target="_blank" rel="noreferrer" aria-label="GitHub" className="flex size-9 items-center justify-center rounded-full border border-white/10 text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-white">
          <Github className="size-4" />
        </a>
      </nav>
    </header>
  );
}
