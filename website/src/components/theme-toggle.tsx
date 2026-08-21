import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("et-theme", dark ? "dark" : "light");
    } catch {
      /* 隐私模式等场景下写入失败可忽略 */
    }
  }, [dark]);

  const toggle = () => {
    setDark((d) => !d);
    document.body.classList.add("boom");
    setTimeout(() => document.body.classList.remove("boom"), 550);
  };

  return (
    <button
      type="button"
      aria-label={dark ? "切换到亮色主题" : "切换到暗色主题"}
      onClick={toggle}
      className="flex size-9 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 transition-colors hover:border-emerald-500/60 hover:text-emerald-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-emerald-400"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
