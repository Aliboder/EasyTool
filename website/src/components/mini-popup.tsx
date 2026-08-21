import { Pin } from "lucide-react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ItemIcon, type ClipType } from "./minis/item-icon";

type Item = { id: number; type: ClipType; text: string };

const POOL: Omit<Item, "id">[] = [
  { type: "text", text: "开题报告终稿：答辩定在 9 月 12 日上午" },
  { type: "link", text: "github.com/Aliboder/EasyTool/releases" },
  { type: "image", text: "Screenshot 2026-08-19 224501.png" },
  { type: "file", text: "D:\\资料\\交通运输学\\第3章 交通流理论.pdf" },
  { type: "text", text: "API Key 已存入 Windows 凭据管理器" },
  { type: "link", text: "api-docs.deepseek.com/zh-cn" },
];

// 时间标签按位置递推，最新一条永远是「刚刚」
const TIMES = ["刚刚", "1 分钟前", "3 分钟前", "8 分钟前", "12 分钟前"];

function seed(): Item[] {
  return POOL.slice(0, 4).map((it, i) => ({ ...it, id: i }));
}

export function MiniPopup() {
  const reduce = useReducedMotion();
  const [items, setItems] = useState<Item[]>(seed);

  useEffect(() => {
    if (reduce) return;
    let i = 4;
    const timer = setInterval(() => {
      setItems((prev) =>
        [{ ...POOL[i++ % POOL.length], id: Date.now() }, ...prev].slice(0, 5),
      );
    }, 2200);
    return () => clearInterval(timer);
  }, [reduce]);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30"
    >
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="size-2 rounded-full bg-emerald-500" />
          EasyTool · 剪贴板
        </div>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-display text-xs text-zinc-500 tabular-nums dark:bg-zinc-800 dark:text-zinc-400">
          {items.length + 128} 条记录
        </span>
      </div>

      <ul className="space-y-1 p-2">
        <li className="flex items-center gap-3 rounded-xl bg-emerald-500/10 px-3 py-2.5">
          <ItemIcon type="file" />
          <span className="min-w-0 flex-1 truncate text-sm">EasyTool_0.4.4_x64-setup.exe</span>
          <Pin className="size-3.5 shrink-0 fill-emerald-500 text-emerald-500" />
        </li>

        <AnimatePresence initial={false} mode="popLayout">
          {items.map((item, i) => (
            <motion.li
              key={item.id}
              layout
              initial={reduce ? false : { opacity: 0, y: -14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5"
            >
              <ItemIcon type={item.type} />
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300">
                {item.text}
              </span>
              <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                {TIMES[Math.min(i, TIMES.length - 1)]}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </motion.div>
  );
}
