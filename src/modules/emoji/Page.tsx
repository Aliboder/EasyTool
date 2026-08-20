import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Search,
  Upload,
  FolderPlus,
  Trash2,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Drawer } from "@/components/ui/drawer";
import { EmojiSettings } from "./Settings";
import { loadCatalog, type Catalog, type GroupDto } from "./api";
import { SmartEmoji } from "./SmartEmoji";
import { toast } from "@/lib/toast";

const GROUP_TABS = [
  { id: "smileys", zh: "表情" },
  { id: "recent", zh: "最近" },
  { id: "favorite", zh: "收藏" },
  { id: "hearts", zh: "爱心" },
  { id: "gestures", zh: "手势" },
  { id: "people", zh: "人物" },
  { id: "people-active", zh: "人物活动" },
  { id: "animals", zh: "动物" },
  { id: "plants", zh: "植物" },
  { id: "food", zh: "食物" },
  { id: "sport", zh: "运动" },
  { id: "activities", zh: "活动娱乐" },
  { id: "transport", zh: "交通" },
  { id: "places", zh: "地点建筑" },
  { id: "sky", zh: "天空天气" },
  { id: "time", zh: "时间" },
  { id: "objects", zh: "物品" },
  { id: "tech", zh: "科技工具" },
  { id: "symbols", zh: "符号" },
  { id: "flags", zh: "旗帜" },
];

