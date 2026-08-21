import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
};

export function loadSearchSettings(cfg: unknown): SearchSettingsData {
  const m = (cfg as { modules?: Record<string, any> })?.modules?.search ?? {};
  const cols = (m.columns as Partial<typeof SEARCH_DEFAULTS.columns> | undefined) ?? {};
  const sb = m.sort_by as string;
  const vm = m.view_mode as string;
  return {
    hotkey: (m.hotkey as string) ?? SEARCH_DEFAULTS.hotkey,
    followMouse: (m.follow_mouse as boolean) ?? SEARCH_DEFAULTS.followMouse,
    sortBy: (["name", "path", "size", "modified"].includes(sb) ? sb : "name") as typeof SEARCH_DEFAULTS.sortBy,
    sortDesc: (m.sort_desc as boolean) ?? SEARCH_DEFAULTS.sortDesc,
    columns: {
      path: (cols.path as boolean | undefined) ?? SEARCH_DEFAULTS.columns.path,
      size: (cols.size as boolean | undefined) ?? SEARCH_DEFAULTS.columns.size,
      modified: (cols.modified as boolean | undefined) ?? SEARCH_DEFAULTS.columns.modified,
      thumbnail: (cols.thumbnail as boolean | undefined) ?? SEARCH_DEFAULTS.columns.thumbnail,
    },
    viewMode: (vm === "grid" ? "grid" : "list") as typeof SEARCH_DEFAULTS.viewMode,
    gridSize: (m.grid_size as number) ?? SEARCH_DEFAULTS.gridSize,
    autoSelectFirst: (m.auto_select_first as boolean) ?? SEARCH_DEFAULTS.autoSelectFirst,
    showResultsCount: (m.show_results_count as boolean) ?? SEARCH_DEFAULTS.showResultsCount,
    clickToOpen: (m.click_to_open as boolean) ?? SEARCH_DEFAULTS.clickToOpen,
  };
}

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

export function SearchSettings({
  onRefresh,
  initial,
  onSave,
}: {
  onRefresh: () => void;
  initial: SearchSettingsData;
  onSave: (settings: SearchSettingsData) => void;
}) {
  const [s, setS] = useState<SearchSettingsData>(initial);

  useEffect(() => {
    setS(initial);
  }, [initial]);

  const save = async (patch: Partial<SearchSettingsData>) => {
    const next = { ...s, ...patch };
    setS(next);
    await invoke("search_save_settings", {
      settings: {
        hotkey: next.hotkey,
        follow_mouse: next.followMouse,
        sort_by: next.sortBy,
        sort_desc: next.sortDesc,
        columns: next.columns,
        view_mode: next.viewMode,
        grid_size: next.gridSize,
        auto_select_first: next.autoSelectFirst,
        show_results_count: next.showResultsCount,
        click_to_open: next.clickToOpen,
      },
    });
    onSave(next);
    onRefresh();
  };

  const setToggle = (key: keyof Pick<SearchSettingsData, "followMouse" | "autoSelectFirst" | "showResultsCount" | "clickToOpen">, v: boolean) => {
    save({ [key]: v } as Partial<SearchSettingsData>);
  };

  const toggleColumn = (key: keyof SearchSettingsData["columns"]) => {
    save({ columns: { ...s.columns, [key]: !s.columns[key] } });
  };

  const setSortBy = (v: SearchSettingsData["sortBy"]) => save({ sortBy: v });
  const setSortDesc = (v: boolean) => save({ sortDesc: v });

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">通用</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="呼出搜索弹窗热键" hint="按此热键弹出搜索窗（统一呼出模式下禁用）">
            <HotkeyRecorder
              value={s.hotkey}
              onSave={async (combo) => {
                await save({ hotkey: combo });
              }}
            />
          </SettingRow>
          <SettingRow title="弹窗跟随鼠标" hint="呼出时出现在鼠标附近，否则停留在上次位置">
            <Switch checked={s.followMouse} onCheckedChange={(v) => setToggle("followMouse", v)} />
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
                  onClick={() => save({ viewMode: id })}
                  className={cn(
                    "rounded-md border px-3 py-1 text-xs",
                    s.viewMode === id ? "border-primary text-primary" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </SettingRow>
          {s.viewMode === "grid" && (
            <SettingRow title="网格大小" hint="网格卡片与图标尺寸">
              <div className="flex w-40 items-center gap-2">
                <Slider
                  min={48}
                  max={128}
                  step={4}
                  value={[s.gridSize]}
                  onValueChange={([v]) => {
                    setS({ ...s, gridSize: v });
                    save({ gridSize: v });
                  }}
                />
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {s.gridSize}px
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
                    s.columns[key] ? "border-primary text-primary" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow title="显示结果数" hint="结果栏右侧显示命中条数">
            <Switch checked={s.showResultsCount} onCheckedChange={(v) => setToggle("showResultsCount", v)} />
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
              <Select value={s.sortBy} onValueChange={setSortBy}>
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
              <Select value={String(s.sortDesc)} onValueChange={(v) => setSortDesc(v === "true")}>
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
            <Switch checked={s.autoSelectFirst} onCheckedChange={(v) => setToggle("autoSelectFirst", v)} />
          </SettingRow>
          <SettingRow title="单击打开" hint="关闭时单击仅选中、双击打开">
            <Switch checked={s.clickToOpen} onCheckedChange={(v) => setToggle("clickToOpen", v)} />
          </SettingRow>
        </CardContent>
      </Card>
    </div>
  );
}