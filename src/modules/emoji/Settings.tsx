import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingRow } from "@/components/setting-row";
import type { EmojiConfig } from "./config";

interface EmojiSettingsProps {
  cfg: EmojiConfig;
  onUpdate: (patch: Partial<EmojiConfig>) => void;
}

export function EmojiSettings({ cfg, onUpdate }: EmojiSettingsProps) {
  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">显示</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="Emoji 网格大小" hint="调节内置表情的格子尺寸">
            <div className="flex w-40 items-center gap-2">
              <Slider
                min={28}
                max={64}
                step={4}
                value={[cfg.emojiGridSize]}
                onValueChange={([v]) => onUpdate({ emojiGridSize: v })}
              />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {cfg.emojiGridSize}px
              </span>
            </div>
          </SettingRow>
          <SettingRow title="图片表情网格大小" hint="调节图片表情的格子尺寸">
            <div className="flex w-40 items-center gap-2">
              <Slider
                min={40}
                max={96}
                step={4}
                value={[cfg.customGridSize]}
                onValueChange={([v]) => onUpdate({ customGridSize: v })}
              />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {cfg.customGridSize}px
              </span>
            </div>
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
                  onClick={() => onUpdate({ clickAction: a })}
                  className={`rounded-md border px-3 py-1 text-xs ${
                    cfg.clickAction === a ? "border-primary text-primary" : "text-muted-foreground"
                  }`}
                >
                  {a === "paste" ? "粘贴" : "复制"}
                </button>
              ))}
            </div>
          </SettingRow>
        </CardContent>
      </Card>
    </div>
  );
}
