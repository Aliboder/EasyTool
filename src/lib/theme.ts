let sysMq: MediaQueryList | null = null;

function onSystemColorChange() {
  applyTheme("system");
}

export function applyTheme(theme: string) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const dark =
    theme === "dark" ||
    (theme === "system" && mq.matches);
  document.documentElement.classList.toggle("dark", dark);

  // system 模式下实时跟随系统主题切换；切回显式主题时移除监听
  if (theme === "system") {
    if (!sysMq) {
      sysMq = mq;
      mq.addEventListener("change", onSystemColorChange);
    }
  } else if (sysMq) {
    sysMq.removeEventListener("change", onSystemColorChange);
    sysMq = null;
  }
}

export type AccentKey = "" | "emerald" | "sky" | "violet" | "amber";

// 强调色预设：覆盖 --primary / --primary-foreground / --ring（OKLCH，深浅主题通用）
const ACCENTS: Record<Exclude<AccentKey, "">, { primary: string; fg: string; ring: string }> = {
  emerald: { primary: "oklch(0.65 0.15 160)", fg: "oklch(0.985 0 0)", ring: "oklch(0.72 0.14 160)" },
  sky: { primary: "oklch(0.62 0.17 245)", fg: "oklch(0.985 0 0)", ring: "oklch(0.72 0.14 245)" },
  violet: { primary: "oklch(0.6 0.19 295)", fg: "oklch(0.985 0 0)", ring: "oklch(0.72 0.15 295)" },
  amber: { primary: "oklch(0.72 0.15 75)", fg: "oklch(0.22 0 0)", ring: "oklch(0.78 0.15 75)" },
};

/** 应用强调色（"" = 恢复默认主题色） */
export function applyAccent(accent: AccentKey) {
  const root = document.documentElement;
  const a = accent ? ACCENTS[accent] : null;
  if (!a) {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
    root.style.removeProperty("--ring");
    return;
  }
  root.style.setProperty("--primary", a.primary);
  root.style.setProperty("--primary-foreground", a.fg);
  root.style.setProperty("--ring", a.ring);
}

/** 界面缩放：修改根字号（rem 单位整体缩放），90-120% */
export function applyUiScale(scale: number) {
  document.documentElement.style.fontSize = `${scale}%`;
}