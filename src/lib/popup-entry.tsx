import React from "react";
import ReactDOM from "react-dom/client";
import { getConfig } from "@/lib/api";
import { applyTheme } from "@/lib/theme";
import "@/index.css";

/**
 * 独立弹窗窗口统一挂载入口：主题跟随 + React 挂载。
 * 各弹窗 HTML 对应的入口文件只需一行：
 *   mountPopup(<XxxPage />);
 */
export function mountPopup(component: React.ReactNode) {
  function applyCurrentTheme() {
    getConfig()
      .then((c) => applyTheme(c.theme))
      .catch(() => {});
  }
  // 每次呼出（窗口聚焦）时刷新主题，改主题后下次呼出即生效
  window.addEventListener("focus", applyCurrentTheme);
  applyCurrentTheme();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>{component}</React.StrictMode>,
  );
}
