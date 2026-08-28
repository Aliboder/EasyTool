# 移除独立弹窗、只保留主窗口 — 实现计划

**目标**：删除 4 个模块弹窗及其全部配套，全局热键精简为单一主窗口热键，保留跟手粘贴/直输（规格见 `docs/superpowers/specs/2026-08-28-remove-popups-design.md`）
**估算**：L（1-2 天），按 Rust → 前端 → 构建配置 → 文档 顺序，逐步验证

## Phase 1 · Rust 后端（每步 `cargo check`）

| # | 文件 | 改动 | Done |
|---|------|------|------|
| 1.1 | `src-tauri/src/lib.rs` | 删 `ensure_popup_window`/`show_popup_at`（保留 `popup_position_physical`）；`Hotkeys`/`ResolvedHotkeys`/`read_hotkeys`/`reapply_hotkeys` 精简为仅 main 热键；hotkey handler 只处理 main；`on_window_event` 删弹窗失焦分支；`apply_main_window_mode` 恒面板形态 | check 通过 |
| 1.2 | `src-tauri/src/config.rs` | `AppConfig` 删 `unified_hotkey`；模块默认配置删 `hotkey`；删 `set_unified_hotkey`；`set_module_enabled` 不再 reapply_hotkeys；`set_module_config` 删 hotkey 重注册判断；`set_main_hotkey` 不再拒绝非统一模式 | check 通过 |
| 1.3 | 四模块 `mod.rs`（clipboard/emoji/search/timetracker） | 删 `POPUP_WINDOW_LABEL`/`ensure_popup_window`/`on_hotkey`；emoji 删 no-op `record_foreground_state` | check 通过 |
| 1.4 | `clipboard/paste.rs`、`emoji/paste.rs` | 删 popup 窗口分支，只隐藏主窗口 | check 通过 |
| 1.5 | 四模块 `manifest.json` + quota | 删 `hotkey` 字段；clipboard/search/emoji 删 `follow_mouse` | `cargo test` 66 passed |

## Phase 2 · 前端（每步 `npx tsc --noEmit`）

| # | 文件 | 改动 | Done |
|---|------|------|------|
| 2.1 | 删除：`src/{clipboard_popup,emoji_popup,search_popup,timetracker_window}.tsx` + 根 4 个 html + `src/lib/popup-entry.tsx` + `src/hooks/usePopupGeometry.ts` + `src/modules/{emoji,search,timetracker}/Popup.tsx` | 无 | tsc 通过 |
| 2.2 | `Clippage.tsx`/`SearchView.tsx`/`TimetrackerView.tsx` | 删 `popup` prop 与分支（useWindowEntrance/usePopupGeometry/Enter/隐藏调用），恒主窗口形态 | tsc 通过 |
| 2.3 | `ClipSettings.tsx`/`SearchSettings.tsx`/`emoji/Settings.tsx`/`timetracker/Settings.tsx` + 各 `config.ts` | 删热键、跟随鼠标、重置弹窗尺寸设置项及字段 | tsc 通过 |
| 2.4 | `settings-view.tsx` + `App.tsx` + `lib/api.ts` | 删「统一呼出」开关与 `setUnifiedHotkey` 接线；主热键/跟随鼠标常显 | tsc 通过 |
| 2.5 | `vite.config.ts` | `rollupOptions.input` 删 4 弹窗入口 | `npm run build` 通过 |

## Phase 3 · 构建权限与文档

| # | 文件 | 改动 |
|---|------|------|
| 3.1 | `src-tauri/capabilities/default.json` | `windows` 数组删 4 弹窗 label |
| 3.2 | `AGENTS.md` | 窗口节/全局热键节/目录结构/当前模块描述（删弹窗与统一模式，改单一主窗口面板） |
| 3.3 | `docs/module-guide.md` | 删「独立弹窗五件套」规范（mountPopup/usePopupGeometry/html/vite/capabilities） |
| 3.4 | `README.md` + `website/` | 热键表/特点/弹窗宣传点同步 |

## Phase 4 · 全量验证

- `cargo test`（66 passed + 2 ignored）、`npx tsc --noEmit`、`npm run build`
- 对照 spec 第 7 节验收清单 9 条人工验收
- 提交（先功能后文档，或一次原子提交 + 文档同批）

## 依赖关系

```
Phase1(1.1→1.4→1.5) ──> Phase2(2.1→2.4→2.5) ──> Phase3(3.2-3.4)
                          └──> 3.1 可与 Phase1 并行
```

## 风险与对策

| 风险 | 影响 | 概率 | 对策 |
|------|------|------|------|
| 老 config.json 残留键（unified_hotkey/模块 hotkey）导致前端读取 undefined | 中 | 高 | AppConfig serde default 兜底；前端读取用 `Boolean(...) ?? 默认`；不迁移 |
| `set_main_hotkey` 删除 unified 判断后有行为变化 | 低 | 中 | 逻辑：注册验证→写 config→reapply（唯一热键，简单） |
| 前端 popup 分支遗漏（某组件仍调 getCurrentWindow().hide） | 中 | 中 | grep `popup`/`hide()` 复查 |
| 官网有弹窗宣传文案 | 低 | 中 | website/ 全局 grep 弹窗/小窗相关词 |

## 明确不做

- 不做模块热键→切页映射；不做任何新弹窗/悬浮 UI；不迁移老配置残留键