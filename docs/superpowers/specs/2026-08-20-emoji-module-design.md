# 表情模块设计文档

- 日期：2026-08-20
- 模块 id：`emoji`
- 状态：待实现

## 1. 目标与范围

为 EasyTool 新增「表情」模块：内置全量 Unicode Emoji（含中文/英文名称与官方分类），支持用户自行添加图片表情（文件导入 + 剪贴板粘贴两种途径），可通过主窗口模块页管理、全局热键呼出悬浮面板快速选用。

**不在范围（YAGNI）**：
- 不做 Emoji 肤色变体选择器 UI（数据按基础 Emoji 收录，变体通过系统输入法实现）
- 不做图片表情在线下载/图包市场
- 不做表情发送到社交平台（仅粘贴/复制到本机输入框）

## 2. 需求明细

| 维度 | 需求 |
|---|---|
| Emoji 内容 | 内置全量 Unicode Emoji（15.1，约 1800+ 基础项，含 ZWJ 序列），按官方 9 大类（笑脸/人物/动物/食物/活动/旅行/物品/符号/旗帜）分组；每条含字符、英文名、中文名、搜索关键词（shortcode） |
| 图片表情 | 用户自行添加：**文件导入**（多选 png/jpg/gif/webp）+ **剪贴板粘贴**（从剪贴板直接"存为表情"）；文件复制到 `%APPDATA%\com.aliboder.easytool\emojis\`，DB 记录元数据；支持自建分组、删除 |
| 入口 | ① 主窗口模块页（浏览/管理/导入/分组）；② 全局热键呼出悬浮面板（复用剪贴板弹窗模式：延迟创建、跟随鼠标、失焦隐藏） |
| 点击行为 | 设置开关：**粘贴到唤起前窗口**（默认）或 **复制到剪贴板**；悬浮面板点击后自动关闭（粘贴模式），复制模式保持打开 |
| 辅助 | 最近使用（按 use_count/last_used_at 置顶）、搜索（Emoji 中文名/英文名/shortcode + 图片文件名）、收藏（内置与图片表情均支持，单独 Tab） |
| 持久化 | SQLite（`emojis.db`）：图片表情元数据、分组、使用次数/最近使用、收藏、内置 Emoji 的收藏/使用记录 |

## 3. 架构设计

### 3.1 模块文件布局

```
src-tauri/modules/emoji/manifest.json          # 模块清单 + 默认配置
src-tauri/modules/emoji/emoji.json            # 内置 Emoji 数据（资源，构建时生成一次）
src-tauri/src/modules/emoji/
├── mod.rs        # 模块入口：setup、模块配置读取、悬浮窗创建/定位（仿 clipboard/mod.rs）
├── db.rs         # emojis.db：建表、图片表情 CRUD、分组 CRUD、使用统计、收藏
├── data.rs       # 加载 emoji.json、按分类/关键词检索
├── paste.rs      # 粘贴到唤起前窗口（复刻 clipboard/paste.rs 的 Win32 逻辑，内容由调用方传入）
└── commands.rs   # IPC 命令
src/modules/emoji/
├── Page.tsx      # 主窗口模块页（浏览/导入/分组/收藏管理）
├── Settings.tsx  # 设置区（热键、点击行为）
└── use-emoji.ts  # 前端数据 hook（获取列表/搜索/操作）
emoji_popup.html + src/emoji_popup.tsx         # 悬浮面板独立入口
```

### 3.2 数据设计

**内置 Emoji 数据** `emoji.json`（资源文件，随应用打包，约 200-400KB）：
```json
{
  "emoji": [
    {
      "char": "😀",
      "group": "smileys-emotion",
      "group_zh": "笑脸",
      "name_en": "grinning face",
      "keywords": ["face", "grin"],
      "keywords_zh": ["笑脸", "高兴"]
    }
  ]
}
```
- 数据来源：npm `emoji-datasource`（含英文/中文短代码）或 `emojibase` + 官方分类映射；用一次性 Node 生成脚本（`tools/gen-emoji.mjs`）产出并提交该文件
- 9 大分组：`smileys-emotion` 笑脸、`people-body` 人物、`animals-nature` 动物、`food-drink` 食物、`travel-places` 旅行、`activities` 活动、`objects` 物品、`symbols` 符号、`flags` 旗帜

**数据库 `emojis.db`**：
```sql
CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,          -- 分组名（如"工作"、"猫猫"）
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE custom_emojis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,            -- %APPDATA%...\emojis\<id>.<ext>
  name TEXT NOT NULL,                 -- 显示名（默认取文件名）
  group_id INTEGER,                   -- NULL=未分组，REFERENCES groups(id) ON DELETE SET NULL
  is_favorite INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,               -- Unix 毫秒
  created_at INTEGER NOT NULL
);

