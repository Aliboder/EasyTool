# EasyTool 新增模块开发指南

本指南供 AI Agent 阅读：如何为 EasyTool 快速新增一个功能模块并衔接现有架构。开发前请结合 `AGENTS.md` 与本项目的 `.codegraph/` 索引理解代码。

## 1. 模块是什么

EasyTool 是「单应用 + 模块注册表」架构。**一个模块 = 一段相对独立的业务功能**，包含：

```
src-tauri/modules/<id>/manifest.json   # 模块清单（元数据 + 默认配置）
src-tauri/src/modules/<id>/            # Rust 后端
src/modules/<id>/                      # React 前端组件
```

- 模块在设置页可独立**启用/禁用**，配置项随模块独立保存
- 侧边栏/底部导航栏与模块页由 manifest 驱动，新增模块后**壳 UI 自动出现该模块**，无需改导航栏
- 模块可拥有独立窗口（目前仅剪贴板弹窗），也可仅作为主窗口内的一个页面
- **复用共享前端工具**（不要重复造轮子）：
  - `src/hooks/useModuleConfig.ts` 的 `useModuleConfig`（**模块配置统一读写，见「3. 配置管理标准」——新模块设置功能的地基，必用**）
  - `src/lib/theme.ts` 的 `applyTheme`（弹窗等独立窗口跟随主题）
  - `src/lib/use-horizontal-wheel.ts` 的 `useHorizontalWheel`（滚轮→横向滚动，如历史列表）
  - `src/lib/use-window-entrance.ts` 的 `useWindowEntrance`（窗口呼出入场动画，失焦置透明 + 聚焦重放，避免闪烁）
  - `src/components/hotkey-recorder.tsx` 的 `HotkeyRecorder`（热键录制式设置）
  - `src/components/LazyImage.tsx` 的 `LazyImage`（IntersectionObserver 懒加载图片）
  - `src/components/ui/context-menu(-item/-divider).tsx`（自研右键菜单三件套，参考 quicklaunch/emoji 用法：容器级 `preventDefault` + 条目级 handler）

## 2. 新增模块完整步骤（以模块 `foo` 为例）

### Step 1：创建 manifest

`src-tauri/modules/foo/manifest.json`：

```json
{
  "id": "foo",
  "name": "示例模块",
  "icon": "clipboard",
  "enabled": true,
  "default_config": { "max_items": 100, "hotkey": "Ctrl+Shift+F" }
}
```

字段说明：
- `id`：唯一标识，作为 config 中 `modules.<id>` 的键、Rust 模块名、前端模块 id
- `name`：设置页/侧边栏显示名
- `icon`：`clipboard`（剪贴板图标）/ `gauge`（仪表图标）/ `smile`（表情图标）/ `search`（搜索图标）；新增图标需同步改 `src/App.tsx` 与 `src/components/layout/Sidebar.tsx` 的图标映射
- `enabled`：默认是否启用
- `default_config`：模块配置项的默认值（任意 JSON，启动时并入 config）

> manifest 打包为 resources 嵌入 exe（dev 模式 fallback 到 `src-tauri/modules/` 相对路径），新增模块无需改打包配置。

### Step 2：Rust 后端模块

`src-tauri/src/modules/foo/mod.rs`（必需，至少含 setup 与公开命令）：

```rust
pub mod commands;

use tauri::{AppHandle, Manager, State};
use std::sync::Mutex;

pub struct FooState { /* 模块共享状态 */ }

/// 初始化模块：注册共享状态、启动后台任务（若有）
pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    app.manage(Mutex::new(FooState::default()));
    log::info!("foo module ready");
    Ok(())
}

/// 读模块配置对象（统一入口，勿直接锁 config）
pub fn module_config(app: &AppHandle) -> serde_json::Value {
    app.state::<crate::config::ConfigState>()
        .0
        .lock()
        .unwrap()
        .modules
        .get("foo")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}))
}
```

命令层 `src-tauri/src/modules/foo/commands.rs`（前端 invoke 的入口）：

