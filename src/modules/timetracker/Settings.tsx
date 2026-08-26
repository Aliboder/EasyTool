import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2, Loader2, Search, Undo2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingRow } from "@/components/setting-row";
import { toast } from "@/lib/toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TimetrackerConfig } from "./config";
import type { AppListItem, CategoryRule } from "./types";
import { CATEGORY_LABELS, categoryColor } from "./types";
import { HotkeyRecorder } from "@/components/hotkey-recorder";

interface Props {
  cfg: TimetrackerConfig;
  onUpdate: (patch: Partial<TimetrackerConfig>) => void;
}

export function TimetrackerSettings({ cfg, onUpdate }: Props) {
  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">数据采集</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="记录窗口标题" hint="记录当前窗口的标题信息">
            <Switch
              checked={cfg.trackWindowTitle}
              onCheckedChange={(v) => onUpdate({ trackWindowTitle: v })}
            />
          </SettingRow>
          <SettingRow title="离开检测" hint="无键鼠输入超过该时长不计入活跃使用（0 分钟关闭检测）">
            <div className="flex w-40 items-center gap-2">
              <Slider
                value={[Math.round(cfg.afkThresholdSec / 60)]}
                onValueChange={([v]) => onUpdate({ afkThresholdSec: v * 60 })}
                min={0}
                max={10}
                step={1}
              />
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {cfg.afkThresholdSec === 0
                  ? "关闭"
                  : `${Math.round(cfg.afkThresholdSec / 60)}分`}
              </span>
            </div>
          </SettingRow>
          <SettingRow
            title="播放声音算活跃"
            hint="系统有非静音声音播放时不算离开（看视频、直播、听音乐）"
          >
            <Switch
              checked={cfg.mediaPlayingActive}
              onCheckedChange={(v) => onUpdate({ mediaPlayingActive: v })}
            />
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">显示设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="排行榜显示数量" hint="应用排行展示条数">
            <div className="flex w-40 items-center gap-2">
              <Slider
                value={[cfg.topN]}
                onValueChange={([v]) => onUpdate({ topN: v })}
                min={5}
                max={20}
                step={1}
              />
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {cfg.topN}
              </span>
            </div>
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">快捷键</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <SettingRow title="呼出时长统计" hint="按此热键打开时长统计窗口">
            <HotkeyRecorder
              value={cfg.hotkey}
              onSave={(v) => {
                onUpdate({ hotkey: v });
              }}
            />
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">应用分类</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            直接为某个软件指定分类（会覆盖自动归类）；点击「恢复自动」则交回规则判定。
          </p>
          <AppManagement />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">分类规则</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            自定义正则规则，命中应用名或窗口标题即归入所选分类；点击删除后自动重新分类已有应用。
          </p>
          <RulesEditor />
        </CardContent>
      </Card>
    </div>
  );
}

/** 应用分类管理：所有已识别软件 + 分类下拉直接改 + 恢复自动 */
function AppManagement() {
  const [apps, setApps] = useState<AppListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const loadApps = async () => {
    try {
      setApps(await invoke<AppListItem[]>("timetracker_list_apps"));
    } catch (e) {
      console.error("加载应用列表失败", e);
      setApps([]);
    }
  };

  useEffect(() => {
    loadApps();
  }, []);

  const filtered = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    return q ? apps.filter((a) => a.app_name.toLowerCase().includes(q)) : apps;
  }, [apps, query]);

  const setCategory = async (app: AppListItem, category: string) => {
    if (category === app.category) return;
    setBusy(true);
    try {
      await invoke("timetracker_set_category", { appId: app.id, category });
      toast(`已将「${app.app_name}」设为${CATEGORY_LABELS[category] ?? category}`);
      setApps(
        (cur) =>
          cur?.map((a) => (a.id === app.id ? { ...a, category, category_locked: true } : a)) ??
          null,
      );
    } catch (e) {
      toast(String(e));
    }
    setBusy(false);
  };

  const reset = async (app: AppListItem) => {
    setBusy(true);
    try {
      await invoke("timetracker_reset_app_category", { appId: app.id });
      toast(`已恢复「${app.app_name}」的自动分类`);
      // 后端按规则重新算分类，本地重载以展示正确的分类
      await loadApps();
    } catch (e) {
      toast(String(e));
    }
    setBusy(false);
  };

  if (apps === null) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        加载中…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索软件名称"
          className="pl-7"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground">
          {apps.length === 0 ? "还没有记录到任何软件" : "没有匹配的软件"}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((app) => (
            <div key={app.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{app.app_name}</div>
                <div className="truncate text-[11px] text-muted-foreground" title={app.exe_path}>
                  {app.exe_path}
                </div>
              </div>
              <Select
                value={app.category}
                onValueChange={(v) => setCategory(app, v)}
              >
                <SelectTrigger className="h-8 w-28 shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {app.category_locked && (
                <button
                  type="button"
                  onClick={() => reset(app)}
                  disabled={busy}
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  title="恢复自动分类"
                >
                  <Undo2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 用户自定义分类规则编辑器：正则命中 app 名或窗口标题 → 归入指定分类。
 * 规则按优先级（后加的优先）匹配，首条命中即定分类；编辑后自动重跑所有已有应用的分类。
 */
function RulesEditor() {
  const [rules, setRules] = useState<CategoryRule[] | null>(null);
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState<string>("efficiency");
  const [busy, setBusy] = useState(false);

  const loadRules = async () => {
    try {
      const data = await invoke<CategoryRule[]>("timetracker_list_rules");
      setRules(data);
    } catch (e) {
      console.error("加载分类规则失败", e);
      setRules([]);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const afterMutate = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      await loadRules();
      // 规则变了 → 重跑所有已有应用分类，让旧数据立即按新规则归类
      await invoke("timetracker_reapply_rules");
      toast(msg);
    } catch (e) {
      toast(String(e));
    }
    setBusy(false);
  };

  const addRule = async () => {
    if (!pattern.trim()) return toast("请输入正则");
    await afterMutate(
      () => invoke("timetracker_add_rule", { pattern: pattern.trim(), category }),
      "已添加规则并重新分类",
    );
    setPattern("");
  };

  if (rules === null) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        加载中…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 新增行 */}
      <div className="flex items-center gap-2">
        <Input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addRule()}
          placeholder="正则，如 Code|IntelliJ|Claude"
          className="min-w-0 flex-1"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-28 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={addRule} disabled={busy} className="shrink-0">
          <Plus className="size-4" />
          添加
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        正则用「|」表示或，大小写不敏感。命中应用名或窗口标题即归入所选分类；后加规则优先。
      </p>

      {/* 规则列表 */}
      {rules.length === 0 ? (
        <div className="py-3 text-center text-xs text-muted-foreground">
          暂无自定义规则，命中内置关键词以外的应用会归为「其他」
        </div>
      ) : (
        <div className="space-y-1.5">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
              <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {r.pattern}
              </code>
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-white"
                style={{ backgroundColor: categoryColor(r.category) }}
              >
                {CATEGORY_LABELS[r.category] || "其他"}
              </span>
              <button
                type="button"
                onClick={() => afterMutate(() => invoke("timetracker_delete_rule", { id: r.id }), "已删除规则并重新分类")}
                disabled={busy}
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                title="删除规则"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
