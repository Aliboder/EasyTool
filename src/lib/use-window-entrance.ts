import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// 窗口呼出时重放入场动画（淡入/缩放），隐藏后复位为透明初始态。
//
// 实现要点：不维护任何本地标志位——可见性一律以 win.isVisible() 的
// 查询结果为准（权威同步），在「焦点变化」和「挂载后延迟兜底」时触发。
// 这样无论冷启动期 show/focus/isVisible 等事件以何种顺序到达，
// 最终状态都会收敛到真实值，不会卡在透明态。
export function useWindowEntrance(enable: boolean, classes: string[]) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enable) return;

    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    let hideTimer: number | null = null;
    let settleTimer: number | null = null;
    let gen = 0; // 同步代际号：防止并发的过期查询结果覆盖新状态

    const play = () => {
      const el = ref.current;
      if (!el) return;
      el.style.opacity = "";
      el.classList.remove(...classes);
      void el.offsetWidth; // 强制 reflow，重启动画
      el.classList.add(...classes);
    };

    const resetToHidden = () => {
      const el = ref.current;
      if (!el) return;
      el.classList.remove(...classes);
      el.style.opacity = "0";
    };

    // 以系统真实可见性为准同步 UI 状态
    const syncWithReality = async () => {
      const g = ++gen;
      const visible = await win.isVisible();
      if (g !== gen) return;
      const el = ref.current;
      if (visible) play();
      else resetToHidden();
      void el;
    };

    const onBlur = () => {
      // 失焦 ≠ 必然隐藏（可能是焦点抖动/边缘吸附），延迟确认
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = window.setTimeout(async () => {
        hideTimer = null;
        const g = ++gen;
        const visible = await win.isVisible();
        if (g !== gen) return;
        if (!visible) resetToHidden();
      }, 250);
    };

    const onFocused = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      void syncWithReality();
    };

    win
      .onFocusChanged(({ payload }) => {
        if (payload) {
          onFocused();
        } else {
          onBlur();
        }
      })
      .then((fn) => (unlisten = fn));

    // 初始同步 + 启动期兜底：主窗口由后端在模块就绪后 show，
    // 本 Hook 可能在 show 之前挂载，1.5 秒后的兜底同步覆盖该场景
    resetToHidden();
    void syncWithReality();
    settleTimer = window.setTimeout(() => {
      void syncWithReality();
    }, 1500);

    return () => {
      unlisten?.();
      if (hideTimer) clearTimeout(hideTimer);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [enable]);

  return ref;
}