CREATE TABLE emoji_usage (            -- 内置 Emoji 的动态数据（char 为唯一键）
  char TEXT PRIMARY KEY,              -- 对应 emoji.json 的 char
  is_favorite INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER
);
```
- 数据库文件：`%APPDATA%\com.aliboder.easytool\emojis.db`（独立于剪贴板库）
- 图片文件目录：`%APPDATA%\com.aliboder.easytool\emojis\`（与 db 同名目录，参考剪贴板 images/ 模式）

### 3.3 配置项（manifest default_config）

```json
{
  "hotkey": "Ctrl+Shift+J",
  "click_action": "paste",        // "paste" 粘贴到唤起前窗口 | "copy" 仅复制
  "follow_mouse": true            // 悬浮面板跟随鼠标/固定位置
}
```

### 3.4 窗口

- 悬浮面板 `emoji_popup`：无边框、跳过任务栏、置顶、初始 400x320、最小 320x240、可缩放，**延迟创建**（首次呼出时建窗，仿 `clipboard::ensure_popup_window`）
- 位置：跟随鼠标（仿 `popup_position_physical`）或记忆的固定位置；失焦 200ms 隐藏（复用 `hide_after_blur_grace` 思路）
- 前端入口 4 处联动：`emoji_popup.html`、vite `rollupOptions.input`、Rust 建窗 `WebviewUrl::App("emoji_popup.html")`、`capabilities/default.json` 的 `windows` 数组

### 3.5 热键

- 默认 `Ctrl+Shift+J`，设置页用 `HotkeyRecorder` 录制
- 并入 `unified_hotkey` 逻辑：unified=true 时禁用模块热键（主窗口统一呼出后，主窗口内的表情页承担选用）；unified=false 时注册表情热键
- `reapply_hotkeys` 与 `global_shortcut` handler 需扩展：读取 emoji 模块配置、用 `Shortcut::from_str` 对象比较匹配、命中调用 `modules::emoji::on_hotkey(app)`

### 3.6 粘贴实现

复刻 `clipboard/paste.rs` 的机制，改为**内容无关**版本（参数为剪贴板内容写入函数），供表情模块自用：
1. 呼出悬浮面板前 `record_foreground`（记录原前台窗口 + 焦点控件 + 选区）
2. 点击表情 → 写剪贴板：
   - Emoji：`CF_UNICODETEXT`（直接写字符）
   - 图片表情：读文件 → `write_image_rgba` 或按格式写 CF_DIB（复用 clipboard 的 `clipboard.rs` Win32 写入函数，需将其可见性提升为 `pub(crate)`）
3. 还原前台窗口与焦点控件 → 模拟 Ctrl+V（粘贴模式）
4. 复制模式：仅写剪贴板，不还原窗口

> 说明：`clipboard::clipboard` 模块的写入函数（`write_text_rich`/`write_image_rgba`/`write_files`）目前是私有的，需改为 `pub(crate)` 供表情模块复用；不做整段 paste 逻辑抽取重构（避免动剪贴板主路径）。

## 4. 前端设计

### 4.1 悬浮面板（emoji_popup.tsx）

布局（自上而下）：
1. 顶部：搜索框 + 标签切换（全部 / 收藏 / 各分组横向滚动条）
2. 主体：表情网格
   - Emoji 网格：按分组展示，网格单元为 Emoji 字符（字号 24px），点按即用
   - 图片表情：缩略图（`get_emoji_thumb`，最长边 96，缓存）
3. 底部（可选）：当前选中表情的名称提示 + 关闭按钮

交互：
- 点击表情 → 按 `click_action` 执行粘贴/复制；粘贴模式执行后隐藏面板，复制模式保持
- Esc 关闭；失焦自动隐藏
- 使用 `applyTheme` 跟随主题；入场用 `useWindowEntrance`
- 最近使用排序：按 last_used_at 倒序的组在"全部"Tab 内置于最前

### 4.2 主窗口模块页（Page.tsx）

- 顶部：导入图片表情按钮（文件多选）、从剪贴板添加按钮、新建分组、搜索框
- 主体分栏：内置 Emoji 浏览（按分类 Tab 展示）+「我的图片表情」区（按分组展示，含缩略图、右键菜单：删除/移动分组/收藏/复制）
- 设置区（Settings.tsx）：热键录制（HotkeyRecorder）、点击行为单选（粘贴/复制）

### 4.3 图标

manifest `icon` 需要新值，`App.tsx` 图标映射新增（如 `emoticon`/`smile` 映射到 lucide 的 `Smile` 图标）。

## 5. IPC 命令清单

```rust
// 数据查询
get_emoji_all() -> EmojiCatalog             // 全量内置 emoji（含使用/收藏标注）+ 分组元数据
get_custom_emojis() -> Vec<CustomEmoji>     // 图片表情列表（含缩略图 base64、分组、收藏）
get_groups() -> Vec<Group>
// 图片表情管理
import_emoji_files(paths: Vec<String>) -> Result<(), String>   // 复制文件入 emojis/ + 入库
add_emoji_from_clipboard() -> Result<(), String>               // 剪贴板图片存为表情
delete_custom_emoji(id: i64)
rename_custom_emoji(id: i64, name: String)
move_custom_emoji(id: i64, group_id: Option<i64>)
create_group(name: String) -> Result<i64, String>
rename_group(id: i64, name: String)
delete_group(id: i64)                       // 组内表情置为未分组
// 使用/收藏
record_use(kind: "emoji"|"custom", key: String)   // 自增使用次数 + 更新 last_used_at
toggle_favorite(kind: "emoji"|"custom", key: String, fav: bool)
// 粘贴
get_emoji_thumb(id: i64) -> Option<String>  // 图片表情缩略图 base64（最长边 96，缓存）
apply_emoji(kind: "emoji"|"custom", key: String) -> Result<(), String>  // 按 click_action 粘贴或复制；key：内置 emoji 传 char，图片表情传 id 的字符串形式
// 配置
save_emoji_settings(settings: EmojiSettings) -> Result<(), String>
```

## 6. 错误处理与边界

- 导入图片：校验扩展名白名单（png/jpg/jpeg/gif/webp）；文件复制失败或入库失败则返回错误并回滚已复制的文件
- 粘贴：唤起前窗口丢失/还原失败 → 仅复制到剪贴板 + 前端提示"已复制，请手动粘贴"（沿用剪贴板模块的容错文案）
- emoji.json 缺失/损坏：模块仍可用（图片表情功能正常），内置 Emoji 区显示"数据缺失"
- 大文件图片导入：复制 + 缩略图生成放 `spawn_blocking`，避免阻塞 IPC
- DB 并发：`Mutex<Db>` 保护，命令内短锁，锁内不做 IO/网络

## 7. 测试

- 后端单元测试（cargo test）：
  - `data`：emoji.json 加载、分类完整性（9 大类非空）、关键词检索命中/未命中
  - `db`：图片表情 CRUD、分组 CRUD（含删除分组后成员回退未分组）、使用计数/收藏更新
  - `paste`：剪贴板写入函数（文本/图片）成功路径
- 前端：无测试框架，人工验收清单（见实现计划）
- 全量校验：`cargo test` + `npx tsc --noEmit` + `npm run build`

## 8. 实现里程碑（草案）

1. **M1 数据与后端骨架**：生成 emoji.json、db 层、数据层、模块 setup + manifest 注册
2. **M2 主窗口模块页**：Emoji 浏览 + 图片表情管理（导入/分组/删除/收藏）+ 设置区
3. **M3 悬浮面板**：独立窗口 4 处联动、热键、粘贴/复制交互
4. **M4 打磨**：最近使用、搜索、图标、lessons 记录、codegraph 重建