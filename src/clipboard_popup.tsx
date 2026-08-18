import React from "react";
import ReactDOM from "react-dom/client";
import { Clippage } from "@/modules/clipboard/Clippage";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Clippage />
  </React.StrictMode>,
);