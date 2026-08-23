import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { SettingRow } from "@/components/setting-row";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SearchSettingsData {
  hotkey: string;
  followMouse: boolean;
  sortBy: "name" | "path" | "size" | "modified";
  sortDesc: boolean;
  columns: { path: boolean; size: boolean; modified: boolean; thumbnail: boolean };
  viewMode: "list" | "grid";
  gridSize: number;
  autoSelectFirst: boolean;
  showResultsCount: boolean;
  clickToOpen: boolean;
  /** 「应用」Tab 独立排序记忆 */
  appSortBy: "name" | "usage";
  appSortDesc: boolean;
}

export const SEARCH_DEFAULTS: SearchSettingsData = {
  hotkey: "Ctrl+Shift+F",
  followMouse: true,
  sortBy: "name",
  sortDesc: false,
  columns: { path: true, size: true, modified: true, thumbnail: true },
  viewMode: "list",
  gridSize: 80,
  autoSelectFirst: true,
  showResultsCount: true,
  clickToOpen: false,
  appSortBy: "name",
  appSortDesc: false,
};

const SORT_BY_OPTIONS: { value: SearchSettingsData["sortBy"]; label: string }[] = [
  { value: "name", label: "名称" },
  { value: "path", label: "路径" },
  { value: "size", label: "大小" },
  { value: "modified", label: "修改时间" },
];

const SORT_DIR_OPTIONS: { value: boolean; label: string }[] = [
  { value: false, label: "升序 ↑" },
  { value: true, label: "降序 ↓" },
];

const COLUMN_OPTIONS: { key: keyof SearchSettingsData["columns"]; label: string }[] = [
  { key: "path", label: "路径" },
  { key: "size", label: "大小" },
  { key: "modified", label: "修改时间" },
  { key: "thumbnail", label: "缩略图" },
];

interface SearchSettingsProps {
  cfg: SearchSettingsData;
  onUpdate: (patch: Partial<SearchSettingsData>) => void;
}

export function SearchSettings({ cfg, onUpdate }: SearchSettingsProps) {
  const toggleColumn = (key: keyof SearchSettingsData["columns"]) => {
    onUpdate({ columns: { ...cfg.columns, [key]: !cfg.columns[key] } });
  };

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">通用</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="呼出搜索弹窗热键" hint="按此热键弹出搜索窗（统一呼出模式下禁用）">
            <HotkeyRecorder
              value={cfg.hotkey}
              onSave={(combo) => onUpdate({ hotkey: combo })}
            />
          </SettingRow>
          <SettingRow title="弹窗跟随鼠标" hint="呼出时出现在鼠标附近，否则停留在上次位置">
            <Switch checked={cfg.followMouse} onCheckedChange={(v) => onUpdate({ followMouse: v })} />
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">显示</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="结果视图" hint="列表为名称+路径明细，网格为图标卡片">
            <div className="flex gap-1">
              {(
                [
                  ["list", "列表"],
                  ["grid", "网格"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => onUpdate({ viewMode: id })}
                  className={cn(
                    "rounded-md border px-3 py-1 text-xs",
                    cfg.viewMode === id ? "border-primary text-primary" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </SettingRow>
          {cfg.viewMode === "grid" && (
            <SettingRow title="网格大小" hint="网格卡片与图标尺寸">
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
          <SettingRow title="结果列显示" hint="列表视图中展示的列">
            <div className="flex flex-wrap justify-end gap-1">
              {COLUMN_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => toggleColumn(key)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs",
                    cfg.columns[key] ? "border-primary text-primary" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow title="显示结果数" hint="结果栏右侧显示命中条数">
            <Switch checked={cfg.showResultsCount} onCheckedChange={(v) => onUpdate({ showResultsCount: v })} />
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">行为</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="默认排序" hint="排序依据与顺序">
            <div className="flex items-center gap-1.5">
              <Select value={cfg.sortBy} onValueChange={(v) => onUpdate({ sortBy: v as SearchSettingsData["sortBy"] })}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_BY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(cfg.sortDesc)} onValueChange={(v) => onUpdate({ sortDesc: v === "true" })}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_DIR_OPTIONS.map((o) => (
                    <SelectItem key={String(o.value)} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </SettingRow>
          <SettingRow title="自动选中第一个结果" hint="搜索后默认高亮第一项，回车即打开">
            <Switch checked={cfg.autoSelectFirst} onCheckedChange={(v) => onUpdate({ autoSelectFirst: v })} />
          </SettingRow>
          <SettingRow title="单击打开" hint="关闭时单击仅选中、双击打开">
            <Switch checked={cfg.clickToOpen} onCheckedChange={(v) => onUpdate({ clickToOpen: v })} />
          </SettingRow>
        </CardContent>
      </Card>
    </div>
  );
}