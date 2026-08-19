import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// 窗口呼出时重放入场动画（淡入/缩放/滑动）
// 原理：窗口 hide 后 webview 继续运行，show 时页面不会重新加载，需手动重置 CSS animation。
// 为避免「先显示完整界面再补动画」的闪烁：
//  - 窗口失焦/隐藏时 → 把内容重置为透明初始态（opacity 0 + 微缩）
//  - 窗口聚焦/呼出时 → 从透明态播放动画，与窗口显示同步
export function useWindowEntrance(enable: boolean, classes: string[]) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enable) return;

    const play = () => {
      const el = ref.current;
      if (!el) return;
      // 清除隐藏时的内联透明态，让动画从初始帧开始
      el.style.opacity = "";
      el.classList.remove(...classes);
      void el.offsetWidth; // 强制 reflow，重置动画
      el.classList.add(...classes);
    };

    const resetToHidden = () => {
      const el = ref.current;
      if (!el) return;
      el.classList.remove(...classes);
      // 透明初始态：下次 show 时动画从透明开始，视觉无缝（缩放由动画类自带）
      el.style.opacity = "0";
    };

    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    win
      .onFocusChanged(({ payload }) => {
        if (payload) {
          play();
        } else {
          resetToHidden();
        }
      })
      .then((fn) => (unlisten = fn));

    // 初始化：先设为透明初始态，若窗口当前已聚焦则立即播放（启动/首次显示场景）
    resetToHidden();
    win.isFocused().then((focused) => {
      if (focused) play();
    });

    return () => {
      unlisten?.();
    };
  }, [enable]);

  return ref;
}