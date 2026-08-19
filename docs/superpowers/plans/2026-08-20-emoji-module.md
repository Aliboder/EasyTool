# 表情模块实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 EasyTool 新增表情模块：内置全量 Unicode Emoji（含中英文搜索）+ 用户图片表情（文件导入/剪贴板添加）+ 主窗口管理页 + 全局热键悬浮面板，支持粘贴/复制、最近使用、搜索、收藏、分组。

**Architecture:** 复用现有「单应用 + 模块注册表」架构。后端 Rust 模块 `src-tauri/src/modules/emoji/`（db 层 + 数据层 + 粘贴层 + 命令层），内置 Emoji 以 `emoji.json` 资源打包，动态数据存独立 `emojis.db`。前端主窗口模块页 + 独立悬浮面板窗口（复用剪贴板弹窗模式）。

**Tech Stack:** Rust（rusqlite/windows crate/image/serde）、React 19 + TS + Tailwind v4 + shadcn/ui、lucide-react、Vite MPA、Tauri 2（global-shortcut/notification）。

**Spec:** `docs/superpowers/specs/2026-08-20-emoji-module-design.md`（本计划从该 spec 推导，执行者需同时阅读）

## Global Constraints

- 版本：Tauri 2、rusqlite 0.32（bundled）、image 0.25、windows 0.61
- 模块注册 4 处联动：`modules/mod.rs` 声明 + `lib.rs` setup 调用 + `lib.rs` invoke_handler 注册 + manifest 文件
- 独立窗口 4 处联动：根目录 `.html` + `vite.config.ts` rollupOptions.input + Rust 建窗 `WebviewUrl::App` + `capabilities/default.json` windows 数组
- 热键匹配必须用 `Shortcut::from_str(&cfg).map(|s| s == *shortcut)` 对象比较
- 持锁期间禁止调用会再次取锁的函数（`module_config`/`save_config` 等）
- 网络/耗时操作放 `spawn_blocking`
- Windows 禁 `.transparent(true)`；独立窗口延迟创建（首次呼出建窗）
- 新增前端入口改 vite input 时保持 `appType: "mpa"` 不变
- 所有新 Rust 逻辑带 `#[cfg(test)]` 单元测试；`cargo test` 全绿 + `npx tsc --noEmit` 无错
- **不要用 PowerShell 的 `Get-Content`/`Set-Content` 改写任何文件**（会把 UTF-8 写成 GBK 乱码）——一律用编辑器工具
- 中文名数据：内置高频中文映射表（覆盖常用搜索词），其余回退英文 shortcode

---

### Task 1: 生成 emoji.json 资源数据

**Files:**
- Create: `tools/gen-emoji.mjs`
- Create: `src-tauri/modules/emoji/emoji.json`（生成产物）
- Create: `tools/gen-emoji.test.mjs`（验证脚本）

**Interfaces:**
- Produces: `src-tauri/modules/emoji/emoji.json` — 结构 `{ "emoji": [{ "char": string, "group": string, "group_zh": string, "name_en": string, "keywords": string[], "keywords_zh": string[] }] }`，`group` 取值 `smileys|people|animals|food|travel|activities|objects|symbols|flags`，按 sort_order 排序
- 后续 Task 2 的 `data.rs` 读取该文件，字段名必须精确匹配

- [ ] **Step 1: 安装一次性数据源并编写生成脚本**

```bash
# 数据源获取（临时目录，一次性）：
cd C:\Users\Aliboder\AppData\Local\Temp\opencode
npm pack emoji-datasource@16.0.0
tar -xf emoji-datasource-16.0.0.tgz
# 得到 package/emoji.json（1911 条，含 category/short_name/unified/name）
```

`tools/gen-emoji.mjs`:

```js
// 从 emoji-datasource 的 emoji.json 生成 EasyTool 需要的精简数据。
// 用法: node tools/gen-emoji.mjs <input.json> <output.json>
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output] = process.argv;
const raw = JSON.parse(readFileSync(input, "utf8"));

// 官方分类 → 内部 group id + 中文名
const GROUP_MAP = {
  "Smileys & Emotion": ["smileys", "笑脸"],
  "People & Body": ["people", "人物"],
  "Animals & Nature": ["animals", "动物"],
  "Food & Drink": ["food", "食物"],
  "Travel & Places": ["travel", "旅行"],
  "Activities": ["activities", "活动"],
  "Objects": ["objects", "物品"],
  "Symbols": ["symbols", "符号"],
  "Flags": ["flags", "旗帜"],
};

// 高频中文关键词（覆盖常用搜索词；未覆盖的回退英文 shortcode）
const ZH_HINTS = {
  grinning: ["笑脸", "笑"], smile: ["微笑", "笑"], joy: ["笑哭", "大笑"],
  heart: ["爱心", "心"], crying: ["哭", "哭脸"], thumbsup: ["赞", "好", "大拇指"],
  clap: ["鼓掌", "拍手"], fire: ["火", "热门"], star: ["星星", "星"], sun: ["太阳"],
  moon: ["月亮"], cat: ["猫"], dog: ["狗"], flower: ["花"], gift: ["礼物", "礼物盒"],
  birthday: ["生日", "蛋糕"], rocket: ["火箭", "冲"], ok_hand: ["好", "可以"],
  prayer: ["祈祷", "拜托"], wave: ["挥手", "再见"], thinking: ["思考", "想"],
  party: ["派对", "庆祝"], check: ["对", "勾"], cross: ["错", "叉"],
  question: ["问", "问号"], exclamation: ["叹号", "注意"], lock: ["锁"], key: ["钥匙"],
  phone: ["电话", "手机"], computer: ["电脑", "笔记本"], book: ["书", "书本"],
  coffee: ["咖啡"], beer: ["啤酒", "干杯"], apple: ["苹果"], banana: ["香蕉"],
  snowman: ["雪人", "雪"], rain: ["雨", "下雨"], cloud: ["云", "多云"],
  zap: ["闪电", "电"], snowflake: ["雪花"], car: ["车", "汽车"],
  airplane: ["飞机", "飞"], ship: ["船"], bicycle: ["自行车", "单车"],
  watch: ["手表", "表"], clock: ["时钟", "时间"], calendar: ["日历", "日期"],
  envelope: ["邮件", "信"], bell: ["铃铛", "提醒"], pencil: ["铅笔", "笔"],
  scissors: ["剪刀"], hammer: ["锤子"], lightbulb: ["灯泡", "灵感", "想法"],
  gear: ["齿轮", "设置"], battery: ["电池"], warning: ["警告", "注意"],
  info: ["信息", "提示"], recycle: ["回收", "环保"], flag: ["旗帜", "旗"],
  cn: ["中国", "国旗"], us: ["美国", "国旗"], jp: ["日本", "国旗"],
  video: ["视频", "电影"], music: ["音乐", "歌"], game: ["游戏", "手柄"],
  ball: ["球", "运动"], trophy: ["奖杯", "冠军"], medal: ["奖牌", "奖"],
  money: ["钱", "金钱", "财富"], bank: ["银行", "钱"], gem: ["宝石", "钻石"],
  boom: ["爆炸", "震惊"], ghost: ["鬼", "幽灵"], skull: ["骷髅", "死"],
  alien: ["外星人"], robot: ["机器人"], monkey: ["猴子", "猴"], pig: ["猪"],
  chicken: ["鸡"], bird: ["鸟", "小鸟"], fish: ["鱼"], bee: ["蜜蜂", "蜂"],
  butterfly: ["蝴蝶"], turtle: ["乌龟"], snake: ["蛇"], dragon: ["龙", "龙年"],
  horse: ["马"], rabbit: ["兔子", "兔"], tiger: ["老虎", "虎"], bear: ["熊"],
  panda: ["熊猫"], penguin: ["企鹅"], frog: ["青蛙"], owl: ["猫头鹰"],
  fox: ["狐狸"], wolf: ["狼"], koala: ["考拉", "树袋熊"], lion: ["狮子", "狮"],
  elephant: ["大象"], giraffe: ["长颈鹿"], zebra: ["斑马"], camel: ["骆驼"],
  spider: ["蜘蛛"], bug: ["虫子", "虫"], ant: ["蚂蚁"], snail: ["蜗牛"],
  eggplant: ["茄子"], tomato: ["西红柿", "番茄"], corn: ["玉米"],
  watermelon: ["西瓜"], grapes: ["葡萄"], cherry: ["樱桃", "车厘子"],
  peach: ["桃子"], strawberry: ["草莓"], lemon: ["柠檬"], pineapple: ["菠萝"],
  coconut: ["椰子"], pizza: ["披萨", "比萨"], burger: ["汉堡", "汉堡包"],
  fries: ["薯条", "炸薯条"], hotdog: ["热狗"], taco: ["卷饼", "塔可"],
  donut: ["甜甜圈", "面包圈"], cake: ["蛋糕", "甜点"], cookie: ["曲奇", "饼干"],
  candy: ["糖果", "糖"], icecream: ["冰淇淋", "雪糕"],
  chocolate: ["巧克力", "巧克力豆"], tea: ["茶", "喝茶"], milk: ["牛奶", "奶"],
  juice: ["果汁", "饮料"], champagne: ["香槟", "干杯"], cocktail: ["鸡尾酒", "酒"],
  soccer: ["足球", "球赛"], basketball: ["篮球", "球"], baseball: ["棒球"],
  tennis: ["网球"], golf: ["高尔夫"], swim: ["游泳", "游泳运动"],
  run: ["跑步", "跑"], sleep: ["睡觉", "睡", "困"], dizzy: ["晕", "晕头"],
  sweat: ["汗", "出汗"], angry: ["生气", "愤怒", "怒"], rage: ["生气", "愤怒"],
  scream: ["尖叫", "喊"], kiss: ["亲亲", "亲吻", "亲"], love: ["爱", "喜欢"],
  wink: ["眨眼", "放电"], blush: ["害羞", "脸红"], hush: ["嘘", "安静"],
  sick: ["生病", "病", "难受"], nauseated: ["恶心", "想吐"], mask: ["口罩", "防护"],
  sunglasses: ["墨镜", "太阳镜", "酷"], crown: ["皇冠", "王冠", "国王"],
  sparkles: ["闪光", "闪闪", "闪耀"], star2: ["星光", "闪亮", "闪耀"],
};

function toChar(unified) {
  // unified 形如 "1F600" 或 "1F1E8 1F1F3"（多个码位用空格分隔）
  return unified.split(" ").map((h) => String.fromCodePoint(parseInt(h, 16))).join("");
}

const groups = new Set(Object.keys(GROUP_MAP));
const out = { emoji: [] };
for (const e of raw) {
  if (!groups.has(e.category)) continue; // 过滤 Component 等非完整表情
  const [group, groupZh] = GROUP_MAP[e.category];
  const keywords = [...new Set([e.short_name, ...(e.short_names || [])])];
  const zh = ZH_HINTS[e.short_name] || [];
  const nameEn = (e.name || "").toLowerCase().replace(/_/g, " ");
  out.emoji.push({
    char: toChar(e.unified),
    group,
    group_zh: groupZh,
    name_en: nameEn,
    keywords,
    keywords_zh: zh,
  });
}
out.emoji.sort((a, b) => a.keywords[0].localeCompare(b.keywords[0]));
writeFileSync(output, JSON.stringify(out));
console.log(`generated ${out.emoji.length} emoji -> ${output}`);
```

