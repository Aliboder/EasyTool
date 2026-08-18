import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { FloatWindow } from "@/modules/quota/FloatWindow";
import "./index.css";

window.addEventListener("error", (e) => {
  invoke("log_frontend", { level: "error", msg: `uncaught: ${e.message}` }).catch(() => {});
});
window.addEventListener("unhandledrejection", (e) => {
  invoke("log_frontend", {
    level: "error",
    msg: `unhandledrejection: ${String(e.reason)}`,
  }).catch(() => {});
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <FloatWindow />
  </React.StrictMode>,
);