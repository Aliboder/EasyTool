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