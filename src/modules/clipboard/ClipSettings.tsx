import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { toast } from "@/lib/toast";
import type { ClipboardConfig } from "./config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface StatsDto {
  total: number;
  text: number;
  image: number;
  files: number;
  db_size: number;
  media_size: number;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Segmented<T extends number | string>({  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded px-2 py-1 text-xs transition-colors",
            value === o.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ClipSettings({
  maxItems,
  hotkey,
  followMouse,
  cfg,
  onUpdate,
  onMaxItems,
  onHotkey,
  onFollowMouse,
}: {
  maxItems: number;
  hotkey: string;
  followMouse: boolean;
  cfg: ClipboardConfig;
  onUpdate: (patch: Partial<ClipboardConfig>) => void;
  onMaxItems: () => void;
  onHotkey: () => void;
  onFollowMouse: () => void;
}) {
  const [maxInput, setMaxInput] = useState(String(maxItems));
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [pendingLimit, setPendingLimit] = useState<number | null>(null);

  // 纯配置（监听规则/弹窗显示）由父组件 Clippage 的共享 Hook 持有，此处受控
  const adv = cfg;
  const saveAdv = onUpdate;

  // 格子尺寸滑块：拖动草稿值，松手落盘
  const [cellDraft, setCellDraft] = useState(adv.cellSize);
  useEffect(() => setCellDraft(adv.cellSize), [adv.cellSize]);

  useEffect(() => setMaxInput(String(maxItems)), [maxItems]);

  useEffect(() => {
    invoke<StatsDto>("get_stats").then(setStats).catch(console.error);
  }, []);

  const saveMax = async (v?: string) => {
    const n = parseInt(v ?? maxInput, 10);
    if (Number.isNaN(n) || n < 200 || n > 2000) return;
    // 先取最新条数：低于当前条数时需用户确认，避免静默清理
    const st = await invoke<StatsDto>("get_stats").catch(() => null);
    if (st) setStats(st);
    if (n < (st?.total ?? 0)) {
      setPendingLimit(n);
      return;
    }
    await applyMax(n);
  };

  const applyMax = async (n: number) => {
    await invoke("set_max_items", { maxItems: n });
    setMaxInput(String(n));
    setStats(await invoke<StatsDto>("get_stats"));
    onMaxItems();
  };

  const saveHotkey = async (combo: string): Promise<string | void> => {
    try {
      await invoke("set_hotkey", { hotkey: combo });
      onHotkey();
    } catch (e) {
      onHotkey();
      return String(e);
    }
  };

  const resetSize = async () => {
    const w = await WebviewWindow.getByLabel("clipboard_popup");
    await w?.setSize(new PhysicalSize(620, 480));
    saveAdv({ popupSize: null });
  };

  const clearHistory = async () => {
    const n = await invoke<number>("clear_history");
    setConfirmClear(false);
    setStats(await invoke<StatsDto>("get_stats"));
    toast(`已清除 ${n} 条记录（固定条目保留）`);
  };

  const clearAllHistory = async () => {
    const n = await invoke<number>("clear_all_history");
    setConfirmClearAll(false);
    setStats(await invoke<StatsDto>("get_stats"));
    toast(`已清空全部 ${n} 条记录（含固定条目）`);
  };

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">基础设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>历史上限（条）</Label>
            <div className="flex items-center gap-3">
              <Slider
                min={200}
                max={2000}
                step={50}
                value={[Number(maxInput) || 500]}
                onValueChange={([v]) => setMaxInput(String(v))}
                onValueCommit={([v]) => saveMax(String(v))}
                className="flex-1"
              />
              <Input
                type="number"
                min={200}
                max={2000}
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                onBlur={() => saveMax()}
                onKeyDown={(e) => e.key === "Enter" && saveMax()}
                className="w-28"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              达到上限时自动清理最旧条目，固定条目永不清理。
            </p>
          </div>

          <div className="space-y-1">
            <Label>全局呼出热键</Label>
            <HotkeyRecorder
              value={hotkey}
              onSave={saveHotkey}
              hint="点击后按下组合键即可录制，支持 Ctrl / Shift / Alt / Win"
            />
          </div>

          <div className="space-y-1">
            <Label>弹窗位置</Label>
            <Segmented
              value={followMouse ? "mouse" : "fixed"}
              options={[
                { value: "mouse", label: "跟随鼠标" },
                { value: "fixed", label: "固定位置" },
              ]}
              onChange={async (v) => {
                await invoke("set_follow_mouse", { follow: v === "mouse" });
                onFollowMouse();
              }}
            />
            <p className="text-xs text-muted-foreground">
              固定位置模式下，可拖动弹窗顶部手柄调整位置，位置自动保存。
            </p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="space-y-0.5">
              <Label>弹窗尺寸</Label>
              <p className="text-xs text-muted-foreground">拖动弹窗边缘调整，尺寸自动保存</p>
            </div>
            <Button variant="outline" onClick={resetSize}>
              恢复默认尺寸
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">监听规则</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">记录文本</div>
              <div className="text-xs text-muted-foreground">复制文本时保存到历史</div>
            </div>
            <Switch checked={adv.recordText} onCheckedChange={(v) => saveAdv({ recordText: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">记录图片</div>
              <div className="text-xs text-muted-foreground">复制图片时保存到历史</div>
            </div>
            <Switch checked={adv.recordImage} onCheckedChange={(v) => saveAdv({ recordImage: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">记录文件</div>
              <div className="text-xs text-muted-foreground">复制文件时保存到历史</div>
            </div>
            <Switch checked={adv.recordFiles} onCheckedChange={(v) => saveAdv({ recordFiles: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">忽略短文本</div>
              <div className="text-xs text-muted-foreground">
                少于该字符数的文本不记录（0 为关闭）
              </div>
            </div>
            <Input
              type="number"
              min={0}
              max={100}
              value={String(adv.minTextLen)}
              onChange={(e) => saveAdv({ minTextLen: Math.max(0, Number(e.target.value) || 0) })}
              className="w-20"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            重复内容会自动合并更新时间，不会产生多余条目。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">弹窗显示</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">格子尺寸</div>
              <div className="text-xs text-muted-foreground">图片与文件格子的边长</div>
            </div>
            <div className="flex w-44 items-center gap-2">
              <Slider
                min={48}
                max={128}
                step={4}
                value={[cellDraft]}
                onValueChange={([v]) => setCellDraft(v)}
                onValueCommit={([v]) => saveAdv({ cellSize: v })}
              />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {cellDraft}px
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">文本预览行数</div>
              <div className="text-xs text-muted-foreground">文本卡片最多显示几行</div>
            </div>
            <div className="w-44">
              <Segmented
                value={adv.textLines}
                options={[
                  { value: 1, label: "1 行" },
                  { value: 2, label: "2 行" },
                  { value: 3, label: "3 行" },
                ]}
                onChange={(v) => saveAdv({ textLines: v })}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">显示时间戳</div>
              <div className="text-xs text-muted-foreground">
                在图片/文件格与文本卡上显示 MM/DD HH:mm
              </div>
            </div>
            <Switch
              checked={adv.showTimestamps}
              onCheckedChange={(v) => saveAdv({ showTimestamps: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">数据统计</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">总条数</div>
            <div className="text-lg font-semibold">{stats?.total ?? "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">文本</div>
            <div className="text-lg font-semibold">{stats?.text ?? "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">图片</div>
            <div className="text-lg font-semibold">{stats?.image ?? "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">文件</div>
            <div className="text-lg font-semibold">{stats?.files ?? "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">数据库</div>
            <div className="text-lg font-semibold">{stats ? fmtBytes(stats.db_size) : "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">图片存储</div>
            <div className="text-lg font-semibold">{stats ? fmtBytes(stats.media_size) : "-"}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">数据维护</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => invoke("open_data_dir")}>
              打开数据目录
            </Button>
            <Button variant="destructive" onClick={() => setConfirmClear(true)}>
              清空历史（保留固定条目）
            </Button>
            <Button variant="destructive" onClick={() => setConfirmClearAll(true)}>
              清空全部（含固定条目）
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            数据库每 6 小时自动备份一次（保留最近 5 份），大文件自动回收空间。
          </p>
        </CardContent>
      </Card>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空剪贴板历史</DialogTitle>
            <DialogDescription>
              将删除所有未被固定的记录，此操作不可撤销。确定继续？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={clearHistory}>
              清空
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空全部剪贴板记录</DialogTitle>
            <DialogDescription>
              将删除所有记录，包括固定条目，此操作不可撤销。确定继续？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClearAll(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={clearAllHistory}>
              全部清空
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingLimit != null} onOpenChange={(open) => !open && setPendingLimit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>降低历史上限</DialogTitle>
            <DialogDescription>
              当前共有 {stats?.total ?? 0} 条记录，新上限 {pendingLimit ?? 0} 条，将超出{" "}
              {Math.max(0, (stats?.total ?? 0) - (pendingLimit ?? 0))} 条。保存后将自动清理最旧的普通记录
              （固定条目保留），此操作不可撤销。确定继续？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingLimit(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingLimit != null) applyMax(pendingLimit);
                setPendingLimit(null);
              }}
            >
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
