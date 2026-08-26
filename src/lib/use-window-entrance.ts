import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// 窗口呼出时重放入场动画（淡入/缩放/滑动）
// 原理：窗口 hide 后 webview 继续运行，show 时页面不会重新加载，需手动重置 CSS animation。
// 为避免「先显示完整界面再补动画」的闪烁：
//  - 窗口真正隐藏（isVisible=false）时 → 内容重置为透明初始态
//  - 窗口从隐藏变可见时 → 从透明态播放动画，与窗口显示同步
// 关键：焦点事件无法区分「窗口隐藏」与「拖动/切焦点导致的短暂失焦」，
// 必须用 isVisible() 判断——只有窗口确实不可见才透明化/播放动画，避免拖动窗口闪烁。
// 透明态以根节点内联 opacity 为准（DOM 即状态，无标志位）：冷启动 show 时
// webview 可能收不到焦点事件，内容停在透明态 = 窗口空白，由挂载兜底补播。
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

    // 内容是否停在透明初始态（未播过动画/待播放）；play() 会清空内联 opacity
    const isPending = () => ref.current?.style.opacity === "0";

    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    let hideTimer: number | null = null;
    let settleTimer: number | null = null;
    let settleAttempts = 0;

    const onBlur = () => {
      // 失焦 ≠ 隐藏（可能是拖动/切焦点）：延迟确认窗口是否真的不可见
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = window.setTimeout(async () => {
        hideTimer = null;
        const visible = await win.isVisible();
        if (!visible) resetToHidden();
      }, 250);
    };

    const onFocus = async () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      // 仅当内容仍停在透明初始态才播放：真实 hidden→visible 切换才透明化过，
      // 一直可见的拖动/切焦点恢复时已非透明态，不会重放动画
      const visible = await win.isVisible();
      if (visible && isPending()) play();
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

    // 冷启动兜底：主窗口以 visible:false 创建，show 时 webview 可能收不到焦点事件
    // （首次启动无激活焦点），内容停在透明态 = 窗口空白，直到用户首次点击/拖动窗口
    // 焦点事件才补播，表现为「界面突然重新加载」。挂载后轮询核对：窗口已可见且
    // 仍未播过动画 → 补播（opacity 已非 "0" 即跳过，不会重复播）；窗口还没显示
    // （慢启动）则限次续查；超过仍无则放弃——首次焦点事件路径仍能自愈
    resetToHidden();
    const settle = () => {
      settleTimer = window.setTimeout(async () => {
        settleTimer = null;
        const visible = await win.isVisible();
        if (visible) {
          if (isPending()) play();
        } else if (settleAttempts++ < 5) {
          settle();
        }
      }, 1200);
    };
    settle();

    return () => {
      unlisten?.();
      if (hideTimer) clearTimeout(hideTimer);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [enable]);

  return ref;
}
