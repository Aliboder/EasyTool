import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function ClipSettings({
  maxItems,
  hotkey,
  onMaxItems,
  onHotkey,
}: {
  maxItems: number;
  hotkey: string;
  onMaxItems: () => void;
  onHotkey: () => void;
}) {
  const [maxInput, setMaxInput] = useState(String(maxItems));
  const [hotkeyInput, setHotkeyInput] = useState(hotkey);
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  useEffect(() => setMaxInput(String(maxItems)), [maxItems]);
  useEffect(() => setHotkeyInput(hotkey), [hotkey]);

  useEffect(() => {
    invoke<StatsDto>("get_stats").then(setStats).catch(console.error);
  }, []);

  const saveMax = async () => {
    const n = parseInt(maxInput, 10);
    if (Number.isNaN(n) || n < 1 || n > 100000) return;
    await invoke("set_max_items", { maxItems: n });
    onMaxItems();
  };

  const saveHotkey = async () => {
    await invoke("set_hotkey", { hotkey: hotkeyInput });
    onHotkey();
  };

  const clearHistory = async () => {
    const n = await invoke<number>("clear_history");
    setConfirmClear(false);
    setStats(await invoke<StatsDto>("get_stats"));
    alert(`已清除 ${n} 条记录（固定条目保留）`);
  };

  const clearAllHistory = async () => {
    const n = await invoke<number>("clear_all_history");
    setConfirmClearAll(false);
    setStats(await invoke<StatsDto>("get_stats"));
    alert(`已清空全部 ${n} 条记录（含固定条目）`);
  };

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">常规</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="max-items">历史上限（条）</Label>
              <Input
                id="max-items"
                type="number"
                min={1}
                max={100000}
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
              />
            </div>
            <Button onClick={saveMax}>保存</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            达到上限时自动清理最旧的普通条目，被固定的条目永不清理。
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="clip-hotkey">全局呼出热键</Label>
              <Input
                id="clip-hotkey"
                value={hotkeyInput}
                onChange={(e) => setHotkeyInput(e.target.value)}
                placeholder="如 Ctrl+Shift+V"
              />
            </div>
            <Button onClick={saveHotkey}>保存</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            格式：修饰键用 + 连接（Ctrl、Shift、Alt、Win）。保存后立即生效。
          </p>
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
          <CardTitle className="text-base">数据管理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button variant="outline" onClick={() => invoke("open_data_dir")}>
            打开数据目录
          </Button>
          <Button variant="destructive" onClick={() => setConfirmClear(true)}>
            清空历史（保留固定条目）
          </Button>
          <Button variant="destructive" onClick={() => setConfirmClearAll(true)}>
            清空全部（含固定条目）
          </Button>
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