- [ ] **Step 2: 编写验证脚本**

`tools/gen-emoji.test.mjs`:

```js
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
```

- [ ] **Step 3: 运行生成脚本并验证**

```bash
cd D:\SystemFiles\Documents\Project\EasyTool
node tools/gen-emoji.mjs C:\Users\Aliboder\AppData\Local\Temp\opencode\package\emoji.json src-tauri\modules\emoji\emoji.json
node tools/gen-emoji.test.mjs src-tauri\modules\emoji\emoji.json
```

Expected: 输出 `generated ~1800 emoji` 且验证脚本打印 `OK: ... 9 groups`。

- [ ] **Step 4: Commit**

```bash
git add tools/gen-emoji.mjs tools/gen-emoji.test.mjs src-tauri/modules/emoji/emoji.json
git commit -m "feat(emoji): 内置 Emoji 数据生成脚本与资源文件"
```

---

### Task 2: Rust 后端骨架（db 层 + 数据层 + 命令层 + 模块注册）

**Files:**
- Create: `src-tauri/modules/emoji/manifest.json`
- Create: `src-tauri/src/modules/emoji/mod.rs`
- Create: `src-tauri/src/modules/emoji/db.rs`
- Create: `src-tauri/src/modules/emoji/data.rs`
- Create: `src-tauri/src/modules/emoji/commands.rs`
- Create: `src-tauri/src/modules/emoji/paste.rs`
- Modify: `src-tauri/src/modules/mod.rs`（追加 `pub mod emoji;`）
- Modify: `src-tauri/src/lib.rs`（setup 调用 + invoke_handler 注册 + 热键注册/分发 + 启用判断 + pub(crate) 函数）
- Modify: `src-tauri/src/modules/clipboard/mod.rs`（`popup_position_physical` 改 `pub(crate)`）

**Interfaces:**
- Consumes: Task 1 的 `src-tauri/modules/emoji/emoji.json`；`clipboard::clipboard::write_text_rich` / `write_image_rgba` / `read_image_rgba` / `rgba_to_png`（均为 pub）
- Produces: 命令 `get_emoji_all`、`get_groups`、`import_emoji_files`、`add_emoji_from_clipboard`、`delete_custom_emoji`、`rename_custom_emoji`、`move_custom_emoji`、`create_group`、`rename_group`、`delete_group`、`record_use`、`toggle_favorite`、`get_emoji_thumb`、`apply_emoji`、`save_emoji_settings`；函数 `emoji_enabled(app)`、`modules::emoji::setup(app)`、`modules::emoji::on_hotkey(app)`

- [ ] **Step 1: 写 manifest**

`src-tauri/modules/emoji/manifest.json`:

```json
{
  "id": "emoji",
  "name": "表情",
  "icon": "smile",
  "enabled": true,
  "default_config": {
    "hotkey": "Ctrl+Shift+J",
    "click_action": "paste",
    "follow_mouse": true
  }
}
```

- [ ] **Step 2: 写 db 层（含单元测试）**

`src-tauri/src/modules/emoji/db.rs`:

