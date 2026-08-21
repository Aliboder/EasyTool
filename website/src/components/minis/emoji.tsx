import { motion } from "motion/react";
import { useState } from "react";

const EMOJIS = [
  "😀", "😂", "🥹", "😍", "🤔", "😎", "🥳", "😴",
  "👍", "🙏", "👏", "💪", "🔥", "✨", "🎉", "❤️",
];

export function MiniEmoji() {
  const [sel, setSel] = useState<number | null>(null);

  return (
    <div>
      <div className="grid grid-cols-8 gap-1.5">
        {EMOJIS.map((e, i) => (
          <motion.button
            key={e}
            type="button"
            whileTap={{ scale: 0.85 }}
            onClick={() => setSel(i)}
            aria-label={`选择表情 ${e}`}
            className={`flex aspect-square items-center justify-center rounded-xl text-xl transition-colors ${
              sel === i
                ? "bg-emerald-500/15 ring-2 ring-emerald-500"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {e}
          </motion.button>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
        1900+ 表情 · 热键直输到任何输入框
      </p>
    </div>
  );
}
