# 快速启动模块实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现快速启动模块，支持固定软件、文件、文件夹和URL，提供快速访问和组织功能。

**Architecture:** 采用三层架构：SQLite数据层、Rust后端服务、React前端界面。模块通过manifest.json注册，集成到现有EasyTool架构。

**Tech Stack:** Tauri 2 + Rust (rusqlite) + React 19 + TypeScript + Tailwind v4 + shadcn/ui + @dnd-kit

**Spec:** `docs/superpowers/specs/2026-08-22-quicklaunch-design.md`

## Global Constraints

- Windows 11 Pro, i7-13650HX, 16GB RAM
- Tauri 2 + Rust 后端，React 19 + TypeScript 前端
- SQLite WAL 模式，keyring 存储敏感数据
- 热键匹配必须用 `Shortcut::from_str(&cfg).map(|s| s == *shortcut)` 对象比较
- 不要用 PowerShell 的 `Get-Content`/`Set-Content` 改写源码
- std Mutex 不可重入，持锁期间不调用会再次取锁的函数
- 同步网络请求必须在后台线程执行
- Windows 下不要给窗口开 `.transparent(true)`
- 新增前端入口要同时改 4 处：vite rollupOptions.input、根目录 .html、Rust 建窗、capabilities 的 windows 数组与权限
- keyring 必须启用 `features = ["windows-native"]`
- 新增模块后跑 `codegraph init` 重建索引
- @dnd-kit 拖拽大尺寸卡片时不要加 opacity
- 热键录制格式：Ctrl/Shift/Alt/Super + 键名
- 版本号三处同步：package.json、tauri.conf.json、Cargo.toml
- SQLite 建索引必须在列添加之后

---

## 文件结构

### Rust 后端文件
- `src-tauri/modules/quicklaunch/manifest.json` - 模块清单
- `src-tauri/src/modules/quicklaunch/mod.rs` - 模块入口
- `src-tauri/src/modules/quicklaunch/commands.rs` - IPC 命令
- `src-tauri/src/modules/quicklaunch/db.rs` - SQLite 数据库操作
- `src-tauri/src/modules/quicklaunch/types.rs` - 数据类型定义

### 前端文件
- `src/modules/quicklaunch/Page.tsx` - 主窗口页面
- `src/modules/quicklaunch/Settings.tsx` - 设置组件
- `src/modules/quicklaunch/GridView.tsx` - 网格视图组件
- `src/modules/quicklaunch/ListView.tsx` - 列表视图组件
- `src/modules/quicklaunch/FilterBar.tsx` - 筛选工具栏
- `src/modules/quicklaunch/ItemCard.tsx` - 单个固定项组件
- `src/quicklaunch_popup.html` - 弹窗入口 HTML
- `src/quicklaunch_popup.tsx` - 弹窗 React 入口

### 配置文件
- `src-tauri/capabilities/default.json` - 添加 quicklaunch_win 窗口权限
- `vite.config.ts` - 添加 quicklaunch_popup 入口

---

## Task 1: 创建模块清单和基础结构

**Files:**
- Create: `src-tauri/modules/quicklaunch/manifest.json`
- Create: `src-tauri/src/modules/quicklaunch/mod.rs`
- Create: `src-tauri/src/modules/quicklaunch/types.rs`
- Modify: `src-tauri/src/modules/mod.rs` - 添加 `pub mod quicklaunch;`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces: 模块基础结构，供后续任务使用

- [ ] **Step 1: 创建 manifest.json**

```json
{
  "id": "quicklaunch",
  "name": "快速启动",
  "icon": "layout",
  "enabled": true,
  "default_config": {
    "view_mode": "grid",
    "sort_by": "name",
    "sort_desc": false
  }
}
```

- [ ] **Step 2: 创建 types.rs**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ItemType {
    #[serde(rename = "app")]
    App,
    #[serde(rename = "file")]
    File,
    #[serde(rename = "folder")]
    Folder,
    #[serde(rename = "url")]
    Url,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: i64,
    pub item_type: ItemType,
    pub name: String,
    pub path: String,
    pub icon_path: Option<String>,
    pub folder_id: Option<i64>,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterOptions {
    pub item_type: Option<ItemType>,
    pub search: Option<String>,
    pub sort_by: Option<String>,
    pub sort_desc: Option<bool>,
}
```

- [ ] **Step 3: 创建 mod.rs（基础结构）**

```rust
pub mod commands;
pub mod db;
pub mod types;

use tauri::Manager;
use std::sync::Mutex;

pub struct QuicklaunchState {
    pub db: db::QuicklaunchDb,
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("quicklaunch.db");
    let db = db::QuicklaunchDb::open(&db_path)
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    app.manage(Mutex::new(QuicklaunchState { db }));
    log::info!("quicklaunch module ready");
    Ok(())
}

pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("quicklaunch.db");
    let db = db::QuicklaunchDb::open(&db_path)
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    app.manage(Mutex::new(QuicklaunchState { db }));
    log::info!("quicklaunch module ready");
    Ok(())
}

