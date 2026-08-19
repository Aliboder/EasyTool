import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// 窗口呼出时重放入场动画（淡入/缩放/滑动）
// 原理：窗口 hide 后 webview 继续运行，show 时页面不会重新加载，需手动重置 CSS animation。
// 为避免「先显示完整界面再补动画」的闪烁：
//  - 窗口真正隐藏（isVisible=false）时 → 内容重置为透明初始态
//  - 窗口从隐藏变可见时 → 从透明态播放动画，与窗口显示同步
// 关键：焦点事件无法区分「窗口隐藏」与「拖动/切焦点导致的短暂失焦」，
// 必须用 isVisible() 判断——只有窗口确实不可见才透明化/播放动画，避免拖动窗口闪烁。
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
    let hidden = false; // 是否处于「已确认隐藏」状态
    let hideTimer: number | null = null;

    const onBlur = () => {
      // 失焦 ≠ 隐藏（可能是拖动/切焦点）：延迟确认窗口是否真的不可见
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = window.setTimeout(async () => {
        hideTimer = null;
        const visible = await win.isVisible();
        if (!visible) {
          hidden = true;
          resetToHidden();
        }
      }, 250);
    };

    const onFocus = async () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      // 仅当窗口「从隐藏变为可见」才播放动画；一直可见（拖动恢复）不播放
      const visible = await win.isVisible();
      if (hidden && visible) {
        hidden = false;
        play();
      }
    };

    win
      .onFocusChanged(({ payload }) => {
        if (payload) {
          onFocus();
        } else {
          onBlur();
        }
      })
      .then((fn) => (unlisten = fn));

    // 初始化：先设为透明初始态；窗口当前可见则直接播放（启动场景），
    // 不可见（如延迟创建的弹窗）则标记隐藏，等首次 show 时播放
    resetToHidden();
    (async () => {
      const visible = await win.isVisible();
      hidden = !visible;
      if (visible) play();
    })();

    return () => {
      unlisten?.();
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [enable]);

  return ref;
}