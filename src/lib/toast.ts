// 轻量全局 Toast：模块级函数，动态创建 DOM 元素（不侵入 React 树）
let container: HTMLDivElement | null = null;

export function toast(message: string) {
  if (!container) {
    container = document.createElement("div");
    container.className =
      "pointer-events-none fixed left-1/2 top-5 z-[9999] flex -translate-x-1/2 flex-col items-center gap-2";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className =
    "rounded-lg border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2 duration-200";
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("animate-out", "fade-out-0", "slide-out-to-top-2", "duration-150");
    setTimeout(() => el.remove(), 160);
  }, 2200);
}
