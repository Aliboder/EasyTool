import { useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import { cn } from "../lib/cn";

const CATEGORIES = ["最近", "表情", "爱心", "手势", "人物", "动物", "食物", "物品", "符号"];

const EMOJIS: Record<string, string[]> = {
  表情: ["😀", "😄", "😂", "🤣", "😊", "😍", "😎", "🤔", "😅", "😉", "🙃", "😴", "🤩", "🥳", "😭", "😤"],
  爱心: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💖", "💘", "💝", "💞"],
  手势: ["👍", "👎", "👌", "✌️", "🤞", "🤙", "👏", "🙌", "🤝", "✋", "👊", "✊"],
  人物: ["👦", "👧", "👨", "👩", "🧑", "👴", "👵", "👮", "🧑‍💻", "🧑‍🎓"],
  动物: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯"],
  食物: ["🍎", "🍊", "🍋", "🍇", "🍉", "🍓", "🍑", "🥑", "🍕", "🍔", "🍟", "🍜"],
  物品: ["📋", "📌", "🖥️", "⌨️", "🖱️", "📱", "🔑", "💻", "🗂️", "📎"],
  符号: ["✅", "❌", "⚠️", "❗", "❓", "💯", "🔺", "🔻", "➡️", "⬅️"],
};

// 最近使用（真实行为：点过的表情会出现在这里）
const RECENT = ["😀", "👍", "✅", "📋"];

export function RealEmoji() {
  const [cat, setCat] = useState("表情");
  const [q, setQ] = useState("");
  const [used, setUsed] = useState<string[]>(RECENT);
  const [pick, setPick] = useState<string | null>(null);

  const visible = useMemo(() => {
    const list = cat === "最近" ? used : EMOJIS[cat] ?? [];
    if (!q.trim()) return list;
    const k = q.trim().toLowerCase();
    // 简易搜索演示：命中任意分类
    const hits = new Set<string>();
    for (const arr of Object.values(EMOJIS)) {
      for (const e of arr) {
        if (e.includes(k) || e.toLowerCase().includes(k)) hits.add(e);
      }
    }
    return [...list, ...hits];
  }, [cat, q, used]);

  const onClick = (e: string) => {
    setPick(e);
    setUsed((prev) => [e, ...prev.filter((x) => x !== e)].slice(0, 12));
  };

  return (
    <div className="flex h-[480px] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white font-sans shadow-2xl shadow-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
        <span className="flex gap-1.5">
          <span className="size-3 rounded-full bg-red-500/80" />
          <span className="size-3 rounded-full bg-yellow-500/80" />
          <span className="size-3 rounded-full bg-emerald-500/80" />
        </span>
        <span className="ml-1.5 text-xs font-medium text-zinc-500">EasyTool · 表情</span>
        <span className="ml-auto text-[10px] text-zinc-400">1900+ 内置 · 支持自定义导入</span>
      </div>

      {/* 搜索 */}
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
        <div className="flex flex-1 items-center gap-2 rounded-lg bg-zinc-100 px-2.5 py-1.5 dark:bg-zinc-800">
          <Search className="size-3.5 shrink-0 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索表情（中文 / 英文）…"
            className="w-full bg-transparent text-xs text-zinc-800 outline-none placeholder:text-zinc-500 dark:text-zinc-200 dark:placeholder:text-zinc-500"
          />
        </div>
        <button className="rounded-md border border-zinc-200 px-2 py-1 text-[10px] text-zinc-500 dark:border-zinc-700">导入图片</button>
      </div>

      {/* 分类 Tab */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-100 px-4 py-1.5 dark:border-zinc-800">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-[11px] transition-colors",
              cat === c ? "bg-emerald-500/15 font-medium text-emerald-600 dark:text-emerald-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
            )}
          >
            {c === "最近" && <Star className="mr-1 inline size-2.5 -translate-y-px" />}
            {c}
          </button>
        ))}
      </div>

      {/* 网格 */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {cat === "最近" && used.length > 0 && (
          <p className="px-0.5 pb-1.5 text-[10px] text-zinc-500 dark:text-zinc-500">最近使用</p>
        )}
        <div className="grid grid-cols-8 gap-0.5">
          {visible.map((e, i) => (
            <button
              key={`${e}-${i}`}
              onClick={() => onClick(e)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md text-xl transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800",
                pick === e && "bg-emerald-500/15 ring-1 ring-emerald-500/40",
              )}
            >
              {e}
            </button>
          ))}
        </div>
        {visible.length === 0 && (
          <p className="py-8 text-center text-xs text-zinc-500">没有匹配的表情，换个关键词或分类试试</p>
        )}
        {cat === "最近" && used.length > 0 && (
          <p className="mt-3 border-t border-dashed border-zinc-200 px-0.5 pt-2.5 text-[10px] leading-relaxed text-zinc-500 dark:border-zinc-700">
            点过的表情自动进入「最近」；文本表情点按即 SendInput 直输，不写剪贴板。
          </p>
        )}
      </div>
    </div>
  );
}