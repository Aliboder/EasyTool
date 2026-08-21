import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getConfig } from "@/lib/api";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingRow } from "@/components/setting-row";

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
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">通用</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="呼出表情面板热键" hint="按此热键弹出表情悬浮面板（统一呼出模式下禁用）">
            <HotkeyRecorder
              value={hotkey}
              onSave={async (combo) => {
                await save({ hotkey: combo });
              }}
            />
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">行为</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="点击表情后" hint="选择点击表情后的操作">
            <div className="flex gap-1">
              {(["paste", "copy"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => save({ click_action: a })}
                  className={`rounded-md border px-3 py-1 text-xs ${
                    action === a ? "border-primary text-primary" : "text-muted-foreground"
                  }`}
                >
                  {a === "paste" ? "粘贴" : "复制"}
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow title="面板跟随鼠标" hint="呼出时出现在鼠标附近，否则停留在上次位置">
            <Switch
              checked={followMouse}
              onCheckedChange={(checked) => save({ follow_mouse: checked })}
            />
          </SettingRow>
        </CardContent>
      </Card>
    </div>
  );
}