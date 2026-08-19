import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// 键盘事件 code → 后端 global-hotkey 接受的键名
const KEY_NAMES: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (let i = 0; i < 26; i++) m[`Key${String.fromCharCode(65 + i)}`] = String.fromCharCode(65 + i);
  for (let i = 0; i < 10; i++) {
    m[`Digit${i}`] = String(i);
    m[`Numpad${i}`] = `Num${i}`;
  }
  for (let i = 1; i <= 24; i++) m[`F${i}`] = `F${i}`;
  Object.assign(m, {
    NumpadAdd: "NumAdd",
    NumpadSubtract: "NumSubtract",
    NumpadMultiply: "NumMultiply",
    NumpadDivide: "NumDivide",
    NumpadDecimal: "NumDecimal",
    NumpadEnter: "NumEnter",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Enter: "Enter",
    Space: "Space",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    Insert: "Insert",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Escape: "Escape",
    CapsLock: "CapsLock",
    NumLock: "NumLock",
    ScrollLock: "ScrollLock",
    PrintScreen: "PrintScreen",
    Pause: "Pause",
    Comma: ",",
    Period: ".",
    Minus: "-",
    Equal: "=",
    Slash: "/",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Backquote: "`",
    Backslash: "\\",
  });
  return m;
})();

function mapKeyName(code: string): string | null {
  return KEY_NAMES[code] ?? null;
}

export function HotkeyRecorder({
  value,
  onSave,
  hint = "点击后按下组合键即可录制",
}: {
  value: string;
  onSave: (combo: string) => Promise<string | void> | string | void;
  hint?: string;
}) {
  const [recording, setRecording] = useState(false);
  const [recordingKeys, setRecordingKeys] = useState<string[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;

      const mods = Array.from(
        new Set(
          [
            e.ctrlKey && "Ctrl",
            e.shiftKey && "Shift",
            e.altKey && "Alt",
            e.metaKey && "Super",
          ].filter(Boolean) as string[],
        ),
      );
      setRecordingKeys(mods);

      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      if (e.key === "Escape" && mods.length === 0) {
        setRecording(false);
        setRecordingKeys([]);
        setMsg("");
        return;
      }

      const keyName = mapKeyName(e.code);
      if (!keyName) return;

      if (mods.length === 0) {
        setMsg("请同时按住 Ctrl / Shift / Alt 等修饰键");
        return;
      }

      const combo = [...mods, keyName].join("+");
      setRecording(false);
      setRecordingKeys([]);
      const result = onSave(combo);
      if (result instanceof Promise) {
        result.then((err) => {
          if (err) setMsg(err);
        });
      } else if (result) {
        setMsg(result);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [recording, onSave]);

  return (
    <div className="space-y-1">
      <button
        onClick={() => {
          setRecording(true);
          setMsg("");
        }}
        disabled={recording}
        className={cn(
          "flex h-9 w-full items-center justify-center rounded-md border text-sm transition-colors",
          recording
            ? "cursor-default border-primary text-primary"
            : "border-input hover:border-accent",
        )}
      >
        {recording
          ? recordingKeys.length
            ? recordingKeys.join(" + ")
            : "按下组合键…（Esc 取消）"
          : value || "点击录制热键"}
      </button>
      <p className="text-xs text-muted-foreground">
        {recording ? "请按下要设置的组合键（需包含 Ctrl / Shift / Alt）" : hint}
      </p>
      {msg && <p className="text-xs text-orange-600">{msg}</p>}
    </div>
  );
}