```rust
//! emojis.db：图片表情、分组、使用统计、收藏（内置 Emoji 动态数据也存于此）
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS custom_emojis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                name TEXT NOT NULL,
                group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                use_count INTEGER NOT NULL DEFAULT 0,
                last_used_at INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS emoji_usage (
                char TEXT PRIMARY KEY,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                use_count INTEGER NOT NULL DEFAULT 0,
                last_used_at INTEGER
            );",
        )?;
        Ok(Db { conn: Mutex::new(conn) })
    }

    pub fn create_group(&self, name: &str) -> Result<i64, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT INTO groups (name) VALUES (?1)", params![name])?;
        Ok(conn.last_insert_rowid())
    }

    pub fn rename_group(&self, id: i64, name: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE groups SET name = ?1 WHERE id = ?2", params![name, id])?;
        Ok(())
    }

    pub fn delete_group(&self, id: i64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM groups WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_groups(&self) -> Result<Vec<(i64, String)>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name FROM groups ORDER BY sort_order, id")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn insert_custom(&self, file_path: &str, name: &str) -> Result<i64, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let now = now_ms();
        conn.execute(
            "INSERT INTO custom_emojis (file_path, name, created_at) VALUES (?1, ?2, ?3)",
            params![file_path, name, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn set_custom_path(&self, id: i64, path: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE custom_emojis SET file_path = ?1 WHERE id = ?2",
            params![path, id],
        )?;
        Ok(())
    }

    pub fn delete_custom(&self, id: i64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM custom_emojis WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn rename_custom(&self, id: i64, name: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE custom_emojis SET name = ?1 WHERE id = ?2",
            params![name, id],
        )?;
        Ok(())
    }

    pub fn move_custom(&self, id: i64, group_id: Option<i64>) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE custom_emojis SET group_id = ?1 WHERE id = ?2",
            params![group_id, id],
        )?;
        Ok(())
    }

    pub fn get_custom(&self, id: i64) -> Result<Option<(String, String)>, rusqlite::Error> {
        // 返回 (file_path, name)
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT file_path, name FROM custom_emojis WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.next().transpose()
    }

    pub fn list_custom(&self) -> Result<Vec<CustomRow>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, file_path, name, group_id, is_favorite, use_count, last_used_at, created_at
             FROM custom_emojis ORDER BY is_favorite DESC, use_count DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(CustomRow {
                id: r.get(0)?,
                file_path: r.get(1)?,
                name: r.get(2)?,
                group_id: r.get(3)?,
                is_favorite: r.get(4)?,
                use_count: r.get(5)?,
                last_used_at: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn record_use_custom(&self, id: i64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE custom_emojis SET use_count = use_count + 1, last_used_at = ?1 WHERE id = ?2",
            params![now_ms(), id],
        )?;
        Ok(())
    }

    pub fn toggle_fav_custom(&self, id: i64, fav: bool) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE custom_emojis SET is_favorite = ?1 WHERE id = ?2",
            params![fav as i64, id],
        )?;
        Ok(())
    }

    pub fn record_use_builtin(&self, char_key: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO emoji_usage (char, use_count, last_used_at) VALUES (?1, 1, ?2)
             ON CONFLICT(char) DO UPDATE SET
               use_count = use_count + 1, last_used_at = excluded.last_used_at",
            params![char_key, now_ms()],
        )?;
        Ok(())
    }

    pub fn toggle_fav_builtin(&self, char_key: &str, fav: bool) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO emoji_usage (char, is_favorite) VALUES (?1, ?2)
             ON CONFLICT(char) DO UPDATE SET is_favorite = excluded.is_favorite",
            params![char_key, fav as i64],
        )?;
        Ok(())
    }

    pub fn usage_map(&self) -> Result<std::collections::HashMap<String, (i64, i64, i64)>, rusqlite::Error> {
        // char -> (is_favorite, use_count, last_used_at)
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT char, is_favorite, use_count, last_used_at FROM emoji_usage")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?)))
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CustomRow {
    pub id: i64,
    pub file_path: String,
    pub name: String,
    pub group_id: Option<i64>,
    pub is_favorite: bool,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_mem() -> Db {
        Db::open(Path::new(":memory:")).unwrap()
    }

    #[test]
    fn group_crud() {
        let db = open_mem();
        let g = db.create_group("工作").unwrap();
        assert_eq!(db.rename_group(g, "工作2").unwrap(), ());
        assert_eq!(db.list_groups().unwrap().len(), 1);
        db.delete_group(g).unwrap();
        assert!(db.list_groups().unwrap().is_empty());
    }

    #[test]
    fn custom_emoji_crud_and_stats() {
        let db = open_mem();
        let id = db.insert_custom("/x/a.png", "a").unwrap();
        db.record_use_custom(id).unwrap();
        db.record_use_custom(id).unwrap();
        let row = db.list_custom().unwrap();
        assert_eq!(row.len(), 1);
        assert_eq!(row[0].use_count, 2);
        db.toggle_fav_custom(id, true).unwrap();
        let row = db.list_custom().unwrap();
        assert!(row[0].is_favorite);
        db.delete_custom(id).unwrap();
        assert!(db.list_custom().unwrap().is_empty());
    }

    #[test]
    fn group_delete_sets_null() {
        let db = open_mem();
        let g = db.create_group("g").unwrap();
        let id = db.insert_custom("/x/b.png", "b").unwrap();
        db.move_custom(id, Some(g)).unwrap();
        db.delete_group(g).unwrap();
        let row = db.list_custom().unwrap();
        assert_eq!(row[0].group_id, None);
    }

    #[test]
    fn builtin_usage_upsert() {
        let db = open_mem();
        db.record_use_builtin("😀").unwrap();
        db.record_use_builtin("😀").unwrap();
        let m = db.usage_map().unwrap();
        assert_eq!(m["😀"].1, 2);
        db.toggle_fav_builtin("😀", true).unwrap();
        let m = db.usage_map().unwrap();
        assert_eq!(m["😀"].0, 1);
    }
}
```

- [ ] **Step 3: 写数据层（加载 emoji.json + 检索，含单元测试）**

`src-tauri/src/modules/emoji/data.rs`:

```rust
//! 内置 Emoji 数据加载与检索（读取资源 emoji.json）
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize)]
pub struct EmojiEntry {
    pub char: String,
    pub group: String,
    pub group_zh: String,
    pub name_en: String,
    pub keywords: Vec<String>,
    pub keywords_zh: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Catalog {
    emoji: Vec<EmojiEntry>,
}

static CATALOG: OnceLock<Vec<EmojiEntry>> = OnceLock::new();

/// 从模块资源目录加载 emoji.json；失败返回空列表（图片表情功能不受影响）
pub fn load(dir: &std::path::Path) -> &'static Vec<EmojiEntry> {
    CATALOG.get_or_init(|| {
        let path = dir.join("emoji").join("emoji.json");
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str::<Catalog>(&text)
                .map(|c| c.emoji)
                .unwrap_or_default(),
            Err(e) => {
                log::warn!("failed to load emoji.json: {e}");
                Vec::new()
            }
        }
    })
}

/// 按分组过滤 + 关键词检索（命中 name_en/keywords/keywords_zh 任一项）
/// q 为空且 group 为空返回全量；q 为空时按 group 过滤
pub fn search(entries: &[EmojiEntry], q: &str, group: &str) -> Vec<&EmojiEntry> {
    let q = q.trim().to_lowercase();
    entries
        .iter()
        .filter(|e| group.is_empty() || e.group == group)
        .filter(|e| {
            if q.is_empty() {
                return true;
            }
            e.name_en.to_lowercase().contains(&q)
                || e.keywords.iter().any(|k| k.to_lowercase().contains(&q))
                || e.keywords_zh.iter().any(|k| k.contains(q.trim()))
        })
        .collect()
}

pub fn groups() -> &'static [(&'static str, &'static str)] {
    &[
        ("smileys", "笑脸"),
        ("people", "人物"),
        ("animals", "动物"),
        ("food", "食物"),
        ("travel", "旅行"),
        ("activities", "活动"),
        ("objects", "物品"),
        ("symbols", "符号"),
        ("flags", "旗帜"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<EmojiEntry> {
        vec![
            EmojiEntry {
                char: "😀".into(),
                group: "smileys".into(),
                group_zh: "笑脸".into(),
                name_en: "grinning face".into(),
                keywords: vec!["grinning".into(), "face".into()],
                keywords_zh: vec!["笑脸".into(), "高兴".into()],
            },
            EmojiEntry {
                char: "🐱".into(),
                group: "animals".into(),
                group_zh: "动物".into(),
                name_en: "cat face".into(),
                keywords: vec!["cat".into()],
                keywords_zh: vec!["猫".into()],
            },
        ]
    }

    #[test]
    fn search_by_keyword_en() {
        let f = fixture();
        assert_eq!(search(&f, "cat", "").len(), 1);
        assert_eq!(search(&f, "CAT", "").len(), 1);
    }

    #[test]
    fn search_by_chinese() {
        let f = fixture();
        assert_eq!(search(&f, "笑脸", "").len(), 1);
        assert_eq!(search(&f, "高兴", "").len(), 1);
    }

    #[test]
    fn filter_by_group() {
        let f = fixture();
        assert_eq!(search(&f, "", "animals").len(), 1);
        assert_eq!(search(&f, "", "smileys").len(), 1);
    }

    #[test]
    fn empty_query_returns_all() {
        let f = fixture();
        assert_eq!(search(&f, "", "").len(), 2);
    }

    #[test]
    fn load_from_disk() {
        // 用真实生成的资源验证可解析
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("modules");
        let list = load(&dir);
        assert!(!list.is_empty(), "emoji.json 应可加载");
    }
}
```

- [ ] **Step 4: 写命令层**

`src-tauri/src/modules/emoji/commands.rs`:

