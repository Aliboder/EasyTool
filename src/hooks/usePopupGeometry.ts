import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const DEBOUNCE_MS = 400;

/**
 * 弹窗位置/尺寸记忆：移动/缩放停止 400ms 后写入模块配置。
 * - trackSize：缩放后写 popup_size = {w,h}
 * - trackPos ：移动后写 fixed_pos = {x,y}（仅「固定位置」模式的弹窗需要）
 *
 * 存储键与旧版各模块独立命令完全一致，恢复逻辑无需改动；
 * 写入走通用 set_module_config（reapply_hotkeys 幂等，无副作用）。
 */
export function usePopupGeometry(
  moduleId: string,
  { trackSize = false, trackPos = false }: { trackSize?: boolean; trackPos?: boolean } = {},
) {
  // 尺寸记忆
  useEffect(() => {
    if (!trackSize) return;
    const win = getCurrentWindow();
    let t: number | null = null;
    const un = win.onResized(({ payload }) => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => {
        // 脏值过滤（与主窗口尺寸记忆同口径）：WebView2 在隐藏/最小化时会报 0x0，
        // 写进配置会导致下次呼出弹窗极小；与 min_inner_size(400x300) 一致
        if (payload.width < 400 || payload.height < 300) return;
        invoke("set_module_config", {
          moduleId,
          patch: { popup_size: { w: payload.width, h: payload.height } },
        }).catch(console.error);
      }, DEBOUNCE_MS);
    });
    return () => {
      un.then((fn) => fn());
      if (t) window.clearTimeout(t);
    };
  }, [moduleId, trackSize]);

  // 位置记忆
  useEffect(() => {
    if (!trackPos) return;
    const win = getCurrentWindow();
    let t: number | null = null;
    const un = win.onMoved(({ payload }) => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => {
        invoke("set_module_config", {
          moduleId,
          patch: { fixed_pos: { x: payload.x, y: payload.y } },
        }).catch(console.error);
      }, DEBOUNCE_MS);
    });
    return () => {
      un.then((fn) => fn());
      if (t) window.clearTimeout(t);
    };
  }, [moduleId, trackPos]);
}