```rust
#[tauri::command]
pub fn do_something(state: State<'_, Mutex<FooState>>) -> String { /* ... */ }

// ⚠️ 纯配置保存【不要】再写 save_xxx_settings 命令——
// 统一走壳层现成的 set_module_config(module_id, patch)（已注册，直接可用）。
// 只有带副作用/复合状态的设置才值得写专用命令（如 clipboard 的 set_hotkey
// 做热键验证、quota 的 save_settings 保存后重评告警）。
```

约定：
- 命令命名前缀用模块语义（如 `set_max_items`、`get_stats`），避免全局泛名；跨模块同名必须带模块前缀（`#[tauri::command]` 按函数名生成宏符号，rename 解决不了冲突）
- 模块配置读取统一走 `module_config`；**写入统一走前端 `set_module_config`**（Rust 内部写配置仍用 `save_config`）
- 密钥类数据存 Windows 凭据库（keyring），**不落盘明文**（见坑 7）

### Step 3：在 lib.rs 注册

`src-tauri/src/lib.rs`：

```rust
mod modules;              // 已有
// 模块的 pub mod 声明在 modules/mod.rs 中追加：
//   pub mod foo;

// setup 中启用时初始化（与 clipboard/quota 并列）：
if foo_enabled(app.handle()) {
    modules::foo::setup(app)?;
}

// invoke_handler 注册命令：
tauri::generate_handler![
    // ... 现有命令 ...
    modules::foo::commands::do_something,
    modules::foo::commands::save_settings,
]
```

`foo_enabled` 的写法参考 `clipboard_enabled`/`quota_enabled`（读 `config.modules["foo"].enabled`）。

### Step 4：前端组件

`src/modules/foo/Page.tsx`（主窗口内的功能页）与 `src/modules/foo/Settings.tsx`（设置区）：

```tsx
// Page.tsx
import { invoke } from "@tauri-apps/api/core";
export function FooPage() {
  // 用 invoke("do_something") 调后端，按钮/列表等组件参考
  // src/modules/clipboard/Clippage.tsx 的写法
}
```

前端约定与可复用件：
- **列表/网格 + 拖拽排序**：用已装的 `@dnd-kit`（参考 quota 面板与剪贴板固定板块）。⚠️ 拖拽对象为**小尺寸条目**时安全；大卡片注意「坑 9」
- **热键设置**：用共享 `HotkeyRecorder`（录制式），格式为 `Ctrl/Shift/Alt/Super + 键名`
- **横向滚动列表**：用共享 `useHorizontalWheel`（返回 `{ ref, nodeRef }`，nodeRef 用于读取滚动位置）
- **独立窗口跟随主题**：入口调用 `applyTheme(theme)`（参考 `clipboard_popup.tsx`）

接入 `src/App.tsx`：

```tsx
import { FooPage } from "@/modules/foo/Page";

switch (activeModule.id) {
  case "foo":
    return <FooPage />;
  // ...
}

// 设置页追加（参考 clipboard/quota 的设置区块）：
{Boolean(config.modules.foo?.enabled) && (
  <>
    <Separator />
    <div>
      <h3 className="mb-2 text-sm font-semibold">示例模块设置</h3>
      <FooSettings onRefresh={onConfigRefresh} />
    </div>
  </>
)}
```

侧边栏无需改动——manifest 已驱动。

### Step 5（可选）：独立窗口

若模块需要独立窗口（如弹窗）：

1. 根目录新建 `foo_window.html`（参考 `clipboard_popup.html`），脚本指向新入口：
   ```html
   <script type="module" src="/src/foo_window.tsx"></script>
   ```
2. `vite.config.ts` 的 `rollupOptions.input` 增加：
   ```ts
   foo_window: path.resolve(__dirname, "foo_window.html"),
   ```
3. `src/foo_window.tsx`：独立 React 挂载入口（参考 `src/clipboard_popup.tsx`，记得调 `applyTheme` 跟随主题）
4. Rust 侧动态建窗（参考 lib.rs 中 clipboard_popup）：
   ```rust
   let win = tauri::WebviewWindowBuilder::new(
       app, "foo_win", tauri::WebviewUrl::App("foo_window.html".into()),
   )
   .decorations(false)
   .skip_taskbar(true)
   .always_on_top(true)
   .inner_size(300.0, 200.0)
   .build()?;
   win.hide()?;
   ```