```rust
//! 表情模块 IPC 命令
use super::db::{Db, CustomRow};
use crate::modules::clipboard::clipboard;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

// 为满足 tauri::command 返回类型，直接返回 Result<T, String>
type R<T> = Result<T, String>;

fn module_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().map(|d| d.join("emojis")).unwrap_or_else(|_| PathBuf::from("emojis"))
}

fn base64(b: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(b)
}

fn thumb_png(path: &str) -> Option<String> {
    let img = image::open(path).ok()?;
    let thumb = img.thumbnail(96, 96);
    let mut buf = Vec::new();
    thumb.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).ok()?;
    Some(base64(&buf))
}

#[derive(Serialize, Clone)]
pub struct EmojiDto {
    pub char: String,
    pub group: String,
    pub group_zh: String,
    pub name_en: String,
    pub keywords_zh: Vec<String>,
    pub is_favorite: bool,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct CustomDto {
    pub id: i64,
    pub name: String,
    pub group_id: Option<i64>,
    pub is_favorite: bool,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub thumb: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct GroupDto {
    pub id: i64,
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct EmojiCatalog {
    pub emoji: Vec<EmojiDto>,
    pub groups: Vec<GroupDto>,
    pub customs: Vec<CustomDto>,
}

/// 获取全量数据（内置 emoji + 分组 + 图片表情），前端一次拉取
#[tauri::command]
pub fn get_emoji_all(app: AppHandle, state: State<'_, Db>) -> R<EmojiCatalog> {
    let dir = crate::modules::modules_dir(&app);
    let entries = super::data::load(&dir);
    let usage = state.usage_map().map_err(|e| e.to_string())?;
    let emoji: Vec<EmojiDto> = entries
        .iter()
        .map(|e| {
            let u = usage.get(&e.char).copied().unwrap_or((0, 0, None));
            EmojiDto {
                char: e.char.clone(),
                group: e.group.clone(),
                group_zh: e.group_zh.clone(),
                name_en: e.name_en.clone(),
                keywords_zh: e.keywords_zh.clone(),
                is_favorite: u.0 != 0,
                use_count: u.1,
                last_used_at: u.2,
            }
        })
        .collect();
    let groups = state
        .list_groups()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(id, name)| GroupDto { id, name })
        .collect();
    let customs = state
        .list_custom()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|c: CustomRow| CustomDto {
            id: c.id,
            name: c.name,
            group_id: c.group_id,
            is_favorite: c.is_favorite,
            use_count: c.use_count,
            last_used_at: c.last_used_at,
            thumb: thumb_png(&c.file_path),
        })
        .collect();
    Ok(EmojiCatalog { emoji, groups, customs })
}

#[tauri::command]
pub fn get_groups(state: State<'_, Db>) -> R<Vec<GroupDto>> {
    let rows = state.list_groups().map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|(id, name)| GroupDto { id, name }).collect())
}

/// 导入本地图片文件为表情：复制到 emojis/ 目录 + 入库；失败回滚已复制文件
#[tauri::command]
pub fn import_emoji_files(app: AppHandle, state: State<'_, Db>, paths: Vec<String>) -> R<Vec<i64>> {
    const EXTS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];
    let dir = module_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for p in paths {
        let src = Path::new(&p);
        let ext = src.extension().and_then(|e| e.to_str()).map(str::to_lowercase).unwrap_or_default();
        if !EXTS.contains(&ext.as_str()) {
            return Err(format!("不支持的文件类型: {p}"));
        }
        let name = src.file_name().and_then(|n| n.to_str()).unwrap_or("表情").to_string();
        let id = state.insert_custom("", &name).map_err(|e| e.to_string())?;
        let dst = dir.join(format!("{id}.{ext}"));
        if std::fs::copy(&src, &dst).is_err() {
            let _ = state.delete_custom(id);
            return Err(format!("复制文件失败: {p}"));
        }
        state.set_custom_path(id, dst.to_string_lossy().as_ref()).map_err(|e| e.to_string())?;
        ids.push(id);
    }
    Ok(ids)
}

/// 从剪贴板添加图片为表情（读 CF_DIB → 存 PNG → 入库）
#[tauri::command]
pub fn add_emoji_from_clipboard(app: AppHandle, state: State<'_, Db>) -> R<i64> {
    let Some((rgba, w, h)) = clipboard::read_image_rgba() else {
        return Err("剪贴板中没有图片".into());
    };
    let png = clipboard::rgba_to_png(&rgba, w, h).map_err(|e| e.to_string())?;
    let dir = module_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = state.insert_custom("", "剪贴板图片").map_err(|e| e.to_string())?;
    let dst = dir.join(format!("{id}.png"));
    std::fs::write(&dst, &png).map_err(|e| e.to_string())?;
    state.set_custom_path(id, dst.to_string_lossy().as_ref()).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn delete_custom_emoji(state: State<'_, Db>, id: i64) -> R<()> {
    let path = state.get_custom(id).map_err(|e| e.to_string())?.map(|(p, _)| p);
    state.delete_custom(id).map_err(|e| e.to_string())?;
    if let Some(p) = path {
        let _ = std::fs::remove_file(&p);
    }
    Ok(())
}

#[tauri::command]
pub fn rename_custom_emoji(state: State<'_, Db>, id: i64, name: String) -> R<()> {
    state.rename_custom(id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_custom_emoji(state: State<'_, Db>, id: i64, group_id: Option<i64>) -> R<()> {
    state.move_custom(id, group_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_group(state: State<'_, Db>, name: String) -> R<i64> {
    state.create_group(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_group(state: State<'_, Db>, id: i64, name: String) -> R<()> {
    state.rename_group(id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_group(state: State<'_, Db>, id: i64) -> R<()> {
    state.delete_group(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_use(state: State<'_, Db>, kind: String, key: String) -> R<()> {
    match kind.as_str() {
        "emoji" => state.record_use_builtin(&key).map_err(|e| e.to_string()),
        "custom" => {
            let id = key.parse::<i64>().map_err(|e| e.to_string())?;
            state.record_use_custom(id).map_err(|e| e.to_string())
        }
        _ => Err("未知类型".into()),
    }
}

#[tauri::command]
pub fn toggle_favorite(state: State<'_, Db>, kind: String, key: String, fav: bool) -> R<()> {
    match kind.as_str() {
        "emoji" => state.toggle_fav_builtin(&key, fav).map_err(|e| e.to_string()),
        "custom" => {
            let id = key.parse::<i64>().map_err(|e| e.to_string())?;
            state.toggle_fav_custom(id, fav).map_err(|e| e.to_string())
        }
        _ => Err("未知类型".into()),
    }
}

#[tauri::command]
pub fn get_emoji_thumb(state: State<'_, Db>, id: i64) -> R<Option<String>> {
    let path = state.get_custom(id).map_err(|e| e.to_string())?.map(|(p, _)| p);
    Ok(path.and_then(|p| thumb_png(&p)))
}

/// 应用表情：记录使用 → 按配置粘贴到唤起前窗口或复制到剪贴板
#[tauri::command]
pub fn apply_emoji(app: AppHandle, state: State<'_, Db>, kind: String, key: String) -> R<()> {
    let click_action = super::module_config(&app)
        .get("click_action")
        .and_then(|v| v.as_str())
        .unwrap_or("paste")
        .to_string();
    // 先记录使用
    if kind == "emoji" {
        let _ = state.record_use_builtin(&key);
    } else if let Ok(id) = key.parse::<i64>() {
        let _ = state.record_use_custom(id);
    }
    let write: Box<dyn FnOnce() -> bool + Send> = if kind == "emoji" {
        let text = key.clone();
        Box::new(move || clipboard::write_text_rich(&text, None))
    } else {
        let id: i64 = key.parse().map_err(|e| e.to_string())?;
        let path = state.get_custom(id).map_err(|e| e.to_string())?.map(|(p, _)| p)
            .ok_or("表情不存在")?;
        Box::new(move || {
            std::fs::read(&path).ok().and_then(|b| image::load_from_memory(&b).ok()).map(|img| {
                let rgba = img.to_rgba8();
                clipboard::write_image_rgba(rgba.as_raw(), rgba.width(), rgba.height())
            }).unwrap_or(false)
        })
    };
    if click_action == "paste" {
        super::paste::apply_to_foreground(write).map_err(|e| e.to_string())
    } else {
        if write() {
            Ok(())
        } else {
            Err("写入剪贴板失败".into())
        }
    }
}

/// 保存模块配置（热键/点击行为）
#[tauri::command]
pub fn save_emoji_settings(app: AppHandle, hotkey: String, click_action: String, follow_mouse: bool) -> R<()> {
    let mut cfg = app.state::<crate::config::ConfigState>().0.lock().unwrap();
    let m = cfg.modules.entry("emoji".into()).or_default();
    m["hotkey"] = serde_json::json!(hotkey);
    m["click_action"] = serde_json::json!(click_action);
    m["follow_mouse"] = serde_json::json!(follow_mouse);
    drop(cfg);
    crate::config::save_config(&app).map_err(|e| e.to_string())?;
    crate::reapply_hotkeys(&app);
    Ok(())
}

// ---- 单元测试 ----

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumb_png_resizes() {
        let dir = std::env::temp_dir().join(format!("emoji-thumb-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let rgba = vec![255u8, 0, 0, 255].repeat(200 * 100);
        let png = clipboard::rgba_to_png(&rgba, 200, 100).unwrap();
        let p = dir.join("t.png");
        std::fs::write(&p, &png).unwrap();
        let b64 = thumb_png(p.to_str().unwrap()).expect("缩略图应生成");
        assert!(b64.len() > 100);
        let decoded = image::load_from_memory(&base64::engine::general_purpose::STANDARD.decode(&b64).unwrap()).unwrap();
        assert_eq!(decoded.width(), 96);
        assert_eq!(decoded.height(), 48);
        std::fs::remove_dir_all(dir).ok();
    }
}
```

