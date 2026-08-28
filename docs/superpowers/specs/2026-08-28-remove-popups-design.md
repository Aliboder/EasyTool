# 移除独立弹窗（小窗）、只保留主窗口 — 设计文档

## 1. 概述

### 1.1 需求背景

剪贴板 / 表情 / 搜索 / 时长统计四个模块各有独立弹窗（跟随鼠标、失焦隐藏、延迟创建）。用户决定**完全移除弹窗，只保留主窗口**作为唯一窗口形态，并同步精简全局热键（删除模块独立热键，只留主窗口呼出热键）。

### 1.2 目标

- 删除 4 个弹窗窗口及其全部配套（Rust 建窗/定位、前端入口/挂载/几何记忆、构建入口、权限声明、弹窗配置项）
- 只保留主窗口（沿用现有「面板」行为）作为唯一窗口
- 删除模块独立热键，全局热键只保留「主窗口呼出」（可自定义）；删除「统一/独立模式」开关
- **保留**剪贴板跟手粘贴与表情直输能力（改为隐藏主窗口回原窗口注入）

### 1.3 非目标（YAGNI）

- 不做任何弹窗替代品（不做悬浮条/迷你窗等）
- 不做模块热键→主窗口切页的映射（用户已否）
- 不迁移/清理老用户 config.json 残留键（无人读取、无害）

## 2. 现状（弹窗地图）

| 模块 | 弹窗 label | HTML/入口 | 尺寸 | 弹窗专属能力 |
|------|-----------|-----------|------|-------------|
| clipboard | `clipboard_popup` | `clipboard_popup.html` + `clipboard_popup.tsx`（mountPopup Clippage） | 620×480 | 跟手粘贴（record_foreground_state + paste 隐藏弹窗） |
| emoji | `emoji_popup` | `emoji_popup.html` + `emoji_popup.tsx`（mountPopup EmojiPopup） | 620×480 | SendInput 直输、Esc 隐窗 |
| search | `search_popup` | `search_popup.html` + `search_popup.tsx`（mountPopup SearchView） | 680×520 | 复制路径/文件 |
| timetracker | `timetracker_window` | `timetracker_window.html` + `timetracker_window.tsx`（mountPopup TimetrackerView） | 800×600 | 独立大窗查看 |

通用机制（Rust `lib.rs`）：`ensure_popup_window`（延迟创建+恢复 popup_size）、`show_popup_at`（定位+显示）、`popup_position_physical`（Win32 物理坐标+显示器钳制，**主窗口跟随鼠标也在用**）、`on_window_event` 弹窗失焦隐藏分支、hotkey handler 4 个模块分支。各模块 `POPUP_WINDOW_LABEL` + `ensure_popup_window` + `on_hotkey`。前端 `popup-entry.tsx`（主题跟随+挂载）、`usePopupGeometry`（popup_size/fixed_pos 记忆）、组件 `popup` prop 分支。构建：vite MPA 4 入口 + 4 个根 html + capabilities windows 声明。quota 无弹窗，不受影响。

## 3. 方案

### 3.1 主窗口形态（唯一窗口）

- 主窗口沿用现有「面板」行为：关闭=隐藏到托盘、置顶、跳过任务栏、点外部关闭（`hide_after_blur_grace`）、可选跟随鼠标（`main_follow_mouse`）
- 「统一/独立模式」开关、`unified_hotkey` 配置、`set_unified_hotkey` 命令删除；`apply_main_window_mode` 恒按面板形态执行
- 主窗口显示时机（`visible:false` → 前端 `main_window_ready` → 8s 兜底）与呼出保护（F24+`MAIN_FOCUSED_SINCE_SHOW`+焦点重试）保留不变

### 3.2 全局热键（精简到单一热键）

- 只注册「主窗口呼出热键」（默认 Ctrl+Shift+E，可自定义，`set_main_hotkey` 保留）
- `ResolvedHotkeys` 精简为仅 main；hotkey handler 只处理 main（`toggle_main`）
- 删除：4 个模块热键、`reapply_hotkeys` 的多分支、模块设置里的热键录制项、manifest/config 模块 hotkey 字段
- 模块启停不再影响热键：`set_module_enabled` 不再调 `reapply_hotkeys`；`set_module_config` 的 hotkey 重注册判断删除（timetracker 的 `reapply_config` 保留）

### 3.3 跟手粘贴 / 直输（保留，改隐藏目标）

- 剪贴板粘贴（`clipboard/paste.rs`）与表情直输（`emoji/paste.rs`）：把「隐藏剪贴板/表情弹窗」改为「隐藏主窗口」（若可见）→ 等 100ms 焦点回原窗口 → Ctrl+V / SendInput
- `record_foreground_state` 保留：托盘/热键呼出主窗口时记录前台窗口（现有 `toggle_main` / hotkey main 分支已有调用）

## 4. 删除清单（文件级）

