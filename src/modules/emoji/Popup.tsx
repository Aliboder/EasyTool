import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig } from "@/lib/api";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmojiDto {
  char: string;
  group: string;
  name_en: string;
  keywords_zh: string[];
  is_favorite: boolean;
  use_count: number;
  last_used_at: number | null;
}
interface CustomDto {
  id: number;
  name: string;
  thumb: string | null;
  is_favorite: boolean;
  last_used_at: number | null;
}
interface Catalog {
  emoji: EmojiDto[];
  customs: CustomDto[];
}

const TABS = [
  "all",
  "favorite",
  "smileys",
  "people",
  "animals",
  "food",
  "travel",
  "activities",
  "objects",
  "symbols",
  "flags",
];
const TAB_ZH: Record<string, string> = {
  all: "全部",
  favorite: "收藏",
  smileys: "笑脸",
  people: "人物",
  animals: "动物",
  food: "食物",
  travel: "旅行",
  activities: "活动",
  objects: "物品",
  symbols: "符号",
  flags: "旗帜",
};

export function EmojiPopup() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");

  const load = async () => setCat(await invoke<Catalog>("get_emoji_all"));
  useEffect(() => {
    load().catch(console.error);
  }, []);

  const list = useMemo(() => {
    if (!cat) return [];
    const ql = q.trim().toLowerCase();
    let emojis = cat.emoji;
    if (tab === "favorite") emojis = emojis.filter((e) => e.is_favorite);
    else if (tab !== "all") emojis = emojis.filter((e) => e.group === tab);
    if (ql) {
      emojis = emojis.filter(
        (e) => e.name_en.toLowerCase().includes(ql) || e.keywords_zh.some((k) => k.includes(q.trim())),
      );
    }
    const customs = tab === "favorite" ? cat.customs.filter((c) => c.is_favorite) : cat.customs;
    const items = [
      ...customs.map((c) => ({
        type: "custom" as const,
        id: String(c.id),
        label: c.name,
        thumb: c.thumb,
        ts: c.last_used_at ?? 0,
      })),
      ...emojis.map((e) => ({
        type: "emoji" as const,
        id: e.char,
        label: e.name_en,
        thumb: null,
        ts: e.last_used_at ?? 0,
      })),
    ];
    return items.sort((a, b) => b.ts - a.ts);
  }, [cat, tab, q]);

  const pick = async (type: "emoji" | "custom", key: string) => {
    await invoke("apply_emoji", { kind: type, key });
    const cfg = await getConfig().catch(() => null);
    const action = cfg?.modules?.emoji?.click_action as string | undefined;
    if (action !== "copy") getCurrentWindow().hide();
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b p-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索表情…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autoFocus
        />
      </div>
      <div className="flex gap-1 overflow-x-auto border-b px-2 py-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "shrink-0 rounded px-2 py-0.5 text-xs",
              tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {TAB_ZH[t]}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-[repeat(auto-fill,40px)] gap-1">
          {list.map((item) => (
            <button
              key={item.type + item.id}
              title={item.label}
              onClick={() => pick(item.type, item.id)}
              className="flex size-9 items-center justify-center overflow-hidden rounded-md text-2xl hover:bg-accent"
            >
              {item.thumb ? (
                <img
                  src={`data:image/png;base64,${item.thumb}`}
                  className="h-full w-full object-contain"
                  alt=""
                />
              ) : (
                item.id
              )}
            </button>
          ))}
        </div>
        {list.length === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground">无匹配表情</div>
        )}
      </div>
    </div>
  );
}