> 注：`base64` crate 未被 `Cargo.toml` 直接依赖。需在 `Cargo.toml` `[dependencies]` 追加 `base64 = "0.22"`（`clipboard/monitor.rs` 已有 `base64_encode` 但为私有）。若改用 `crate::modules::clipboard::monitor::base64_encode`（pub），则无需新增依赖——执行时选后者，避免加依赖。

- [ ] **Step 5: 模块入口 + 粘贴层 + 注册**

`src-tauri/src/modules/emoji/paste.rs`（复刻剪贴板粘贴机制，内容由调用方提供）:

```rust
//! 粘贴到唤起前窗口：写剪贴板 → 还原前台窗口与焦点控件 → 模拟 Ctrl+V
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::OnceLock;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, SetFocus, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    VK_CONTROL, VK_V,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, SendMessageW,
    SetForegroundWindow, GUITHREADINFO,
};

const EM_GETSEL: u32 = 0x00B0;
const EM_SETSEL: u32 = 0x00B1;

pub struct ForegroundState {
    pub hwnd: AtomicIsize,
    pub focus: AtomicIsize,
    pub sel_start: AtomicIsize,
    pub sel_end: AtomicIsize,
}

impl Default for ForegroundState {
    fn default() -> Self {
        ForegroundState {
            hwnd: AtomicIsize::new(0),
            focus: AtomicIsize::new(0),
            sel_start: AtomicIsize::new(0),
            sel_end: AtomicIsize::new(0),
        }
    }
}

static FOREGROUND: OnceLock<ForegroundState> = OnceLock::new();

fn record_foreground() -> (isize, isize, u32, u32) {
    unsafe {
        let hwnd = GetForegroundWindow().0 as isize;
        let focus = get_focus_control(HWND(hwnd as *mut core::ffi::c_void));
        let (s, e) = get_selection(focus);
        (hwnd, focus.0 as isize, s, e)
    }
}

fn get_selection(hwnd: HWND) -> (u32, u32) {
    if hwnd.0.is_null() {
        return (0, 0);
    }
    unsafe {
        let r = SendMessageW(hwnd, EM_GETSEL, Some(WPARAM(0)), Some(LPARAM(0)));
        ((r.0 >> 16) as u32, (r.0 & 0xFFFF) as u32)
    }
}

fn restore_selection(hwnd: HWND, start: u32, end: u32) {
    if hwnd.0.is_null() {
        return;
    }
    unsafe {
        let _ = SendMessageW(hwnd, EM_SETSEL, Some(WPARAM(start as usize)), Some(LPARAM(end as isize)));
    }
}

fn get_focus_control(hwnd: HWND) -> HWND {
    unsafe {
        if hwnd.0.is_null() {
            return HWND(std::ptr::null_mut());
        }
        let thread_id = GetWindowThreadProcessId(hwnd, None);
        if thread_id == 0 {
            return HWND(std::ptr::null_mut());
        }
        let mut gui = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        if GetGUIThreadInfo(thread_id, &mut gui).is_ok() {
            gui.hwndFocus
        } else {
            HWND(std::ptr::null_mut())
        }
    }
}

fn restore_focus(target: HWND, focus_control: HWND) -> bool {
    unsafe {
        let activated = SetForegroundWindow(target).as_bool();
        let target_thread = GetWindowThreadProcessId(target, None);
        let current_thread = GetCurrentThreadId();
        let focus_ok = if !focus_control.0.is_null() {
            if target_thread != 0 && target_thread != current_thread {
                if AttachThreadInput(current_thread, target_thread, true).as_bool() {
                    let ok = SetFocus(Some(focus_control)).is_ok();
                    let _ = AttachThreadInput(current_thread, target_thread, false);
                    ok
                } else {
                    false
                }
            } else {
                SetFocus(Some(focus_control)).is_ok()
            }
        } else {
            activated
        };
        activated || focus_ok
    }
}

fn send_ctrl_v() {
    unsafe {
        let inputs = [
            key_input(VK_CONTROL, false),
            key_input(VK_V, false),
            key_input(VK_V, true),
            key_input(VK_CONTROL, true),
        ];
        let _ = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn key_input(key: VIRTUAL_KEY, keyup: bool) -> INPUT {
    let mut ki = KEYBDINPUT {
        wVk: key,
        ..Default::default()
    };
    if keyup {
        ki.dwFlags = KEYEVENTF_KEYUP;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki },
    }
}

/// 记录唤起前窗口上下文（呼出悬浮面板前调用）
pub fn record_foreground_state(_app: &tauri::AppHandle) {
    let (hwnd, focus, s, e) = record_foreground();
    let st = FOREGROUND.get_or_init(ForegroundState::default);
    st.hwnd.store(hwnd, Ordering::SeqCst);
    st.focus.store(focus, Ordering::SeqCst);
    st.sel_start.store(s as isize, Ordering::SeqCst);
    st.sel_end.store(e as isize, Ordering::SeqCst);
}

/// 写剪贴板内容并粘贴到唤起前窗口；write 为写入剪贴板的闭包（返回是否成功）
pub fn apply_to_foreground(write: impl FnOnce() -> bool) -> Result<(), String> {
    if !write() {
        return Err("写入剪贴板失败".into());
    }
    let st = FOREGROUND.get_or_init(ForegroundState::default);
    let win_hwnd = st.hwnd.load(Ordering::SeqCst);
    let focus_hwnd = st.focus.load(Ordering::SeqCst);
    let sel_start = st.sel_start.load(Ordering::SeqCst) as u32;
    let sel_end = st.sel_end.load(Ordering::SeqCst) as u32;
    if win_hwnd == 0 {
        log::warn!("no previous foreground window, only copied to clipboard");
        return Ok(());
    }
    let focus = HWND(focus_hwnd as *mut core::ffi::c_void);
    let restored = restore_focus(HWND(win_hwnd as *mut core::ffi::c_void), focus);
    if !restored {
        return Err("无法还原原窗口焦点，内容已复制到剪贴板，请手动粘贴".into());
    }
    restore_selection(focus, sel_start, sel_end);
    std::thread::sleep(std::time::Duration::from_millis(60));
    send_ctrl_v();
    log::info!("pasted emoji to hwnd={win_hwnd}");
    Ok(())
}
```

`src-tauri/src/modules/emoji/mod.rs`:

```rust
//! 表情模块：内置 Emoji + 图片表情 + 悬浮面板
pub mod commands;
pub mod data;
pub mod db;
pub mod paste;

use crate::config::ConfigState;
use tauri::Manager;
use windows::Win32::UI::WindowsAndMessaging::SetWindowPos;

pub const POPUP_WINDOW_LABEL: &str = "emoji_popup";

pub fn module_config(app: &tauri::AppHandle) -> serde_json::Value {
    app.state::<ConfigState>()
        .0
        .lock()
        .unwrap()
        .modules
        .get("emoji")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}))
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db = db::Db::open(&data_dir.join("emojis.db")).expect("failed to init emoji db");
    app.manage(db);
    // 预加载内置数据（模块资源目录）
    let dir = crate::modules::modules_dir(handle);
    let _ = data::load(&dir);
    log::info!("emoji module ready");
    Ok(())
}

/// 记录唤起前窗口上下文，随后显示悬浮面板
pub fn on_hotkey(app: &tauri::AppHandle) {
    paste::record_foreground_state(app);
    let Some(win) = ensure_popup_window(app) else { return };
    if let Ok(hwnd) = win.hwnd() {
        let cfg = module_config(app);
        let follow_mouse = cfg.get("follow_mouse").and_then(|v| v.as_bool()).unwrap_or(true);
        let (x, y) = if follow_mouse {
            crate::popup_position_physical(hwnd)
        } else {
            cfg.get("fixed_pos")
                .and_then(|p| Some((p.get("x")?.as_i64()? as i32, p.get("y")?.as_i64()? as i32)))
                .unwrap_or_else(|| crate::popup_position_physical(hwnd))
        };
        unsafe {
            let _ = SetWindowPos(hwnd, None, x, y, 0, 0, 0x0004 | 0x0002 | 0x0008);
        }
    }
    let _ = win.show();
    let _ = win.set_focus();
}

fn ensure_popup_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window(POPUP_WINDOW_LABEL) {
        return Some(win);
    }
    let win = tauri::WebviewWindowBuilder::new(
        app,
        POPUP_WINDOW_LABEL,
        tauri::WebviewUrl::App("emoji_popup.html".into()),
    )
    .decorations(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(400.0, 320.0)
    .min_inner_size(320.0, 240.0)
    .resizable(true)
    .always_on_top(true)
    .build();
    match win {
        Ok(win) => Some(win),
        Err(e) => {
            log::error!("failed to create emoji popup window: {e}");
            None
        }
    }
}
```

`src-tauri/src/modules/mod.rs` 追加：`pub mod emoji;`

`src-tauri/src/modules/clipboard/mod.rs`：`fn popup_position_physical` 改为 `pub(crate) fn popup_position_physical`（供 lib.rs 转发）。

`src-tauri/src/lib.rs` 修改：

```rust
// 1) 模块启用判断（仿 clipboard_enabled）
fn emoji_enabled(app: &tauri::AppHandle) -> bool {
    app.try_state::<ConfigState>()
        .map(|s| {
            s.0.lock()
                .unwrap()
                .modules
                .get("emoji")
                .and_then(|m| m.get("enabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

// 2) setup 中启用时初始化（与 clipboard/quota 并列，位于它们之后）
if emoji_enabled(app.handle()) {
    modules::emoji::setup(app)?;
}

// 3) invoke_handler 注册命令（追加到 generate_handler! 列表末尾）
modules::emoji::commands::get_emoji_all,
modules::emoji::commands::get_groups,
modules::emoji::commands::import_emoji_files,
modules::emoji::commands::add_emoji_from_clipboard,
modules::emoji::commands::delete_custom_emoji,
modules::emoji::commands::rename_custom_emoji,
modules::emoji::commands::move_custom_emoji,
modules::emoji::commands::create_group,
modules::emoji::commands::rename_group,
modules::emoji::commands::delete_group,
modules::emoji::commands::record_use,
modules::emoji::commands::toggle_favorite,
modules::emoji::commands::get_emoji_thumb,
modules::emoji::commands::apply_emoji,
modules::emoji::commands::save_emoji_settings,

// 4) Hotkeys 结构增加 emoji_hotkey 字段，read_hotkeys 读取 emoji 热键
struct Hotkeys {
    unified: bool,
    clip_hotkey: String,
    emoji_hotkey: String,
    main_hotkey: String,
}

fn read_hotkeys(app: &tauri::AppHandle) -> Hotkeys {
    let state = app.state::<ConfigState>();
    let cfg = state.0.lock().unwrap();
    let clip_hotkey = cfg
        .modules
        .get("clipboard")
        .and_then(|m| m.get("hotkey"))
        .and_then(|v| v.as_str())
        .unwrap_or("Ctrl+Shift+V")
        .to_string();
    let emoji_hotkey = cfg
        .modules
        .get("emoji")
        .and_then(|m| m.get("hotkey"))
        .and_then(|v| v.as_str())
        .unwrap_or("Ctrl+Shift+J")
        .to_string();
    Hotkeys {
        unified: cfg.unified_hotkey,
        clip_hotkey,
        emoji_hotkey,
        main_hotkey: cfg
            .hotkeys
            .get("main")
            .cloned()
            .unwrap_or_else(|| "Ctrl+Shift+E".into()),
    }
}

// 5) reapply_hotkeys：unified=false 时同时注册剪贴板与表情热键
pub fn reapply_hotkeys(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister_all();
    let hk = read_hotkeys(app);
    if hk.unified {
        match app.global_shortcut().register(hk.main_hotkey.as_str()) {
            Ok(_) => log::info!("[unified] main hotkey registered: {}", hk.main_hotkey),
            Err(e) => log::error!("failed to register main hotkey: {e}"),
        }
    } else {
        if clipboard_enabled(app) {
            match app.global_shortcut().register(hk.clip_hotkey.as_str()) {
                Ok(_) => log::info!("clipboard hotkey registered: {}", hk.clip_hotkey),
                Err(e) => log::error!("failed to register clipboard hotkey: {e}"),
            }
        }
        if emoji_enabled(app) {
            match app.global_shortcut().register(hk.emoji_hotkey.as_str()) {
                Ok(_) => log::info!("emoji hotkey registered: {}", hk.emoji_hotkey),
                Err(e) => log::error!("failed to register emoji hotkey: {e}"),
            }
        }
    }
}

// 6) global_shortcut handler 的配置读取块返回值加 emoji_hotkey/emoji_enabled，
//    并在 clip_match 之后新增：
let emoji_match = Shortcut::from_str(&emoji_hotkey)
    .map(|s| s == *shortcut)
    .unwrap_or(false);
// 分支顺序（unified=false 时）：
if !unified && emoji_enabled && emoji_match {
    log::info!("emoji hotkey matched, showing popup");
    modules::emoji::on_hotkey(app);
} else if !unified && clip_enabled && clip_match {
    // ...原有 clipboard 分支...
} else if main_match {
    // ...原有 main 分支...
}

// 7) popup_position_physical 转发 + hide_after_blur_grace 改 pub(crate)
pub(crate) fn popup_position_physical(hwnd: windows::Win32::Foundation::HWND) -> (i32, i32) {
    modules::clipboard::popup_position_physical(hwnd)
}
// hide_after_blur_grace 的 fn 关键字改为 pub(crate) fn（Task 4 悬浮窗失焦隐藏复用）
```

- [ ] **Step 6: 运行后端测试**

```bash
cd D:\SystemFiles\Documents\Project\EasyTool\src-tauri
cargo test
```

Expected: 新增的 emoji 模块测试全部 PASS，原有 36 个测试不回归。

- [ ] **Step 7: Commit**

```bash
git add src-tauri/modules/emoji/manifest.json src-tauri/src/modules/emoji/ src-tauri/src/modules/mod.rs src-tauri/src/lib.rs src-tauri/src/modules/clipboard/mod.rs
git commit -m "feat(emoji): 后端骨架（db/数据/命令/粘贴/模块注册/热键）"
```

---

### Task 3: 前端主窗口模块页

**Files:**
- Create: `src/modules/emoji/Page.tsx`
- Create: `src/modules/emoji/Settings.tsx`
- Modify: `src/App.tsx`（lazy import + switch case + 设置区 + 图标映射）
- Modify: `src/components/layout/Sidebar.tsx`（图标映射新增 smile）

**Interfaces:**
- Consumes: Task 2 的命令 `get_emoji_all`、`get_groups`、`import_emoji_files`、`add_emoji_from_clipboard`、`delete_custom_emoji`、`rename_custom_emoji`、`move_custom_emoji`、`create_group`、`rename_group`、`delete_group`、`record_use`、`toggle_favorite`、`save_emoji_settings`
- Produces: 组件 `EmojiPage`、`EmojiSettings`

