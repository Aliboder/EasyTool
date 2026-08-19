import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getConfig } from "@/lib/api";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { Label } from "@/components/ui/label";

export function EmojiSettings({ onRefresh }: { onRefresh: () => void }) {
  const [hotkey, setHotkey] = useState("");
  const [action, setAction] = useState<"paste" | "copy">("paste");
  const [followMouse, setFollowMouse] = useState(true);

  useEffect(() => {
    getConfig().then((cfg) => {
      const m = cfg.modules.emoji ?? {};
      setHotkey((m.hotkey as string) ?? "Ctrl+Shift+J");
      setAction((m.click_action as "paste" | "copy") ?? "paste");
      setFollowMouse((m.follow_mouse as boolean) ?? true);
    });
  }, []);

  const save = async (
    patch: Partial<{ hotkey: string; click_action: string; follow_mouse: boolean }>,
  ) => {
    await invoke("save_emoji_settings", {
      hotkey: patch.hotkey ?? hotkey,
      click_action: patch.click_action ?? action,
      follow_mouse: patch.follow_mouse ?? followMouse,
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>呼出表情面板热键</Label>
        <HotkeyRecorder
          value={hotkey}
          onSave={async (combo) => {
            await save({ hotkey: combo });
          }}
          hint="按此热键弹出表情悬浮面板（统一呼出模式下禁用）"
        />
      </div>
      <div className="space-y-1">
        <Label>点击表情后</Label>
        <div className="flex gap-2">
          {(["paste", "copy"] as const).map((a) => (
            <button
              key={a}
              onClick={() => save({ click_action: a })}
              className={
                "rounded-md border px-3 py-1 text-xs " +
                (action === a ? "border-primary text-primary" : "text-muted-foreground")
              }
            >
              {a === "paste" ? "粘贴到原窗口" : "复制到剪贴板"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">面板跟随鼠标</div>
          <div className="text-xs text-muted-foreground">
            呼出时出现在鼠标附近，否则停留在上次位置
          </div>
        </div>
        <button
          onClick={() => save({ follow_mouse: !followMouse })}
          className={
            "relative h-6 w-11 rounded-full transition-colors " +
            (followMouse ? "bg-primary" : "bg-muted")
          }
        >
          <span
            className={
              "absolute top-0.5 size-5 rounded-full bg-white transition-all " +
              (followMouse ? "left-[22px]" : "left-0.5")
            }
          />
        </button>
      </div>
    </div>
  );
}
