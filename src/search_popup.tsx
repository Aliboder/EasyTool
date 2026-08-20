import React from "react";
import ReactDOM from "react-dom/client";
import { SearchPopup } from "@/modules/search/Popup";
import { getConfig } from "@/lib/api";
import { applyTheme } from "@/lib/theme";
import "./index.css";

function applyCurrentTheme() {
  getConfig()
    .then((c) => applyTheme(c.theme))
    .catch(() => {});
}

// 每次呼出（窗口聚焦）时刷新主题，改主题后下次呼出即生效
window.addEventListener("focus", applyCurrentTheme);
applyCurrentTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SearchPopup />
  </React.StrictMode>,
);