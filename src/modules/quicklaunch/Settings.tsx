import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingRow } from "@/components/setting-row";
import type { QuicklaunchConfig } from "./Page";

interface QuicklaunchSettingsProps {
  cfg: QuicklaunchConfig;
  onUpdate: (patch: Partial<QuicklaunchConfig>) => void;
}

export function QuicklaunchSettings({ cfg, onUpdate }: QuicklaunchSettingsProps) {
  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">显示</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="默认视图" hint="选择网格或列表视图">
            <div className="flex gap-1">
              {(
                [
                  ["grid", "网格"],
                  ["list", "列表"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => onUpdate({ viewMode: id })}
                  className={`rounded-md border px-3 py-1 text-xs ${
                    cfg.viewMode === id
                      ? "border-primary text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </SettingRow>
          {cfg.viewMode === "grid" && (
            <SettingRow title="网格大小" hint="调节图标卡片尺寸">
              <div className="flex w-40 items-center gap-2">
                <Slider
                  min={48}
                  max={128}
                  step={4}
                  value={[cfg.gridSize]}
                  onValueChange={([v]) => onUpdate({ gridSize: v })}
                />
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {cfg.gridSize}px
                </span>
              </div>
            </SettingRow>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">行为</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="默认排序" hint="选择排序方式">
            <Select
              value={cfg.sortBy}
              onValueChange={(v) => {
                onUpdate({ sortBy: v as QuicklaunchConfig["sortBy"] });
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">手动排序</SelectItem>
                <SelectItem value="name">按名称</SelectItem>
                <SelectItem value="created_at">按添加时间</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow title="单击打开" hint="开启后单击即可打开项目">
            <Switch
              checked={cfg.singleClickOpen}
              onCheckedChange={(checked) => onUpdate({ singleClickOpen: checked })}
            />
          </SettingRow>
          <SettingRow title="显示文件后缀名" hint="开启后显示文件扩展名">
            <Switch
              checked={cfg.showExtension}
              onCheckedChange={(checked) => onUpdate({ showExtension: checked })}
            />
          </SettingRow>
        </CardContent>
      </Card>
    </div>
  );
}