5. `src-tauri/capabilities/default.json`：`windows` 数组加入 `"foo_win"`，并按需补充权限（`core:window:allow-*`）

### Step 6：权限声明

模块前端用到的 Tauri 权限（窗口操作、全局快捷键、通知等）在 `capabilities/default.json` 的 `permissions` 中声明。新增窗口必须同时加入 `windows` 数组，否则窗口内所有 invoke 被拒。

### Step 7：测试

后端纯逻辑加 `#[cfg(test)]` 单元测试（参考 clipboard 的 24 个、quota 的 10 个，当前共 36），`cargo test` 全绿。前端无测试框架，靠人工验收。

## 3. 配置管理标准（v0.4.6 起统一，新模块必须遵守）

模块设置的前后端机制已全项目统一为一份，**新模块直接踩在地基上，不要自己再造读写链路**：

### 3.1 三件套写法

```
src/modules/foo/config.ts      # ① 配置类型 + 默认值
src/modules/foo/Page.tsx       # ② 一行接入 Hook
src/modules/foo/Settings.tsx   # ③ 纯受控展示组件
```

```tsx
// ① config.ts —— state 字段用 camelCase；存储键由 Hook 自动转 snake_case
export interface FooConfig {
  viewMode: "grid" | "list";
  gridSize: number;
}
export const FOO_DEFAULTS: FooConfig = { viewMode: "grid", gridSize: 64 };

// ② Page.tsx / Popup.tsx —— 读取、保存、focus 重读、键名映射全部内置
const { cfg, update } = useModuleConfig("foo", FOO_DEFAULTS);
update({ gridSize: 80 });   // 即改即落盘，无需任何 invoke

// ③ Settings.tsx —— 受控契约，禁止自持状态副本、禁止自行 invoke
<FooSettings cfg={cfg} onUpdate={update} />
function FooSettings({ cfg, onUpdate }: { cfg: FooConfig; onUpdate: (p: Partial<FooConfig>) => void }) { ... }
```

参考模板：`emoji/config.ts` + `quicklaunch/Settings.tsx`。

### 3.2 内建行为（Hook 已处理，勿重复实现）

- **键名双向映射**：JS camelCase ↔ config.json snake_case。曾因手写映射不一致导致 emoji 设置整页静默失败、quicklaunch 重启丢设置——此类 bug 已从机制上杜绝
- **默认值合并**：存储缺失的字段回落 defaults
- **窗口 focus 防抖重读**：主窗与弹窗共用同一 moduleId 即自动保持同步（弹窗呼出即拿到最新配置）
- 后端 `set_module_config` 保存后自动 `reapply_hotkeys`（热键变更即时生效）

### 3.3 控件提交时机

- **Slider 直接 `onValueChange` → `onUpdate`**：Hook 内置落盘防抖（400ms 合并），界面边拉边生效，无需草稿值：

```tsx
<Slider value={[cfg.gridSize]} onValueChange={([v]) => onUpdate({ gridSize: v })} />
<span>{cfg.gridSize}px</span>
```

- Switch / 按钮组 / Select：即时生效（同样经 Hook 防抖合并，无感知）

### 3.4 例外规则（何时允许专用命令）

带副作用或复合状态的设置保留专用命令，不算破坏统一：
- clipboard 的 `set_hotkey`（注册验证）、`set_max_items`（清理确认）
- quota 的 `save_settings`（保存后立即重评告警）+ `get_settings`（返回含 keyring 账户的复合视图）

判断标准：**纯「写 JSON 并落盘」→ 必须走统一机制；写入之外还有动作 → 才允许专用命令。**

## 4. 数据与配置规范