export function EmojiPage({ active = true }: { active?: boolean }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [tab, setTab] = useState("smileys");
  const [q, setQ] = useState("");
  const [customGroups, setCustomGroups] = useState<GroupDto[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  // 增量渲染：不限制总数，滚动到底加载下一批（避免一次性渲染 1900+ 节点）
  const [visible, setVisible] = useState(240);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listLenRef = useRef(0);
  const lastLoadRef = useRef(0);

  // 切换分类/搜索时：重置渲染批次（列表容器用 key 强制重建，滚动位置自然归零）
  useEffect(() => {
    setVisible(240);
  }, [tab, q]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 内容不足一屏：无需增量加载（条件恒真会误触发累积）
    if (el.scrollHeight <= el.clientHeight) return;
    // 节流：200ms 内只响应一次
    const now = Date.now();
    if (now - lastLoadRef.current < 200) return;
    const max = listLenRef.current;
    setVisible((v) => {
      if (v >= max) return v; // 已全部渲染，停止加载
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
        lastLoadRef.current = Date.now();
        return Math.min(v + 240, max);
      }
      return v;
    });
  }, []);

  const load = async () => {
    const t0 = performance.now();
    const c = await loadCatalog();
    invoke("log_frontend", {
      level: "info",
      msg: `[diag] emoji loadCatalog: ${(performance.now() - t0).toFixed(1)}ms, emoji=${c.emoji.length}, customs=${c.customs.length}`,
    }).catch(() => {});
    setCat(c);
  };
  useEffect(() => {
    load().catch(console.error);
  }, []);

  // keep-alive 下切回模块不重载（避免每次切换全量重建+重渲染卡顿）；
  // 动态数据（使用次数/收藏）只在跨窗口操作后可能变脏，窗口聚焦时刷新一次（同搜索页策略）
  useEffect(() => {
    if (!active) return;
    const onFocus = () => load().catch(console.error);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [active]);

  // 诊断：cat 加载完成后到内容渲染的耗时
  useEffect(() => {
    if (!cat) return;
    const t0 = performance.now();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        invoke("log_frontend", {
          level: "info",
          msg: `[diag] emoji first paint after cat: ${(performance.now() - t0).toFixed(1)}ms, batch=${visible}, emoji=${visibleEmoji.length}, customs=${visibleCustoms.length}`,
        }).catch(() => {});
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat]);

  const refreshCustom = async () => {
    const g = await invoke<GroupDto[]>("get_groups");
    setCustomGroups(g);
    await load();
  };

  const visibleEmoji = useMemo(() => {
    if (!cat) return [];
    const ql = q.trim().toLowerCase();
    let list = cat.emoji;
    if (tab === "recent") list = list.filter((e) => e.last_used_at != null);
    else if (tab === "favorite") return []; // 收藏 Tab 只显示图片表情
    else list = list.filter((e) => e.group === tab);
    if (ql) {
      list = list.filter(
        (e) =>
          e.name_en.toLowerCase().includes(ql) ||
          e.keywords_zh.some((k) => k.includes(q.trim())),
      );
    }
    return list;
  }, [cat, tab, q]);

  const visibleCustoms = useMemo(() => {
    if (!cat) return [];
    const ql = q.trim().toLowerCase();
    let list = cat.customs;
    if (tab === "favorite") {
      // 收藏 Tab = 图片表情库：显示全部
    } else if (tab === "recent") {
      list = list.filter((c) => c.last_used_at != null);
    } else {
      // 自定义分组 Tab：显示组内图片表情；普通分类 Tab：不含图片表情
      const gid = customGroups.find((g) => g.id === Number(tab))?.id;
      if (gid === undefined) return [];
      list = list.filter((c) => c.group_id === gid);
    }
    if (ql) list = list.filter((c) => c.name.toLowerCase().includes(ql));
    return list;
  }, [cat, customGroups, tab, q]);

  const onPick = async (kind: "emoji" | "custom", key: string) => {
    try {
      await invoke("apply_emoji", { kind, key });
    } catch (e) {
      toast(String(e));
      return;
    }
    // 使用后刷新统计（不阻塞交互，后台拉取最新数据）
    load().catch(console.error);
  };

  listLenRef.current = Math.max(visibleEmoji.length, visibleCustoms.length);

  return (
    <div className="relative flex h-full flex-col p-4">
      <>
      <div className="flex items-center gap-2 border-b pb-3">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索表情（中文/英文）…"
            className="w-full rounded-md border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <button
          onClick={async () => {
            const picked = await open({
              multiple: true,
              filters: [
                { name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
              ],
            });
            if (picked) {
              const paths = Array.isArray(picked) ? picked : [picked];
              await invoke("import_emoji_files", { paths });
              await refreshCustom();
            }
          }}
          className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs"
        >
          <Upload className="size-3.5" /> 导入图片
        </button>
        <button
          onClick={async () => {
            const name = prompt("新分组名称");
            if (name) {
              await invoke("create_group", { name });
              await refreshCustom();
            }
          }}
          className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs"
        >
          <FolderPlus className="size-3.5" /> 新建分组
        </button>
        <button
          onClick={() => setShowSettings((v) => !v)}
          aria-label="表情设置"
          className={cn(
            "flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs",
            showSettings
              ? "border-primary text-primary"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          <Settings2 className="size-3.5" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {GROUP_TABS.map((g) => (
          <button
            key={g.id}
            onClick={() => setTab(g.id)}
            className={cn(
              "rounded px-2 py-0.5 text-xs",
              tab === g.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {g.zh}
          </button>
        ))}
        {customGroups.map((g) => (
          <button
            key={g.id}
            onClick={() => setTab(String(g.id))}
            className={cn(
              "rounded px-2 py-0.5 text-xs",
              tab === String(g.id)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {g.name}
          </button>
        ))}
      </div>

      <div key={tab + "|" + q} ref={scrollRef} onScroll={onScroll} className="mt-3 flex-1 overflow-y-auto">
        {visibleEmoji.slice(0, visible).length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,40px)] gap-1">
            {visibleEmoji.slice(0, visible).map((e) => (
              <button
                key={e.char}
                title={`${e.name_en}`}
                onClick={() => onPick("emoji", e.char)}
                className="flex size-9 items-center justify-center rounded-md text-2xl hover:bg-accent"
              >
                <SmartEmoji char={e.char} code={e.code} size={28} />
              </button>
            ))}
          </div>
        )}
        {visibleCustoms.slice(0, visible).length > 0 && (
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,56px)] gap-2">
            {visibleCustoms.slice(0, visible).map((c) => (
              <div key={c.id} className="group relative">
                <button
                  onClick={() => onPick("custom", String(c.id))}
                  className="flex size-14 items-center justify-center overflow-hidden rounded-md border hover:border-primary"
                >
                  {c.thumb ? (
                    <img
                      src={`data:image/png;base64,${c.thumb}`}
                      className="h-full w-full object-contain"
                      alt=""
                    />
                  ) : (
                    <span className="text-xs">无</span>
                  )}
                </button>
                <button
                  onClick={async () => {
                    await invoke("delete_custom_emoji", { id: c.id });
                    await refreshCustom();
                  }}
                  className="absolute -left-1 -top-1 hidden rounded-full bg-background p-0.5 text-destructive group-hover:block"
                  aria-label="删除"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {visibleEmoji.length === 0 && visibleCustoms.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">无匹配表情</div>
        )}
      </div>
        </>

      <Drawer open={showSettings} onClose={() => setShowSettings(false)} title="表情设置">
        <EmojiSettings onRefresh={load} />
      </Drawer>
    </div>
  );
}
