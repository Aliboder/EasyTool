import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Search,
  Upload,
  FolderPlus,
  Trash2,
  Settings2,
  Copy,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/api";
import { Drawer } from "@/components/ui/drawer";
import { ContextMenu } from "@/components/ui/context-menu";
import { ContextMenuItem } from "@/components/ui/context-menu-item";
import { ContextMenuDivider } from "@/components/ui/context-menu-divider";
import { EmojiSettings } from "./Settings";
import { loadCatalog, type Catalog, type GroupDto } from "./api";
import { SmartEmoji } from "./SmartEmoji";
import { toast } from "@/lib/toast";
import { usePrompt } from "@/components/ui/prompt-dialog";

const GROUP_TABS = [
  { id: "favorite", zh: "收藏" },
  { id: "recent", zh: "最近" },
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

export function EmojiPage({ active = true }: { active?: boolean }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [tab, setTab] = useState("favorite");
  const [q, setQ] = useState("");
  const [customGroups, setCustomGroups] = useState<GroupDto[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  // 增量渲染：不限制总数，滚动到底加载下一批（避免一次性渲染 1900+ 节点）
  const [visible, setVisible] = useState(240);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listLenRef = useRef(0);
  const lastLoadRef = useRef(0);
  const { prompt, PromptDialog } = usePrompt();
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    type: "emoji" | "custom";
    emoji?: string;
    customId?: number;
  }>({ visible: false, x: 0, y: 0, type: "emoji" });
  const [emojiGridSize, setEmojiGridSize] = useState(40);
  const [customGridSize, setCustomGridSize] = useState(56);

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

  // 加载网格大小配置（挂载时 + 设置保存后刷新）
  const loadGridSizes = useCallback(async () => {
    const cfg = await getConfig();
    const m = cfg.modules.emoji ?? {};
    if (m.emoji_grid_size != null) setEmojiGridSize(m.emoji_grid_size as number);
    if (m.custom_grid_size != null) setCustomGridSize(m.custom_grid_size as number);
  }, []);

  useEffect(() => {
    loadGridSizes();
  }, [loadGridSizes]);

  // 切回模块时刷新（keep-alive 下组件常驻，跨模块操作后需拿到最新数据）。
  // 早期卡顿源于激活时全量重载 + SmartEmoji 逐字符同步检测；检测已改分片（每帧 24 个），
  // 现在激活重载仅 loadCatalog ~5ms + 轻量重渲染，不会卡
  useEffect(() => {
    if (active) load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // 窗口聚焦时刷新（覆盖停留在表情页、外部窗口操作后数据变脏的场景）。
  // 呼出时 focus 可能连发多次：防抖只保留最后一次，避免并发全量重载卡顿
  useEffect(() => {
    if (!active) return;
    let timer: number | null = null;
    const onFocus = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => load().catch(console.error), 150);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer) window.clearTimeout(timer);
    };
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
    <div 
      className="relative flex h-full flex-col p-4"
      onContextMenu={(e) => e.preventDefault()}
    >
      {PromptDialog}
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
            const name = await prompt("新建分组", { placeholder: "请输入分组名称" });
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
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, ${emojiGridSize}px)` }}>
            {visibleEmoji.slice(0, visible).map((e) => (
              <button
                key={e.char}
                title={`${e.name_en}`}
                onClick={() => onPick("emoji", e.char)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  setContextMenu({
                    visible: true,
                    x: ev.clientX,
                    y: ev.clientY,
                    type: "emoji",
                    emoji: e.char,
                  });
                }}
                className="flex items-center justify-center rounded-md hover:bg-accent"
                style={{ width: emojiGridSize, height: emojiGridSize }}
              >
                <SmartEmoji char={e.char} code={e.code} size={Math.round(emojiGridSize * 0.7)} />
              </button>
            ))}
          </div>
        )}
        {visibleCustoms.slice(0, visible).length > 0 && (
          <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, ${customGridSize}px)` }}>
            {visibleCustoms.slice(0, visible).map((c) => (
              <div key={c.id} className="group relative">
                <button
                  onClick={() => onPick("custom", String(c.id))}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    setContextMenu({
                      visible: true,
                      x: ev.clientX,
                      y: ev.clientY,
                      type: "custom",
                      customId: c.id,
                    });
                  }}
                  className="flex items-center justify-center overflow-hidden rounded-md border hover:border-primary"
                  style={{ width: customGridSize, height: customGridSize }}
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

      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
      >
        {contextMenu.type === "emoji" && contextMenu.emoji && (
          <>
            <ContextMenuItem
              icon={<Copy className="size-3.5" />}
              label="复制表情"
              onClick={() => {
                navigator.clipboard.writeText(contextMenu.emoji!);
                toast("已复制到剪贴板");
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
            />
          </>
        )}
        {contextMenu.type === "custom" && contextMenu.customId && (
          <>
            <ContextMenuItem
              icon={<Copy className="size-3.5" />}
              label="复制表情"
              onClick={() => {
                // TODO: 复制自定义表情
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
            />
            <ContextMenuItem
              icon={<Star className="size-3.5" />}
              label="添加到收藏"
              onClick={() => {
                // TODO: 添加到收藏
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
            />
            <ContextMenuDivider />
            <ContextMenuItem
              icon={<Trash2 className="size-3.5" />}
              label="删除"
              onClick={async () => {
                if (contextMenu.customId) {
                  await invoke("delete_custom_emoji", { id: contextMenu.customId });
                  await refreshCustom();
                }
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
              className="text-destructive"
            />
          </>
        )}
      </ContextMenu>

      <Drawer open={showSettings} onClose={() => setShowSettings(false)} title="表情设置">
        <EmojiSettings onRefresh={() => { load(); loadGridSizes(); }} />
      </Drawer>
    </div>
  );
}