- 模块配置：`config.json` 的 `modules.<id>`（HashMap<String, Value>）。**前端读写走 `useModuleConfig` + `set_module_config`（见第 3 节）**；Rust 内部读取用 `module_config`、写回用 `save_config`
- 模块私有数据：`app.path().app_data_dir()/<你的文件>`，即 `%APPDATA%\com.aliboder.easytool\`
- 密钥：`keyring::Entry::new("com.aliboder.easytool", <用户标识>)`。**多账户场景每个账户独立槽位**（参考 quota 的 `get_account_key`/`set_account_key` + `key_ref`，绝不复用固定槽位，否则同类账户串号）
- 配置迁移、旧数据导入：写进 `src-tauri/src/migrate.rs`（一次性，`config.migrated` 标记）
- **时间序列数据**（余额历史/消费历史）：quota 按账户分文件 `balance_history_<account_id>.json`（`{"records":[{time,balance}]}`，ISO 时间），用 `history::daily_series_all` 聚合完整每日序列
- **条目顺序持久化**：数据库加排序列（如剪贴板 `items.pin_order`，NULL=未排过序排最后），查询 `ORDER BY col IS NULL, col ASC`，新增 `set_xxx_order(ids)` 命令保存

## 5. 关键坑（新增模块时必须遵守）

1. **不要用 PowerShell 的 `Get-Content`/`Set-Content` 改写源码**（会把 UTF-8 写成 GBK）。改文件一律用编辑器工具
2. **std Mutex 不可重入**：持 `ConfigState` 或任何 Mutex 锁期间，**绝不调用会再次取锁的函数**（如 `module_config`、`fetch_once` 这类内部取锁的）。先收进块作用域释放锁，再把网络/耗时操作放 `spawn_blocking`
3. **同步网络请求**（如 reqwest blocking）必须在后台线程执行，禁止在 IPC 命令主路径直接调用
4. **Windows 下不要给窗口开 `.transparent(true)`**：透明窗口 hide 后再 show 会崩溃（0xcfffffff）。要"悬浮"效果用深色不透明背景
5. **热键匹配**：`shortcut.to_string()` 输出为 `shift+control+keya` 格式，与配置字符串不匹配。必须用 `Shortcut::from_str(&cfg).map(|s| s == *shortcut)` 做对象比较
6. **新增前端入口**要同时改 4 处：vite `rollupOptions.input`、根目录 `.html`、Rust 建窗（`WebviewUrl::App`）、capabilities 的 `windows` 数组与权限
7. **keyring 必须启用 `features = ["windows-native"]`**（Cargo.toml），否则 `Entry::new().unwrap()` 直接 panic
8. **新增模块后跑 `codegraph init`** 重建索引，保持 `.codegraph/` 与磁盘一致
9. **@dnd-kit 拖拽 + WebView2 渲染变形**：**大尺寸卡片 + opacity + transform 组合会让窗口形状变形**（压扁）。不要给被拖的大卡片加透明度；DragOverlay 方案也会出问题。额度面板用 `verticalListSortingStrategy` + `will-change: transform` + 拖动中禁 transition。**小尺寸条目（如剪贴板固定板块）拖拽安全**
10. **ResizeObserver 绑定异步挂载节点要用回调 ref**：空依赖 `useEffect` 只在组件挂载时跑一次，若目标节点是异步渲染的（如数据加载后），观察器绑不上。用 `useCallback` 回调 ref（React 19 支持 ref 清理）
11. **横向滚动**：滚轮→`scrollLeft` 用共享 `useHorizontalWheel`；注意 `overflow-x-auto` 会把 `overflow-y` 也变 auto，**悬浮元素（tooltip）别放超出滚动容器顶部**，否则被裁掉
12. **热键录制格式**：global-hotkey crate 接受 `Ctrl/Shift/Alt/Super`（Windows 键是 **Super**，不是 Win）+ 键名（`A-Z/0-9/F1-F24/ArrowUp/Enter/Space` 等）。用共享 `HotkeyRecorder` 组件
13. **版本号三处同步**：改版本需同时改 `package.json`、`tauri.conf.json`、`src-tauri/Cargo.toml`；当前 Tauri CLI **不支持 portable** 打包目标（仅 msi/nsis）
14. **Windows 文件图标**：`SHGFI_USEFILEATTRIBUTES` 取不到格式专属图标（txt/图片等退化为通用图标），须访问真实文件再回退；缓存按路径而非扩展名
15. **多账户密钥槽位必须独立**：quota 新增账户 `key_ref` 分配独立槽位（`quota-<id>`），绝不复用/回退旧槽位（否则所有同类账户串号共用同一密钥）。旧账户用 `migrate_account_keyrefs` 幂等迁移
16. **窗口尺寸记忆要过滤脏数据**：窗口隐藏/最小化时 WebView2 报 0x0，`onResized`/保存/恢复都要校验最小尺寸（<400x300 忽略）；`minWidth/minHeight` 只约束用户拖拽，编程 `set_size` 不受限
17. **独立窗口延迟创建**：不要在 setup 创建隐藏弹窗（`.visible(false)` 在 Windows WebView2 上仍会闪现），首次呼出时才建窗（参考 `clipboard::ensure_popup_window`）
18. **窗口入场动画**：用共享 `useWindowEntrance`（失焦置透明 + 聚焦重放），避免「先显示完整界面再补动画」的闪烁；不要重挂载根节点触发（会丢子组件状态）
19. **SQLite 建索引必须在列添加之后**：索引引用的列若在版本迁移中才添加（如 `pin_order`），索引创建要放在迁移之后，否则新库建表直接失败
20. **Tauri v2 invoke 参数 JS 侧必须 camelCase**：Rust 参数 `follow_mouse` ↔ JS 键名 `followMouse`。用 snake_case 键名调用会反序列化失败且**静默无报错**（emoji 曾因此所有设置存不上）。配置读写走 useModuleConfig 可天然避开；手写 invoke 其他命令时务必注意

## 6. 完成清单

新增模块后逐项自检：

- [ ] manifest.json 字段齐全（id/name/icon/enabled/default_config）
- [ ] `modules/mod.rs` 已声明 `pub mod foo`；lib.rs setup 与 invoke_handler 已注册
- [ ] 前端页面/设置已接入 App.tsx（导航栏自动出现）
- [ ] 独立窗口的 4 处联动齐全，capabilities 权限完备
- [ ] 配置读写走 `module_config` + `save_config`，无持锁嵌套调用
- [ ] **模块设置走统一地基**：config.ts + useModuleConfig + 受控 Settings（第 3 节），未自写 save_xxx_settings 纯配置命令
- [ ] Slider 用 onValueCommit 落盘；手写 invoke 的参数键名为 camelCase
- [ ] 网络/耗时操作在后台线程
- [ ] 拖拽排序：小条目用 @dnd-kit；大卡片注意坑 9（不加 opacity、will-change、禁 transition）
- [ ] 横向滚动 / 热键录制 / 主题复用共享组件（useHorizontalWheel / HotkeyRecorder / applyTheme）
- [ ] `cargo test` 全绿、`npx tsc --noEmit` 无错
- [ ] 手动验收清单已给用户（启动命令 + 验证点）
- [ ] `codegraph init` 重建索引后提交

## 7. 参考实现

新增模块时对照这些现成模块：

- **clipboard**：独立弹窗窗口（延迟创建）+ 系统剪贴板监听 + 文件存储（缩略图/图标）+ 固定板块拖拽排序（小条目 @dnd-kit）+ 弹窗位置/尺寸记忆 + 监听规则，最完整的模块参照
- **quota**：后台轮询线程 + **多账户支持**（账户增删改 + 独立密钥槽位 key_ref + 独立余额/历史）+ 告警通知 + 消费历史按账户分文件 + 完整时间线（横向滚动）+ 面板卡片拖拽排序（@dnd-kit + will-change），后台任务/数据可视化/多实例类模块参照
- **search**：动态加载第三方 DLL（`Everything64.dll`，MIT，从官方 SDK 下载打包进 `modules/search/`）+ SDK 全局状态用互斥锁串行 + 查询放后台线程 + 复用剪贴板图标/缩略图命令 + 弹窗模式复用，外部依赖/FFI 类模块参照。⚠️ Tauri 命令若与其他模块同名，**函数名须带模块前缀**（`search_get_status`），`#[tauri::command(rename=...)]` 无法解决宏符号冲突
- **quicklaunch**：固定项/文件夹管理（SQLite）+ 文件夹分组展示（2x2 网格预览）+ 拖拽排序（@dnd-kit）+ 网格/列表视图切换 + 文件拖入固定 + 右键菜单管理，文件夹/分组类模块参照
- **emoji**：`config.ts` + `useModuleConfig` + 受控 Settings 的**配置管理标准参照实现**（主窗 Page 与弹窗 Popup 共用同一 Hook 自动同步）；含内置表情/图片表情双网格 + 收藏/分组