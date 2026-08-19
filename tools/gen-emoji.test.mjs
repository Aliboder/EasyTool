// 校验生成的 emoji.json 结构完整：9 大类非空、字段齐全、字符可解码
import { readFileSync } from "node:fs";
const file = process.argv[2];
const data = JSON.parse(readFileSync(file, "utf8"));
const list = data.emoji;
if (!Array.isArray(list) || list.length < 1500) throw new Error(`count too small: ${list.length}`);
const groups = new Set();
for (const e of list) {
  if (typeof e.char !== "string" || e.char.length === 0) throw new Error("bad char");
  if (typeof e.group !== "string" || typeof e.group_zh !== "string") throw new Error("bad group");
  if (!Array.isArray(e.keywords) || e.keywords.length === 0) throw new Error("bad keywords");
  if (!Array.isArray(e.keywords_zh)) throw new Error("bad keywords_zh");
  groups.add(e.group);
}
const expect = ["smileys", "people", "animals", "food", "travel", "activities", "objects", "symbols", "flags"];
for (const g of expect) if (!groups.has(g)) throw new Error(`missing group ${g}`);
console.log(`OK: ${list.length} emoji, ${groups.size} groups`);
