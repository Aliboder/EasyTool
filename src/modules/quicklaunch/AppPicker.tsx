import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Search, FileQuestion } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useFileIcons } from "@/hooks/useFileIcons";
import { cn } from "@/lib/utils";

interface ScannedApp {
  name: string;
  path: string;
}

/** 已安装应用选择器：扫描开始菜单快捷方式，勾选后批量走既有添加流程 */
export function AppPicker({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  /** 返回选中的路径（可能多条），由父组件执行 quicklaunch_add_from_path */
  onAdd: (paths: string[]) => void;
}) {
  const [apps, setApps] = useState<ScannedApp[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { icons, loadIcon } = useFileIcons();

  useEffect(() => {
    if (!open) return;
    setApps(null);
    setPicked(new Set());
    setQ("");
    invoke<ScannedApp[]>("quicklaunch_scan_apps")
      .then(setApps)
      .catch((e) => {
        console.error("scan apps failed:", e);
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
        <div className="flex-1 overflow-y-auto p-1">
          {apps === null ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              正在扫描开始菜单…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              没有匹配的应用
            </div>
          ) : (
            filtered.map((a) => {
              if (!icons[a.path]) loadIcon(a.path);
              const on = picked.has(a.path);
              return (
                <button
                  key={a.path}
                  onClick={() => toggle(a.path)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50",
                    on && "bg-accent",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    readOnly
                    className="pointer-events-none accent-primary"
                  />
                  {icons[a.path] ? (
                    <img
                      src={`data:image/png;base64,${icons[a.path]}`}
                      className="size-5 shrink-0 object-contain"
                      alt=""
                    />
                  ) : (
                    <FileQuestion className="size-5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
                </button>
              );
            })
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