- [ ] **Step 1: 写主页面组件**

`src/modules/emoji/Page.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Search, Upload, ClipboardPaste, FolderPlus, Trash2, Star, StarOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmojiDto {
  char: string; group: string; group_zh: string; name_en: string; keywords_zh: string[];
  is_favorite: boolean; use_count: number; last_used_at: number | null;
}
interface CustomDto {
  id: number; name: string; group_id: number | null; is_favorite: boolean;
  use_count: number; last_used_at: number | null; thumb: string | null;
}
interface GroupDto { id: number; name: string }
interface Catalog {
  emoji: EmojiDto[]; groups: GroupDto[]; customs: CustomDto[];
}

const GROUP_TABS = [
  { id: "all", zh: "全部" },
  { id: "favorite", zh: "收藏" },
  { id: "smileys", zh: "笑脸" }, { id: "people", zh: "人物" },
  { id: "animals", zh: "动物" }, { id: "food", zh: "食物" },
  { id: "travel", zh: "旅行" }, { id: "activities", zh: "活动" },
  { id: "objects", zh: "物品" }, { id: "symbols", zh: "符号" }, { id: "flags", zh: "旗帜" },
];

export function EmojiPage() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [customGroups, setCustomGroups] = useState<GroupDto[]>([]);

  const load = async () => {
    const c = await invoke<Catalog>("get_emoji_all");
    setCat(c);
  };
  useEffect(() => { load().catch(console.error); }, []);

  const refreshCustom = async () => {
    const g = await invoke<GroupDto[]>("get_groups");
    setCustomGroups(g);
    await load();
  };

  const visibleEmoji = useMemo(() => {
    if (!cat) return [];
    const ql = q.trim().toLowerCase();
    let list = cat.emoji;
    if (tab === "favorite") list = list.filter((e) => e.is_favorite);
    else if (tab !== "all") list = list.filter((e) => e.group === tab);
    if (ql) {
      list = list.filter((e) =>
        e.name_en.toLowerCase().includes(ql) ||
        e.keywords_zh.some((k) => k.includes(q.trim()))
      );
    }
    return list;
  }, [cat, tab, q]);

  const visibleCustoms = useMemo(() => {
    if (!cat) return [];
    const ql = q.trim().toLowerCase();
    let list = cat.customs;
    if (tab === "favorite") list = list.filter((c) => c.is_favorite);
    else if (tab !== "all" && tab !== "favorite") {
      const gid = customGroups.find((g) => g.id === Number(tab))?.id;
      if (gid !== undefined) list = list.filter((c) => c.group_id === gid);
    }
    if (ql) list = list.filter((c) => c.name.toLowerCase().includes(ql));
    return list;
  }, [cat, customGroups, tab, q]);

  const onPick = async (kind: "emoji" | "custom", key: string) => {
    await invoke("apply_emoji", { kind, key });
  };

  return (
    <div className="flex h-full flex-col p-4">
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
              filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
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
            try {
              await invoke("add_emoji_from_clipboard");
              await refreshCustom();
            } catch (e) { console.error(e); }
          }}
          className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs"
        >
          <ClipboardPaste className="size-3.5" /> 从剪贴板添加
        </button>
        <button
          onClick={async () => {
            const name = prompt("新分组名称");
            if (name) { await invoke("create_group", { name }); await refreshCustom(); }
          }}
          className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs"
        >
          <FolderPlus className="size-3.5" /> 新建分组
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {GROUP_TABS.map((g) => (
          <button key={g.id} onClick={() => setTab(g.id)}
            className={cn("rounded px-2 py-0.5 text-xs", tab === g.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
            {g.zh}
          </button>
        ))}
        {customGroups.map((g) => (
          <button key={g.id} onClick={() => setTab(String(g.id))}
            className={cn("rounded px-2 py-0.5 text-xs", tab === String(g.id) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
            {g.name}
          </button>
        ))}
      </div>

      <div className="mt-3 flex-1 overflow-y-auto">
        {visibleEmoji.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,40px)] gap-1">
            {visibleEmoji.map((e) => (
              <button key={e.char} title={`${e.name_en}`}
                onClick={() => onPick("emoji", e.char)}
                className="flex size-9 items-center justify-center rounded-md text-2xl hover:bg-accent">
                {e.char}
              </button>
            ))}
          </div>
        )}
        {visibleCustoms.length > 0 && (
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,56px)] gap-2">
            {visibleCustoms.map((c) => (
              <div key={c.id} className="group relative">
                <button onClick={() => onPick("custom", String(c.id))}
                  className="flex size-14 items-center justify-center overflow-hidden rounded-md border hover:border-primary">
                  {c.thumb ? <img src={`data:image/png;base64,${c.thumb}`} className="h-full w-full object-contain" alt="" /> : <span className="text-xs">无</span>}
                </button>
                <button
                  onClick={async () => { await invoke("toggle_favorite", { kind: "custom", key: String(c.id), fav: !c.is_favorite }); await refreshCustom(); }}
                  className="absolute -right-1 -top-1 hidden rounded-full bg-background p-0.5 text-yellow-500 group-hover:block"
                  aria-label="收藏">
                  {c.is_favorite ? <Star className="size-3" /> : <StarOff className="size-3" />}
                </button>
                <button
                  onClick={async () => { await invoke("delete_custom_emoji", { id: c.id }); await refreshCustom(); }}
                  className="absolute -left-1 -top-1 hidden rounded-full bg-background p-0.5 text-destructive group-hover:block"
                  aria-label="删除">
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
    </div>
  );
}
```

> 注：`@tauri-apps/plugin-dialog` 需在 `package.json` 添加依赖（`npm i @tauri-apps/plugin-dialog`）并在 `lib.rs` 注册 `.plugin(tauri_plugin_dialog::init())`、`capabilities/default.json` 加 `dialog:default`。若想避免新增插件，改用原生 `<input type="file" multiple accept="image/*">` 在 WebView 里选文件拿到 File 对象后无法直接转路径——故用 plugin-dialog 的 `open()`（返回绝对路径）。

- [ ] **Step 2: 写设置组件**

`src/modules/emoji/Settings.tsx`:

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getConfig } from "@/lib/api";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { Label } from "@/components/ui/label";

