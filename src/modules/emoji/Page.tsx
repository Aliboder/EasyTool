import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Search,
  Upload,
  ClipboardPaste,
  FolderPlus,
  Trash2,
  Star,
  StarOff,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmojiSettings } from "./Settings";

interface EmojiDto {
  char: string;
  group: string;
  group_zh: string;
  name_en: string;
  keywords_zh: string[];
  is_favorite: boolean;
  use_count: number;
  last_used_at: number | null;
}
interface CustomDto {
  id: number;
  name: string;
  group_id: number | null;
  is_favorite: boolean;
  use_count: number;
  last_used_at: number | null;
  thumb: string | null;
}
interface GroupDto {
  id: number;
  name: string;
}
interface Catalog {
  emoji: EmojiDto[];
  groups: GroupDto[];
  customs: CustomDto[];
}

const GROUP_TABS = [
  { id: "all", zh: "全部" },
  { id: "favorite", zh: "收藏" },
  { id: "smileys", zh: "笑脸" },
  { id: "people", zh: "人物" },
  { id: "animals", zh: "动物" },
  { id: "food", zh: "食物" },
  { id: "travel", zh: "旅行" },
  { id: "activities", zh: "活动" },
  { id: "objects", zh: "物品" },
  { id: "symbols", zh: "符号" },
  { id: "flags", zh: "旗帜" },
];

export function EmojiPage() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [customGroups, setCustomGroups] = useState<GroupDto[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const load = async () => {
    const c = await invoke<Catalog>("get_emoji_all");
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
    if (tab === "favorite") list = list.filter((e) => e.is_favorite);
    else if (tab !== "all") list = list.filter((e) => e.group === tab);
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
    else if (tab !== "all" && tab !== "favorite") {
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
            try {
              await invoke("add_emoji_from_clipboard");
              await refreshCustom();
            } catch (e) {
              console.error(e);
            }
          }}
          className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs"
        >
          <ClipboardPaste className="size-3.5" /> 从剪贴板添加
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

      <div className="mt-3 flex-1 overflow-y-auto">
        {visibleEmoji.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,40px)] gap-1">
            {visibleEmoji.map((e) => (
              <button
                key={e.char}
                title={`${e.name_en}`}
                onClick={() => onPick("emoji", e.char)}
                className="flex size-9 items-center justify-center rounded-md text-2xl hover:bg-accent"
              >
                {e.char}
              </button>
            ))}
          </div>
        )}
        {visibleCustoms.length > 0 && (
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,56px)] gap-2">
            {visibleCustoms.map((c) => (
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
