import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadCatalog, type Catalog } from "./api";
import { SmartEmoji } from "./SmartEmoji";
import { EmojiSettings } from "./Settings";
import { toast } from "@/lib/toast";
import { useModuleConfig } from "@/hooks/useModuleConfig";
import { usePopupGeometry } from "@/hooks/usePopupGeometry";
import { EMOJI_DEFAULTS } from "./config";
import { useWindowEntrance } from "@/lib/use-window-entrance";
import { gridColumns } from "@/lib/grid";
import { ModuleHeader, HeaderButton } from "@/components/module-header";
import { ContextMenu } from "@/components/ui/context-menu";
import { ContextMenuItem } from "@/components/ui/context-menu-item";
import { Copy, Star } from "lucide-react";

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

interface PopupItem {
  type: "custom" | "emoji";
  id: string;
  label: string;
  thumb: string | null;
  ts: number;
  code?: string | null;
}

export function EmojiPopup() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [tab, setTab] = useState("favorite");
  const [q, setQ] = useState("");
  const [visible, setVisible] = useState(BATCH);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const customGridRef = useRef<HTMLDivElement | null>(null);
  const emojiGridRef = useRef<HTMLDivElement | null>(null);
  const listLenRef = useRef(0);
  const lastLoadRef = useRef(0);

  // 统一配置（共享 Hook：focus 重读保证与主窗设置同步）
  const { cfg: emojiCfg, update: updateEmojiCfg } = useModuleConfig("emoji", EMOJI_DEFAULTS);
  // 固定位置模式：记录移动后的位置（跟随鼠标模式下不记录，见 usePopupGeometry）
  usePopupGeometry("emoji", { trackPos: emojiCfg.followMouse === false });
  const [showSettings, setShowSettings] = useState(false);
  const entranceRef = useWindowEntrance(true, ["animate-in", "fade-in-0"]);

  useEffect(() => {
    loadCatalog()
      .then(setCat)
      .catch(console.error);
  }, []);

  // 弹窗隐藏常驻（不重挂载）：聚焦时刷新目录，
  // 同步主窗与上次弹窗会话里的收藏/最近使用变更
  useEffect(() => {
    const onFocus = () => {
      loadCatalog()
        .then(setCat)
        .catch(console.error);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // 切换分类/搜索时：重置渲染批次（列表容器用 key 强制重建，滚动位置自然归零）
  useEffect(() => {
    setVisible(BATCH);
    setActiveIdx(null);
  }, [tab, q]);

  // 键盘导航：↑↓ 移动高亮、Enter 应用、Esc 隐藏窗口
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    type: "emoji" | "custom";
    id: string;
  } | null>(null);

  const copyEmoji = async (type: "emoji" | "custom", id: string) => {
    try {
      if (type === "emoji") {
        await navigator.clipboard.writeText(id);
      } else {
        await invoke("copy_custom_emoji", { id: Number(id) });
      }
      toast("已复制到剪贴板");
    } catch (e) {
      toast(`复制失败：${e}`);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (menu) {
        setMenu(null); // 右键菜单开着时 Esc 只关菜单，不隐藏整窗
        return;
      }
      getCurrentWindow().hide();
      return;
    }
    const total = shownC.length + shownE.length;
    if (!total) return;
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (dir !== 0) {
      e.preventDefault();
      // 双网格：按高亮所在网格的实际列数跨行步进，边界处钳制
      const colsAt = (idx: number) => {
        const ref = idx < shownC.length ? customGridRef : emojiGridRef;
        return ref.current ? gridColumns(ref.current) : 1;
      };
      setActiveIdx((i) => {
        // 无高亮时：↓ 选第一项、↑ 选最后一项（与 lib/grid.ts 的 gridVerticalTarget 约定一致）
        if (i == null) return dir === 1 ? 0 : total - 1;
        const from = Math.min(Math.max(i, 0), total - 1);
        return Math.min(Math.max(i + dir * colsAt(from), 0), total - 1);
      });
    } else if (e.key === "Enter" && activeIdx != null && activeIdx < total) {
      e.preventDefault();
      const it = activeIdx < shownC.length ? shownC[activeIdx] : shownE[activeIdx - shownC.length];
      pick(it.type, it.id);
      setActiveIdx(null);
    }
  };

  const list = useMemo(() => {
    if (!cat) return { customs: [], emojis: [] };
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
    // 双网格分区展示（对齐主窗 Page），各自按最近使用排序
    const cItems: PopupItem[] = customs
      .map((c) => ({
        type: "custom" as const,
        id: String(c.id),
        label: c.name,
        thumb: c.thumb,
        ts: c.last_used_at ?? 0,
      }))
      .sort((a, b) => b.ts - a.ts);
    const eItems: PopupItem[] = emojis
      .map((e) => ({
        type: "emoji" as const,
        id: e.char,
        label: e.name_en,
        thumb: null,
        ts: e.last_used_at ?? 0,
        code: e.code,
      }))
      .sort((a, b) => b.ts - a.ts);
    return { customs: cItems, emojis: eItems };
  }, [cat, tab, q]);

  listLenRef.current = list.customs.length + list.emojis.length;

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

  const shownC = list.customs.slice(0, visible);
  const shownE = list.emojis.slice(0, Math.max(0, visible - shownC.length));

  // 网格格子（双网格共用渲染；size 由所在网格决定）
  const cell = (item: PopupItem, idx: number, size: number) => (
    <button
      key={item.type + item.id}
      title={item.label}
      onClick={() => pick(item.type, item.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, type: item.type, id: item.id });
      }}
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-md hover:bg-accent",
        idx === activeIdx && "ring-2 ring-primary",
      )}
      style={{ width: size, height: size }}
    >
      {item.thumb ? (
        <img
          src={`data:image/png;base64,${item.thumb}`}
          className="h-full w-full object-contain"
          alt=""
        />
      ) : item.type === "emoji" ? (
        <SmartEmoji char={item.id} code={item.code ?? null} size={Math.round(size * 0.7)} />
      ) : (
        item.id
      )}
    </button>
  );

  const pick = async (type: "emoji" | "custom", key: string) => {
    try {
      await invoke("apply_emoji", { kind: type, key });
    } catch (e) {
      toast(String(e));
      return;
    }
    if (emojiCfg.clickAction !== "copy") getCurrentWindow().hide();
  };

  return (
    <div
      ref={entranceRef}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="flex h-screen flex-col bg-background text-foreground animate-in fade-in-0 duration-150"
    >
      <ModuleHeader
        search={{ value: q, onChange: setQ, placeholder: "搜索表情…", autoFocus: true }}
        actions={
          <HeaderButton
            title="表情设置"
            active={showSettings}
            onClick={() => setShowSettings((v) => !v)}
          >
            <Settings2 className="size-4" />
          </HeaderButton>
        }
        tabs={TABS.map((t) => ({ id: t, label: TAB_ZH[t] ?? t }))}
        activeTab={tab}
        onTabChange={setTab}
      />

      {showSettings && (
        <div className="border-b p-3">
          <EmojiSettings cfg={emojiCfg} onUpdate={updateEmojiCfg} />
        </div>
      )}
      <div key={tab + "|" + q} ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-2">
        {shownC.length > 0 && (
          <div
            ref={customGridRef}
            className={cn("grid gap-1", shownE.length > 0 && "mb-2")}
            style={{ gridTemplateColumns: `repeat(auto-fill, ${emojiCfg.customGridSize}px)` }}
          >
            {shownC.map((item, idx) => cell(item, idx, emojiCfg.customGridSize))}
          </div>
        )}
        <div
          ref={emojiGridRef}
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(auto-fill, ${emojiCfg.emojiGridSize}px)` }}
        >
          {shownE.map((item, idx) => cell(item, shownC.length + idx, emojiCfg.emojiGridSize))}
        </div>
        {list.customs.length + list.emojis.length === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {cat ? "无匹配表情" : "加载中..."}
          </div>
        )}
      </div>

      <ContextMenu
        visible={menu != null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
      >
        <ContextMenuItem
          icon={<Copy className="size-3.5" />}
          label="复制表情"
          onClick={async () => {
            if (menu) await copyEmoji(menu.type, menu.id);
            setMenu(null);
          }}
        />
        {menu?.type === "custom" && (
          <ContextMenuItem
            icon={<Star className="size-3.5" />}
            label="添加到收藏"
            onClick={async () => {
              if (menu) {
                try {
                  await invoke("toggle_favorite", { kind: "custom", key: menu.id, fav: true });
                  toast("已添加到收藏");
                  // 立即刷新目录，收藏 Tab 马上可见新条目
                  loadCatalog()
                    .then(setCat)
                    .catch(console.error);
                } catch (e) {
                  toast(`收藏失败：${e}`);
                }
              }
              setMenu(null);
            }}
          />
        )}
      </ContextMenu>
    </div>
  );
}
