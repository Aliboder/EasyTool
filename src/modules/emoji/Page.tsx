import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Search,
  Upload,
  FolderPlus,
  Trash2,
  Star,
  StarOff,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmojiSettings } from "./Settings";
import { loadCatalog, type Catalog, type GroupDto } from "./api";

const GROUP_TABS = [
  { id: "all", zh: "全部" },
  { id: "recent", zh: "最近" },
  { id: "mine", zh: "我的表情" },
  { id: "favorite", zh: "收藏" },
  { id: "smileys", zh: "表情" },
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

export function EmojiPage() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [customGroups, setCustomGroups] = useState<GroupDto[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  // 增量渲染：不限制总数，滚动到底加载下一批（避免一次性渲染 1900+ 节点）
  const [visible, setVisible] = useState(240);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisible(240);
  }, [tab, q]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setVisible((v) => v + 240);
    }
  }, []);

  const load = async () => {
    const c = await loadCatalog();
    setCat(c);
  };
  useEffect(() => {
    load().catch(console.error);
  }, []);

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
    else if (tab === "favorite") list = list.filter((e) => e.is_favorite);
    else if (tab !== "all" && tab !== "mine") list = list.filter((e) => e.group === tab);
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
    if (tab === "favorite") list = list.filter((c) => c.is_favorite);
    else if (tab === "recent") list = list.filter((c) => c.last_used_at != null);
    else if (
      tab !== "all" &&
      tab !== "favorite" &&
      tab !== "recent" &&
      tab !== "mine"
    ) {
      const gid = customGroups.find((g) => g.id === Number(tab))?.id;
      if (gid !== undefined) list = list.filter((c) => c.group_id === gid);
    }
    if (ql) list = list.filter((c) => c.name.toLowerCase().includes(ql));
    return list;
  }, [cat, customGroups, tab, q]);

  const onPick = async (kind: "emoji" | "custom", key: string) => {
    await invoke("apply_emoji", { kind, key });
  };

  return (
    <div className="flex h-full flex-col p-4">
      {showSettings ? (
        <div className="flex-1 overflow-y-auto">
          <EmojiSettings onRefresh={load} />
        </div>
      ) : (
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

      <div ref={scrollRef} onScroll={onScroll} className="mt-3 flex-1 overflow-y-auto">
        {visibleEmoji.slice(0, visible).length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,40px)] gap-1">
            {visibleEmoji.slice(0, visible).map((e) => (
              <button
                key={e.char}
                title={`${e.name_en}`}
                onClick={() => onPick("emoji", e.char)}
                className="flex size-9 items-center justify-center rounded-md text-2xl hover:bg-accent"
              >
                {e.code ? (
                  <img
                    src={`${import.meta.env.BASE_URL}twemoji/${e.code}.svg`}
                    className="size-7"
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  e.char
                )}
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
                    await invoke("toggle_favorite", {
                      kind: "custom",
                      key: String(c.id),
                      fav: !c.is_favorite,
                    });
                    await refreshCustom();
                  }}
                  className="absolute -right-1 -top-1 hidden rounded-full bg-background p-0.5 text-yellow-500 group-hover:block"
                  aria-label="收藏"
                >
                  {c.is_favorite ? <Star className="size-3" /> : <StarOff className="size-3" />}
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
      )}
    </div>
  );
}
