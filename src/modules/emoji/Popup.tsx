import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig } from "@/lib/api";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadCatalog, type Catalog } from "./api";

const TABS = [
  "smileys",
  "recent",
  "mine",
  "all",
  "favorite",
  "hearts",
  "gestures",
  "people",
  "people-active",
  "animals",
  "plants",
  "food",
  "sport",
  "activities",
  "transport",
  "places",
  "sky",
  "time",
  "objects",
  "tech",
  "symbols",
  "flags",
];
const TAB_ZH: Record<string, string> = {
  all: "全部",
  recent: "最近",
  mine: "我的表情",
  favorite: "收藏",
  smileys: "表情",
  hearts: "爱心",
  gestures: "手势",
  people: "人物",
  "people-active": "人物活动",
  animals: "动物",
  plants: "植物",
  food: "食物",
  sport: "运动",
  activities: "活动娱乐",
  transport: "交通",
  places: "地点建筑",
  sky: "天空天气",
  time: "时间",
  objects: "物品",
  tech: "科技工具",
  symbols: "符号",
  flags: "旗帜",
};

// 增量渲染：单批渲染数量，滚动到底部再加载下一批（避免一次性渲染 1900+ 节点与 SVG 请求）
const BATCH = 240;

export function EmojiPopup() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [tab, setTab] = useState("smileys");
  const [q, setQ] = useState("");
  const [visible, setVisible] = useState(BATCH);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadCatalog()
      .then(setCat)
      .catch(console.error);
  }, []);

  // 切换分类/搜索时重置渲染批次
  useEffect(() => {
    setVisible(BATCH);
  }, [tab, q]);

  const list = useMemo(() => {
    if (!cat) return [];
    const ql = q.trim().toLowerCase();
    let emojis = cat.emoji;
    if (tab === "recent") {
      emojis = emojis.filter((e) => e.last_used_at != null);
    } else if (tab === "favorite") {
      emojis = emojis.filter((e) => e.is_favorite);
    } else if (tab !== "all" && tab !== "mine") {
      emojis = emojis.filter((e) => e.group === tab);
    }
    if (tab === "mine") {
      // 我的表情：仅图片表情
      const items = cat.customs.map((c) => ({
        type: "custom" as const,
        id: String(c.id),
        label: c.name,
        thumb: c.thumb,
        ts: c.last_used_at ?? 0,
      }));
      return items.sort((a, b) => b.ts - a.ts);
    }
    if (ql) {
      emojis = emojis.filter(
        (e) => e.name_en.toLowerCase().includes(ql) || e.keywords_zh.some((k) => k.includes(q.trim())),
      );
    }
    const customs =
      tab === "favorite"
        ? cat.customs.filter((c) => c.is_favorite)
        : tab === "mine"
          ? []
          : tab === "recent"
            ? cat.customs.filter((c) => c.last_used_at != null)
            : cat.customs;
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
        code: e.code,
      })),
    ];
    return items.sort((a, b) => b.ts - a.ts);
  }, [cat, tab, q]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setVisible((v) => Math.min(v + BATCH, list.length));
    }
  }, [list.length]);

  const shown = list.slice(0, visible);

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
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-[repeat(auto-fill,40px)] gap-1">
          {shown.map((item) => (
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
              ) : item.type === "emoji" && item.code ? (
                <img
                  src={`${import.meta.env.BASE_URL}twemoji/${item.code}.svg`}
                  className="size-7"
                  alt=""
                  loading="lazy"
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