export function EmojiSettings({ onRefresh }: { onRefresh: () => void }) {
  const [hotkey, setHotkey] = useState("");
  const [action, setAction] = useState<"paste" | "copy">("paste");
  const [followMouse, setFollowMouse] = useState(true);

  useEffect(() => {
    getConfig().then((cfg) => {
      const m = cfg.modules.emoji ?? {};
      setHotkey((m.hotkey as string) ?? "Ctrl+Shift+J");
      setAction((m.click_action as "paste" | "copy") ?? "paste");
      setFollowMouse((m.follow_mouse as boolean) ?? true);
    });
  }, []);

  const save = async (patch: Partial<{ hotkey: string; click_action: string; follow_mouse: boolean }>) => {
    await invoke("save_emoji_settings", {
      hotkey: patch.hotkey ?? hotkey,
      click_action: patch.click_action ?? action,
      follow_mouse: patch.follow_mouse ?? followMouse,
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>呼出表情面板热键</Label>
        <HotkeyRecorder
          value={hotkey}
          onSave={async (combo) => { await save({ hotkey: combo }); }}
          hint="按此热键弹出表情悬浮面板（统一呼出模式下禁用）"
        />
      </div>
      <div className="space-y-1">
        <Label>点击表情后</Label>
        <div className="flex gap-2">
          {(["paste", "copy"] as const).map((a) => (
            <button key={a} onClick={() => save({ click_action: a })}
              className={"rounded-md border px-3 py-1 text-xs " + (action === a ? "border-primary text-primary" : "text-muted-foreground")}>
              {a === "paste" ? "粘贴到原窗口" : "复制到剪贴板"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">面板跟随鼠标</div>
          <div className="text-xs text-muted-foreground">呼出时出现在鼠标附近，否则停留在上次位置</div>
        </div>
        <button onClick={() => save({ follow_mouse: !followMouse })}
          className={"relative h-6 w-11 rounded-full transition-colors " + (followMouse ? "bg-primary" : "bg-muted")}>
          <span className={"absolute top-0.5 size-5 rounded-full bg-white transition-all " + (followMouse ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 接入 App.tsx + Sidebar 图标**

`src/App.tsx` 修改：

```tsx
// import 追加
const EmojiPage = lazy(() => import("@/modules/emoji/Page").then(m => ({ default: m.EmojiPage })));
import { EmojiSettings } from "@/modules/emoji/Settings";
// 图标映射：import { Clipboard, Gauge, Smile } from "lucide-react";
// 设置页 manifests.map 渲染处图标三元改为：
{/* m.icon === "gauge" ? <Gauge/> : m.icon === "smile" ? <Smile/> : <Clipboard/> */}
// renderModule switch 追加：
case "emoji":
  return <EmojiPage />;
// 设置区追加（在 quota 区块后，<Separator/> + 区块）：
{Boolean(config.modules.emoji?.enabled) && (
  <>
    <Separator />
    <div>
      <h3 className="mb-2 text-sm font-semibold">表情设置</h3>
      <EmojiSettings onRefresh={async () => setConfig(await getConfig())} />
    </div>
  </>
)}
```

`src/components/layout/Sidebar.tsx`：图标映射同样处理 `smile`（参考现有 `gauge`/`clipboard` 分支）。

- [ ] **Step 4: 类型检查 + 构建**

```bash
cd D:\SystemFiles\Documents\Project\EasyTool
npx tsc --noEmit
npm run build
```

Expected: 无类型错误，构建成功。

- [ ] **Step 5: Commit**

```bash
git add src/modules/emoji/ src/App.tsx src/components/layout/Sidebar.tsx package.json src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(emoji): 主窗口模块页与设置区"
```

---

### Task 4: 悬浮面板（独立窗口）

**Files:**
- Create: `emoji_popup.html`
- Create: `src/emoji_popup.tsx`
- Create: `src/modules/emoji/Popup.tsx`
- Modify: `vite.config.ts`（rollupOptions.input 增加 emoji_popup）
- Modify: `src-tauri/capabilities/default.json`（windows 数组加 "emoji_popup" + 权限）

**Interfaces:**
- Consumes: Task 2 的命令 `get_emoji_all`、`apply_emoji`；`modules::emoji::on_hotkey`
- Produces: 悬浮面板窗口 `emoji_popup`，加载 `emoji_popup.html`

- [ ] **Step 1: 建 HTML 入口 + vite input + capabilities**

`emoji_popup.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>EasyTool 表情</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/emoji_popup.tsx"></script>
  </body>
</html>
```

`vite.config.ts` `rollupOptions.input` 追加：`emoji_popup: path.resolve(__dirname, "emoji_popup.html"),`

`src-tauri/capabilities/default.json`：`windows` 数组加 `"emoji_popup"`；权限确认含 `core:window:allow-hide`、`core:window:allow-show`、`core:window:allow-set-focus`（已有则跳过）。

- [ ] **Step 2: 写悬浮面板入口与主体**

`src/emoji_popup.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { applyTheme } from "@/lib/theme";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EmojiPopup } from "@/modules/emoji/Popup";
import "@/index.css";

applyTheme("system");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <EmojiPopup />
  </React.StrictMode>
);

// 失焦 200ms 后隐藏
const win = getCurrentWindow();
win.onFocusChanged(({ payload }) => {
  if (!payload) {
    setTimeout(() => {
      win.isFocused().then((f) => { if (!f) win.hide(); });
    }, 200);
  }
});
```

`src/modules/emoji/Popup.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig } from "@/lib/api";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmojiDto {
  char: string; group: string; name_en: string; keywords_zh: string[];
  is_favorite: boolean; use_count: number; last_used_at: number | null;
}
interface CustomDto { id: number; name: string; thumb: string | null; is_favorite: boolean; last_used_at: number | null; }
interface Catalog { emoji: EmojiDto[]; customs: CustomDto[] }

const TABS = ["all", "favorite", "smileys", "people", "animals", "food", "travel", "activities", "objects", "symbols", "flags"];
const TAB_ZH: Record<string, string> = {
  all: "全部", favorite: "收藏", smileys: "笑脸", people: "人物", animals: "动物",
  food: "食物", travel: "旅行", activities: "活动", objects: "物品", symbols: "符号", flags: "旗帜",
};

export function EmojiPopup() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");

  const load = async () => setCat(await invoke<Catalog>("get_emoji_all"));
  useEffect(() => { load().catch(console.error); }, []);

  const list = useMemo(() => {
    if (!cat) return [];
    const ql = q.trim().toLowerCase();
    let emojis = cat.emoji;
    if (tab === "favorite") emojis = emojis.filter((e) => e.is_favorite);
    else if (tab !== "all") emojis = emojis.filter((e) => e.group === tab);
    if (ql) {
      emojis = emojis.filter((e) =>
        e.name_en.toLowerCase().includes(ql) || e.keywords_zh.some((k) => k.includes(q.trim()))
      );
    }
    const customs = tab === "favorite" ? cat.customs.filter((c) => c.is_favorite) : cat.customs;
    const items = [
      ...customs.map((c) => ({ type: "custom" as const, id: String(c.id), label: c.name, thumb: c.thumb, ts: c.last_used_at ?? 0 })),
      ...emojis.map((e) => ({ type: "emoji" as const, id: e.char, label: e.name_en, thumb: null, ts: e.last_used_at ?? 0 })),
    ];
    return items.sort((a, b) => b.ts - a.ts);
  }, [cat, tab, q]);

  const pick = async (type: "emoji" | "custom", key: string) => {
    await invoke("apply_emoji", { kind: type, key });
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
          <button key={t} onClick={() => setTab(t)}
            className={cn("shrink-0 rounded px-2 py-0.5 text-xs", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
            {TAB_ZH[t]}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-[repeat(auto-fill,40px)] gap-1">
          {list.map((item) => (
            <button key={item.type + item.id} title={item.label}
              onClick={() => pick(item.type, item.id)}
              className="flex size-9 items-center justify-center overflow-hidden rounded-md text-2xl hover:bg-accent">
              {item.thumb ? <img src={`data:image/png;base64,${item.thumb}`} className="h-full w-full object-contain" alt="" /> : item.id}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 构建 + 类型检查**

```bash
cd D:\SystemFiles\Documents\Project\EasyTool
npx tsc --noEmit
npm run build
cd src-tauri && cargo build
```

Expected: 全部通过。

- [ ] **Step 4: Commit**

```bash
git add emoji_popup.html src/emoji_popup.tsx src/modules/emoji/Popup.tsx vite.config.ts src-tauri/capabilities/default.json
git commit -m "feat(emoji): 悬浮面板（独立窗口 + 热键呼出 + 粘贴/复制）"
```

---

### Task 5: 打磨与收尾

**Files:**
- Modify: `docs/lessons.md`（新增教训记录）
- 运行 `codegraph init` 重建索引
- 生成手动验收清单

- [ ] **Step 1: 全量校验**

```bash
cd D:\SystemFiles\Documents\Project\EasyTool
cargo test
npx tsc --noEmit
npm run build
```

Expected: 全部通过。

- [ ] **Step 2: 记录 lessons**

在 `docs/lessons.md` 顶部新增一节，记录表情模块新增过程中的经验（如 emoji 数据源选型、IPC 传输大 base64 的性能注意、剪贴板写入函数复用、**不要用 PowerShell 改写 UTF-8 文件**）。

- [ ] **Step 3: 重建索引**

```bash
cd D:\SystemFiles\Documents\Project\EasyTool
codegraph init
```

- [ ] **Step 4: 提交 + 验收清单**

```bash
git add -A
git commit -m "feat(emoji): 表情模块完成"
```

向用户输出：启动命令 `npm run tauri dev` + 手动验收清单：
1. 主窗口底部导航出现「表情」模块
2. 浏览内置 Emoji 分类，搜索"猫"/"cat"命中
3. 导入图片文件/从剪贴板添加 → 出现在图片表情区，可建分组/收藏/删除
4. 设置里录热键（默认 Ctrl+Shift+J），统一呼出关闭时按热键弹悬浮面板
5. 点表情：默认粘贴到原窗口；切为复制则仅复制
6. 重启应用：最近使用/收藏/分组保留