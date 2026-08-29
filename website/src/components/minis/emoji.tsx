import { motion } from "motion/react";
import { useState } from "react";

const CATEGORIES = ["收藏", "最近", "表情", "手势", "人物"];
const EMOJIS: Record<string, string[]> = {
  收藏: ["⭐", "❤️", "🔥", "👍", "✨", "🎉", "💪", "🙏", "😀", "😂", "🥹", "😍", "🤔", "😎", "🥳", "😴", "👋", "🤝", "👀", "🧠", "💻", "🚀", "📦", "🔧"],
  最近: ["😀", "😂", "🥹", "😍", "🤔", "😎", "🥳", "😴", "👍", "🙏", "👏", "💪", "🔥", "✨", "🎉", "❤️"],
  表情: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲", "😋", "😛", "😜"],
  手势: ["👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛"],
  人物: ["👶", "👧", "🧒", "👦", "👩", "🧑", "👨", "👩‍🦱", "🧑‍🦱", "👨‍🦱", "👩‍🦰", "🧑‍🦰", "👨‍🦰", "👱‍♀️", "👱", "👱‍♂️", "👩‍🦳", "🧑‍🦳", "👨‍🦳", "👩‍🦲", "🧑‍🦲", "👨‍🦲", "🧔‍♀️", "🧔"],
};

// 色彩墙：每格底色按调色板轮换，形成彩色马赛克
const TINT: [string, string][] = [
  ["bg-emerald-500/15", "hover:bg-emerald-500/25"],
  ["bg-cyan-500/15", "hover:bg-cyan-500/25"],
  ["bg-amber-500/15", "hover:bg-amber-500/25"],
  ["bg-rose-500/15", "hover:bg-rose-500/25"],
  ["bg-violet-500/15", "hover:bg-violet-500/25"],
];

export function MiniEmoji() {
  const [cat, setCat] = useState("收藏");
  const [sel, setSel] = useState<number | null>(null);
  const emojis = EMOJIS[cat] || EMOJIS["收藏"];

  return (
    <div>
      {/* 分类 Tab */}
      <div className="flex gap-1 overflow-x-auto">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setCat(c);
              setSel(null);
            }}
            className={`shrink-0 rounded px-2 py-0.5 text-[10px] transition-colors ${c === cat ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 色彩墙网格 */}
      <div className="mt-2 grid grid-cols-8 gap-1">
        {emojis.slice(0, 16).map((e, i) => {
          const [base, hover] = TINT[i % TINT.length];
          return (
            <motion.button
              key={`${cat}-${i}`}
              type="button"
              whileTap={{ scale: 0.85 }}
              onClick={() => setSel(i)}
              className={`flex size-8 items-center justify-center rounded-md text-lg transition-colors ${base} ${hover} ${sel === i ? "ring-1 ring-emerald-500/60" : ""}`}
            >
              {e}
            </motion.button>
          );
        })}
      </div>

      <p className="mt-2 text-[9px] text-zinc-600">1900+ 表情 · 点按即直输，不写剪贴板</p>
    </div>
  );
}