pub fn module_config(app: &tauri::AppHandle) -> serde_json::Value {
    app.state::<crate::config::ConfigState>()
        .0
        .lock()
        .unwrap()
        .modules
        .get("quicklaunch")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}))
}
```

- [ ] **Step 4: 在 modules/mod.rs 中注册**

```rust
pub mod quicklaunch;
```

- [ ] **Step 5: 验证编译**

Run: `cargo check` in `src-tauri/`
Expected: 编译通过

- [ ] **Step 6: 提交**

```bash
git add src-tauri/modules/quicklaunch/ src-tauri/src/modules/quicklaunch/ src-tauri/src/modules/mod.rs
git commit -m "feat(quicklaunch): add module manifest and basic structure"
```

---

## Task 2: 实现 SQLite 数据库操作

**Files:**
- Create: `src-tauri/src/modules/quicklaunch/db.rs`

**Interfaces:**
- Consumes: `types.rs` 中的数据类型
- Produces: `QuicklaunchDb` 结构体，供 commands.rs 使用

- [ ] **Step 1: 创建 db.rs**

参考 `src-tauri/src/modules/clipboard/db.rs` 和 `src-tauri/src/modules/quota/db.rs` 的模式，实现 `QuicklaunchDb` 结构体，包含：
- `open(path)` 方法打开数据库
- `init_tables()` 方法创建 items 和 folders 表
- Items CRUD：`create_item`, `get_item`, `list_items`, `update_item`, `delete_item`, `sort_items`
- Folders CRUD：`create_folder`, `get_folder`, `list_folders`, `update_folder`, `delete_folder`, `sort_folders`
- 支持 FilterOptions 筛选

- [ ] **Step 2: 验证编译**

Run: `cargo check` in `src-tauri/`
Expected: 编译通过

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/modules/quicklaunch/db.rs
git commit -m "feat(quicklaunch): add SQLite database operations"
```

---

## Task 3: 实现 IPC 命令

**Files:**
- Create: `src-tauri/src/modules/quicklaunch/commands.rs`
- Modify: `src-tauri/src/lib.rs` - 注册命令

**Interfaces:**
- Consumes: `QuicklaunchDb` 和 `types.rs` 中的数据类型
- Produces: IPC 命令，供前端调用

- [ ] **Step 1: 创建 commands.rs**

参考 `src-tauri/src/modules/clipboard/commands.rs` 的模式，实现 IPC 命令：
- `quicklaunch_create_item` - 创建固定项
- `quicklaunch_get_item` - 获取固定项
- `quicklaunch_list_items` - 列出固定项（支持筛选）
- `quicklaunch_update_item` - 更新固定项
- `quicklaunch_delete_item` - 删除固定项
- `quicklaunch_sort_items` - 排序固定项
- `quicklaunch_create_folder` - 创建文件夹
- `quicklaunch_get_folder` - 获取文件夹
- `quicklaunch_list_folders` - 列出文件夹
- `quicklaunch_update_folder` - 更新文件夹
- `quicklaunch_delete_folder` - 删除文件夹
- `quicklaunch_sort_folders` - 排序文件夹
- `quicklaunch_open_item` - 打开固定项

- [ ] **Step 2: 在 lib.rs 中注册命令**

参考 `src-tauri/src/lib.rs` 中其他模块的注册方式，添加 quicklaunch 模块的命令注册。

- [ ] **Step 3: 验证编译**

