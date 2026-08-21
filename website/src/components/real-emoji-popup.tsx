import { useState } from "react";
import { Search } from "lucide-react";

const CATS = ["收藏", "最近", "表情", "爱心", "手势", "人物"];
const E: Record<string, string[]> = {
  "收藏": ["⭐","❤️","🔥","👍","✨","🎉","💪","🙏","😀","😂","🥹","😍","🤔","😎","🥳","😴","👋","🤝","👀","🧠","💻","🚀","📦","🔧"],
  "最近": ["😀","😂","🥹","😍","🤔","😎","🥳","😴","👍","🙏","👏","💪","🔥","✨","🎉","❤️"],
  "表情": ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜"],
  "爱心": ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","♥️","🫶","💑","♥️","❤️"],
  "手势": ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👍","👎","✊","👊","🤛"],
  "人物": ["👶","👧","🧒","👦","👩","🧑","👨","👩‍🦱","🧑‍🦱","👨‍🦱","👩‍🦰","🧑‍🦰","👨‍🦰","👱‍♀️","👱","👱‍♂️","👩‍🦳","🧑‍🦳","👨‍🦳","👩‍🦲","🧑‍🦲","👨‍🦲","🧔‍♀️","🧔"],
};

export function RealEmojiPopup() {
  const [cat, setCat] = useState("收藏");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(0);
  const emojis = q ? Object.values(E).flat().slice(0, 28) : (E[cat] || []);

  return (
    <div className="flex h-[420px] w-[320px] flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-900 font-sans text-zinc-100 shadow-2xl shadow-black/40">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
        <Search className="size-4 shrink-0 text-zinc-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索表情…" className="flex-1 bg-transparent text-sm text-zinc-300 outline-none placeholder:text-zinc-600" />
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-white/5 px-3 py-1.5">
        {CATS.map((c) => (
          <button key={c} onClick={() => { setCat(c); setQ(""); }} className={`shrink-0 rounded px-2 py-0.5 text-[10px] transition-colors ${c === cat && !q ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"}`}>{c}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-[repeat(auto-fill,36px)] gap-0.5">
          {emojis.map((e, i) => (
            <button key={`${cat}-${i}`} onClick={() => setSel(i)} className={`flex size-9 items-center justify-center rounded-md text-2xl transition-colors ${sel === i && cat === "收藏" ? "bg-emerald-500/15 ring-1 ring-emerald-500/50" : "hover:bg-white/5"}`}>{e}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
