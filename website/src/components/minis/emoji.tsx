import { motion } from "motion/react";
import { useState } from "react";

const CATEGORIES = ["收藏", "最近", "表情", "手势", "人物"];
const EMOJIS: Record<string, string[]> = {
  "收藏": ["⭐", "❤️", "🔥", "👍", "✨", "🎉", "💪", "🙏", "😀", "😂", "🥹", "😍", "🤔", "😎", "🥳", "😴", "👋", "🤝", "👀", "🧠", "💻", "🚀", "📦", "🔧"],
  "最近": ["😀", "😂", "🥹", "😍", "🤔", "😎", "🥳", "😴", "👍", "🙏", "👏", "💪", "🔥", "✨", "🎉", "❤️"],
  "表情": ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲", "😋", "😛", "😜"],
  "手势": ["👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛"],
  "人物": ["👶", "👧", "🧒", "👦", "👩", "🧑", "👨", "👩‍🦱", "🧑‍🦱", "👨‍🦱", "👩‍🦰", "🧑‍🦰", "👨‍🦰", "👱‍♀️", "👱", "👱‍♂️", "👩‍🦳", "🧑‍🦳", "👨‍🦳", "👩‍🦲", "🧑‍🦲", "👨‍🦲", "🧔‍♀️", "🧔"],
};

export function MiniEmoji() {
  const [cat, setCat] = useState("收藏");
  const [sel, setSel] = useState<number | null>(null);
  const emojis = EMOJIS[cat] || EMOJIS["收藏"];

  return (
    <div>
      {/* category tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => { setCat(c); setSel(null); }}
            className={`shrink-0 rounded px-2 py-0.5 text-[10px] transition-colors ${c === cat ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* grid */}
      <div className="mt-2 grid grid-cols-8 gap-1">
        {emojis.slice(0, 16).map((e, i) => (
          <motion.button
            key={`${cat}-${i}`}
            type="button"
            whileTap={{ scale: 0.85 }}
            onClick={() => setSel(i)}
            className={`flex size-8 items-center justify-center rounded-md text-lg transition-colors ${sel === i && cat === "收藏" ? "bg-emerald-500/15 ring-1 ring-emerald-500/50" : "hover:bg-white/5"}`}
          >
            {e}
          </motion.button>
        ))}
      </div>

      <p className="mt-2 text-[9px] text-zinc-600">1900+ 表情 · 热键直输到任何输入框</p>
    </div>
  );
}
