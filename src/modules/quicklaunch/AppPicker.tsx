import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Search, FileQuestion } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useFileIcons } from "@/hooks/useFileIcons";
import { gridIconSize, gridFontScale } from "@/lib/grid";
import { cn } from "@/lib/utils";

export interface ScannedApp {
  name: string;
  path: string;
  /** 与某个已固定条目指向同一目标 */
  fixed: boolean;
  /** 全局前台使用次数 */
  usage_count: number;
}

/** 已安装应用选择器：网格展示扫描结果，已固定的置灰禁选，勾选后批量走既有添加流程 */
export function AppPicker({
  open,
  onClose,
  onAdd,
  gridSize,
}: {
  open: boolean;
  onClose: () => void;
  /** 返回选中的路径（可能多条），由父组件执行 quicklaunch_add_from_path */
  onAdd: (paths: string[]) => void;
  gridSize?: number;
}) {
  const cell = Math.max(gridSize ?? 72, 56);
  const [apps, setApps] = useState<ScannedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { icons, loadIcon } = useFileIcons();

  useEffect(() => {
    if (!open) return;
    setApps(null);
    setError(null);
    setPicked(new Set());
    setQ("");
    invoke<ScannedApp[]>("quicklaunch_scan_apps")
      .then(setApps)
      .catch((e) => {
        console.error("scan apps failed:", e);
        setError(String(e));
        setApps([]);
      });
  }, [open]);

  const filtered = useMemo(
    () =>
      (apps ?? []).filter((a) =>
        a.name.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [apps, q],
  );

  const toggle = (p: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const browse = async () => {
    const picked2 = await openFileDialog({
      multiple: true,
      filters: [{ name: "所有文件", extensions: ["*"] }],
    });
    if (picked2) {
      onClose();
      onAdd(Array.isArray(picked2) ? picked2 : [picked2]);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title="添加已安装的应用">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b p-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索应用…"
            autoFocus
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {apps === null ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              正在扫描开始菜单…
            </div>
          ) : error ? (
            <div className="py-8 text-center text-xs text-destructive">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              没有匹配的应用
            </div>
          ) : (
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(auto-fill, ${cell}px)` }}
            >
              {filtered.map((a) => {
                if (!icons[a.path]) loadIcon(a.path);
                const selected = picked.has(a.path);
                return (
                  <button
                    key={a.path}
                    title={a.fixed ? `${a.name}（已固定）` : a.name}
                    onClick={() => !a.fixed && toggle(a.path)}
                    disabled={a.fixed}
                    className={cn(
                      "relative flex flex-col items-center justify-center gap-0.5 rounded-md border border-transparent p-1 transition-colors",
                      a.fixed
                        ? "cursor-not-allowed opacity-45"
                        : "cursor-pointer hover:bg-accent/50",
                      selected && "border-primary bg-accent ring-2 ring-primary/40",
                    )}
                    style={{ height: cell }}
                  >
                    {icons[a.path] ? (
                      <img
                        src={`data:image/png;base64,${icons[a.path]}`}
                        className="object-contain"
                        style={{
                          width: gridIconSize(cell),
                          height: gridIconSize(cell),
                        }}
                        alt=""
                      />
                    ) : (
                      <FileQuestion
                        className="text-muted-foreground"
                        style={{
                          width: gridIconSize(cell),
                          height: gridIconSize(cell),
                        }}
                      />
                    )}
                    <span
                      className="w-full truncate text-center leading-tight text-muted-foreground"
                      style={{ fontSize: `${gridFontScale(cell)}px` }}
                    >
                      {a.name}
                    </span>
                    {a.fixed && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1 text-[8px] leading-3 text-white">
                        ✓ 已固定
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <Button variant="outline" size="sm" onClick={browse}>
            浏览文件…
          </Button>
          <Button
            size="sm"
            disabled={picked.size === 0}
            onClick={() => {
              const ps = [...picked];
              onClose();
              onAdd(ps);
            }}
          >
            添加所选{picked.size > 0 ? `（${picked.size}）` : ""}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