**Rust**
- `src-tauri/src/lib.rs`：`ensure_popup_window`、`show_popup_at`、on_window_event 弹窗失焦分支、hotkey handler 4 个模块分支、`unified_hotkey` 相关（config 字段、`set_unified_hotkey`、`apply_main_window_mode` 简化）、`ResolvedHotkeys` 精简、`read_hotkeys` 精简。`popup_position_physical` **保留**（主窗口跟随鼠标使用）
- 四模块 `mod.rs`：删 `POPUP_WINDOW_LABEL`、`ensure_popup_window`、`on_hotkey`（模块内不再有热键/建窗）
- `clipboard/paste.rs`、`emoji/paste.rs`：隐藏目标改主窗口
- `src-tauri/src/config.rs`：`AppConfig.unified_hotkey`、`hotkeys` 里非 main 项、模块默认配置里的 `hotkey`；`set_unified_hotkey` 命令删除
- 四模块 manifest `default_config` 的 `hotkey`（clipboard/search/emoji/timetracker）、quota 的 `hotkey:""`、clipboard/search/emoji 的 `follow_mouse`

**前端**
- 入口：`src/{clipboard_popup,emoji_popup,search_popup,timetracker_window}.tsx` + 根 4 个 html
- 工具：`src/lib/popup-entry.tsx`、`src/hooks/usePopupGeometry.ts`
- 弹窗组件：`src/modules/emoji/Popup.tsx`（EmojiPopup）、`src/modules/search/Popup.tsx`、`src/modules/timetracker/Popup.tsx`（删；emoji 主窗口功能在 `Page.tsx` 原样保留）
- `popup` prop 分支简化：`Clippage.tsx`（useWindowEntrance(popup)、usePopupGeometry、Enter/Esc 弹窗特例、粘贴隐藏）、`SearchView.tsx`（同上+hide 分支）、`TimetrackerView.tsx`（同上）、`ClipSettings.tsx`（「重置弹窗尺寸」按钮）
- 各模块 `config.ts`：删 `hotkey` / `follow_mouse` / 弹窗相关字段与默认值；`Settings.tsx` 删对应设置项（热键录制、跟随鼠标开关）

**构建/权限**
- `vite.config.ts`：`rollupOptions.input` 删 4 个弹窗入口
- `src-tauri/capabilities/default.json`：`windows` 数组删 4 个弹窗 label
- `src-tauri/tauri.conf.json`：无弹窗窗口声明（main 唯一，无需改）

**文档**
- `AGENTS.md`：窗口节（删 4 弹窗/延迟创建/统一 helper，改唯一主窗口面板+跟手粘贴）、全局热键节（只留主热键、删统一/独立模式）、目录结构（删弹窗入口）、当前模块描述（删「独立弹窗」字样）
- `docs/module-guide.md`：删「独立弹窗五件套」规范（mountPopup/usePopupGeometry/html/vite/capabilities）
- `README.md`：热键表、特点（「弹窗跟随鼠标，失焦自动隐藏」→ 主窗口面板描述）
- `website/`：检查弹窗宣传点并同步（bento/deep-dive/hero 等处如提「弹窗」）
- `docs/superpowers/plans/`：本次计划

## 5. 保留清单（明确不动）

- `popup_position_physical`（主窗口跟随鼠标）、`toggle_main`、`show_main`、`hide_after_blur_grace`、`main_window_ready`、F24 呼出保护
- `record_foreground_state` / 剪贴板 `paste_item` 的「隐藏窗口→100ms→Ctrl+V」机制（仅改隐藏目标窗）
- 模块启停/排序、设置抽屉、`useModuleConfig`、`module_header` 等主窗口共用设施
- quota 模块（无弹窗）
- 老用户 config.json 残留键：不迁移（`merge_manifests` 只灌缺失模块，残留字段无人读取）

## 6. 边界情况

- 主窗口粘贴时若主窗口已隐藏（非前台）：跳过隐藏步骤直接注入，避免误操作
- 表情「点击行为=复制」时（`clickAction === "copy"`）：不隐藏窗口（现状逻辑保留，只是不再有弹窗分支）
- `search/mod.rs` 的 `popup_position_clamps_to_workarea` 单测：`popup_position_physical` 保留故测试保留
- 热键被占用：仍走 `notify_hotkey_failed` 系统通知（保留）

## 7. 验收清单（人工验收，前端无测试框架）

1. `cargo test`（66 passed + 2 ignored）与 `npx tsc --noEmit`、`npm run build` 通过
2. 启动后无任何弹窗窗口创建；托盘/命令行（Ctrl+Shift+E）呼出主窗口正常，点外部关闭、置顶、跳过任务栏（面板行为）
3. 设置页：无「统一/独立模式」开关、无模块独立热键项；主窗口热键可自定义录制
4. 各模块设置抽屉：无热键、无「跟随鼠标」、无「重置弹窗尺寸」项；模块启停/排序正常
5. 剪贴板：主窗口点条目→主窗口隐藏→焦点回原窗口→内容粘贴（跟手粘贴依然可用）
6. 表情：点表情 SendInput 直输到原窗口 / 复制到剪贴板（按点击行为设置）
7. 搜索：复制路径/打开文件联动正常；时长统计：主窗口内查看正常
8. vite 产物与 capabilities 无任何弹窗入口/窗口声明
9. 老用户 config.json 直接升级：启动正常、无报错（残留键被忽略）