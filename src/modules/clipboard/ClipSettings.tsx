import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
  cfg,
  onUpdate,
}: {
  cfg: ClipboardConfig;
  onUpdate: (patch: Partial<ClipboardConfig>) => void;
}) {
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // 纯配置（监听规则/显示设置）由父组件 Clippage 的共享 Hook 持有，此处受控
  const adv = cfg;
  const saveAdv = onUpdate;

  useEffect(() => {
    invoke<StatsDto>("get_stats").then(setStats).catch(console.error);
  }, []);

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
          <CardTitle className="text-base">显示</CardTitle>
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
                value={[adv.cellSize]}
                onValueChange={([v]) => saveAdv({ cellSize: v })}
              />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {adv.cellSize}px
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
    </div>
  );
}
