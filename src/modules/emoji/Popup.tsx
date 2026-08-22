import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig } from "@/lib/api";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadCatalog, type Catalog } from "./api";
import { SmartEmoji } from "./SmartEmoji";
import { toast } from "@/lib/toast";

const TABS = [
  "favorite",
  "recent",
  "smileys",
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
  recent: "最近",
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
  const [tab, setTab] = useState("favorite");
  const [q, setQ] = useState("");
  const [visible, setVisible] = useState(BATCH);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listLenRef = useRef(0);
  const lastLoadRef = useRef(0);
  const [emojiGridSize, setEmojiGridSize] = useState(40);

  useEffect(() => {
    loadCatalog()
      .then(setCat)
      .catch(console.error);
    getConfig().then((cfg) => {
      const m = cfg.modules.emoji ?? {};
      if (m.emoji_grid_size != null) setEmojiGridSize(m.emoji_grid_size as number);
    });
  }, []);

  // 切换分类/搜索时：重置渲染批次（列表容器用 key 强制重建，滚动位置自然归零）
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
      emojis = []; // 收藏 Tab 只显示图片表情
    } else {
      emojis = emojis.filter((e) => e.group === tab);
    }
    if (ql) {
      emojis = emojis.filter(
        (e) => e.name_en.toLowerCase().includes(ql) || e.keywords_zh.some((k) => k.includes(q.trim())),
      );
    }
    // 图片表情只在「收藏（全部）/最近（用过的）」；分类 Tab 只显示 Emoji
    const customs =
      tab === "favorite"
        ? cat.customs
        : tab === "recent"
          ? cat.customs.filter((c) => c.last_used_at != null)
          : [];
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

  listLenRef.current = list.length;

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 内容不足一屏：无需增量加载（scrollTop+clientHeight >= scrollHeight-200 恒真会误触发累积）
    if (el.scrollHeight <= el.clientHeight) return;
    // 节流：200ms 内只响应一次，避免 scrollTo/内容重排的多重事件风暴
    const now = Date.now();
    if (now - lastLoadRef.current < 200) return;
    const max = listLenRef.current;
    setVisible((v) => {
      if (v >= max) return v; // 已全部渲染，停止加载
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
        lastLoadRef.current = Date.now();
        return Math.min(v + BATCH, max);
      }
      return v;
    });
  }, []);

  const shown = list.slice(0, visible);

  const pick = async (type: "emoji" | "custom", key: string) => {
    try {
      await invoke("apply_emoji", { kind: type, key });
    } catch (e) {
      toast(String(e));
      return;
    }
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
      <div key={tab + "|" + q} ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-2">
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, ${emojiGridSize}px)` }}>
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
              ) : item.type === "emoji" ? (
                <SmartEmoji char={item.id} code={item.code} size={28} />
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
