import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

interface StatusPayload {
  balance: number | null;
  available: boolean;
  error: string | null;
  go_windows: { window: string; used_percent: number; resets_at: number | null }[];
}

interface Settings {
  font_size: number;
  opacity: number;
  dim_level: number;
  corner_radius: number;
  lock_passthrough: boolean;
  warn_threshold: number;
}

const WINDOW_NAMES: Record<string, string> = {
  session: "5小时",
  weekly: "周",
  monthly: "月",
};

export function FloatWindow() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<"balance" | "go">("balance");
  const [goIdx, setGoIdx] = useState(0);
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const win = getCurrentWindow();

  useEffect(() => {
    const refresh = () => {
      invoke<StatusPayload>("get_status").then(setStatus).catch(console.error);
      invoke<Settings>("get_settings").then(setSettings).catch(console.error);
    };
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  const statusColor = () => {
    if (!status) return "bg-slate-600";
    if (status.error && status.balance == null) return "bg-orange-500";
    if (status.balance != null && status.balance < (settings?.warn_threshold ?? 10)) {
      return "bg-red-500";
    }
    return "bg-emerald-500";
  };

  const displayText = () => {
    if (!status) return "…";
    if (mode === "balance") {
      if (status.error && status.balance == null) return "⚠ 查询失败";
      return `¥${(status.balance ?? 0).toFixed(2)}`;
    }
    const wins = status.go_windows;
    if (wins.length === 0) return status.error ? "⚠" : "无套餐数据";
    const w = wins[goIdx % wins.length];
    return `${WINDOW_NAMES[w.window] ?? w.window} ${w.used_percent}%`;
  };

  const onSingleClick = () => {
    if (mode === "balance" && status?.go_windows.length) {
      setMode("go");
      setGoIdx(0);
    } else if (mode === "go") {
      if (goIdx + 1 < status!.go_windows.length) setGoIdx(goIdx + 1);
      else setMode("balance");
    }
  };

  const applyEffects = () => {
    if (!settings) return;
    win.setIgnoreCursorEvents(settings.lock_passthrough).catch(() => {});
  };

  useEffect(() => {
    applyEffects();
    const pos = localStorage.getItem("float_pos");
    if (pos) {
      const [x, y] = pos.split(",").map(Number);
      if (x && y) win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y))).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.lock_passthrough]);

  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    win.startDragging();
  };

  const savePos = async () => {
    const p = await win.outerPosition();
    localStorage.setItem("float_pos", `${p.x},${p.y}`);
  };

  const openMain = () => {
    WebviewWindow.getByLabel("main").then((w) => {
      w?.show();
      w?.setFocus();
    });
  };

  return (
    <div
      className="flex h-screen w-screen select-none items-center justify-center"
      onMouseDown={startDrag}
      onClick={() => {
        savePos();
        onSingleClick();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        savePos();
      }}
      style={{
        opacity: hover ? 1 : (settings?.dim_level ?? 60) / 100,
      }}
    >
      <div
        className="flex items-center justify-center rounded-md px-3 py-1 text-white shadow"
        style={{
          backgroundColor: statusColor(),
          fontSize: settings?.font_size ?? 14,
          borderRadius: settings?.corner_radius ?? 10,
          opacity: (settings?.opacity ?? 100) / 100,
          cursor: settings?.lock_passthrough ? "default" : "grab",
        }}
      >
        <span>{displayText()}</span>
      </div>

      {menu && (
        <div
          className="fixed z-50 min-w-36 rounded-md border bg-popover p-1 text-popover-foreground text-xs shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent"
            onClick={() => {
              setMode(status?.go_windows.length ? "go" : "balance");
              setMenu(null);
            }}
          >
            Go 套餐
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent"
            onClick={() => {
              setMode("balance");
              setMenu(null);
            }}
          >
            余额模式
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent"
            onClick={() => {
              openMain();
              setMenu(null);
            }}
          >
            打开主窗口
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent"
            onClick={() => {
              win.hide();
              setMenu(null);
            }}
          >
            隐藏悬浮窗
          </button>
        </div>
      )}
    </div>
  );
}