Run: `cargo check` in `src-tauri/`
Expected: 编译通过

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/modules/quicklaunch/commands.rs src-tauri/src/lib.rs
git commit -m "feat(quicklaunch): add IPC commands and registration"
```

---

## Task 4: 创建前端基础组件

**Files:**
- Create: `src/modules/quicklaunch/Page.tsx`
- Create: `src/modules/quicklaunch/ItemCard.tsx`
- Create: `src/modules/quicklaunch/FilterBar.tsx`
- Modify: `src/App.tsx` - 添加 quicklaunch 页面

**Interfaces:**
- Consumes: IPC 命令
- Produces: 基础前端组件

- [ ] **Step 1: 创建 ItemCard.tsx**

参考 `src/modules/clipboard/ClipboardItem.tsx` 的模式，实现单个固定项组件：
- 显示图标和名称
- 支持点击打开
- 支持右键菜单
- 支持拖拽

- [ ] **Step 2: 创建 FilterBar.tsx**

参考 `src/modules/search/SearchView.tsx` 的 FILTERS 模式，实现筛选工具栏：
- 类型筛选按钮组（全部、应用、文件、文件夹、URL）
- 搜索框
- 视图切换按钮

- [ ] **Step 3: 创建 Page.tsx**

参考 `src/modules/clipboard/ClipboardPage.tsx` 的模式，实现主窗口页面：
- 顶部工具栏（FilterBar）
- 内容区域（显示固定项）
- 支持网格/列表视图切换
- 支持拖拽排序

- [ ] **Step 4: 在 App.tsx 中注册页面**

参考其他模块的注册方式，在 App.tsx 中添加 quicklaunch 页面。

- [ ] **Step 5: 验证编译**

Run: `npx tsc --noEmit`
Expected: 编译通过

- [ ] **Step 6: 提交**

```bash
git add src/modules/quicklaunch/ src/App.tsx
git commit -m "feat(quicklaunch): add frontend components"
```

---

## Task 5: 实现弹窗功能

**Files:**
- Create: `src/quicklaunch_popup.html`
- Create: `src/quicklaunch_popup.tsx`
- Modify: `vite.config.ts` - 添加弹窗入口
- Modify: `src-tauri/capabilities/default.json` - 添加窗口权限

**Interfaces:**
- Consumes: 现有弹窗模式（参考 clipboard_popup）
- Produces: 弹窗功能

- [ ] **Step 1: 创建 quicklaunch_popup.html**

参考 `clipboard_popup.html` 的模式。

- [ ] **Step 2: 创建 quicklaunch_popup.tsx**

参考 `src/clipboard_popup.tsx` 的模式，实现弹窗 React 入口：
- 调用 `applyTheme` 跟随主题
- 使用 `useWindowEntrance` 入场动画
- 显示搜索框和常用固定项

- [ ] **Step 3: 在 vite.config.ts 中添加入口**

```typescript
quicklaunch_popup: path.resolve(__dirname, "quicklaunch_popup.html"),
```

- [ ] **Step 4: 在 capabilities/default.json 中添加窗口权限**

```json
{
  "windows": ["main", "clipboard_popup", "search_popup", "quicklaunch_popup"],
  "permissions": [...]
}
```

- [ ] **Step 5: 在 Rust 侧实现弹窗创建**

参考 `src-tauri/src/modules/clipboard/mod.rs` 中的 `ensure_popup_window` 函数。

- [ ] **Step 6: 验证功能**

Run: `npm run tauri dev`
Expected: 热键呼出弹窗正常

- [ ] **Step 7: 提交**

```bash
git add src/quicklaunch_popup.* vite.config.ts src-tauri/capabilities/default.json src-tauri/src/modules/quicklaunch/mod.rs
git commit -m "feat(quicklaunch): add popup window support"
```

---

## Task 6: 实现热键集成

**Files:**
- Modify: `src-tauri/src/lib.rs` - 添加热键处理

**Interfaces:**
- Consumes: 统一热键系统
- Produces: 热键响应

- [ ] **Step 1: 在 lib.rs 中添加热键处理**

参考其他模块的热键处理方式，添加 quicklaunch 的热键响应。

- [ ] **Step 2: 在统一热键中注册**

当 `unified_hotkey=true` 时，注册主窗口热键；否则注册独立热键。

- [ ] **Step 3: 验证功能**

Run: `npm run tauri dev`
Expected: 热键呼出弹窗正常

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(quicklaunch): add hotkey integration"
```

---

## Task 7: 测试和调试

**Files:**
- 无新文件

**Interfaces:**
- Consumes: 所有已实现的功能
- Produces: 可工作的模块

- [ ] **Step 1: 后端测试**

Run: `cargo test` in `src-tauri/`
Expected: 所有测试通过

- [ ] **Step 2: 前端类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 功能测试**

手动测试以下功能：
- 添加固定项（软件、文件、文件夹、URL）
- 删除固定项
- 创建文件夹
- 移动项目到文件夹
- 拖拽排序
- 筛选和搜索
- 网格/列表视图切换
- 弹窗功能
- 热键呼出

- [ ] **Step 4: 修复问题**

根据测试结果修复发现的问题。

- [ ] **Step 5: 重建索引**

Run: `codegraph init`
Expected: 索引重建成功

- [ ] **Step 6: 最终提交**

```bash
git add .
git commit -m "feat(quicklaunch): complete module implementation"
```

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-08-22-quicklaunch.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**