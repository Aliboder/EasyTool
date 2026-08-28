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
- 模块可拥有独立窗口，也可仅作为主窗口内的一个页面——**当前所有模块均为主窗口内的页面**（独立弹窗已移除）
- **复用共享前端工具**（不要重复造轮子，按使用频率排序）：
  - `useModuleConfig`（`src/hooks/useModuleConfig.ts`）——**模块配置统一读写，新模块设置功能的地基，必用**（见「3. 配置管理标准」）
  - `useFileIcons`（`src/hooks/useFileIcons.ts`）——文件图标/缩略图按路径缓存 + 并发去重，返回 `{ icons, thumbs, loadIcon(path), loadThumb(path) }`
  - 网格公式库（`src/lib/grid.ts`）——`gridIconSize` / `gridFontScale` / `gridColumns` / `gridVerticalTarget`（见「5. 网格实现标准」）
  - 面板头三件套（`src/components/module-header.tsx`）——`ModuleHeader` / `HeaderButton` / `HeaderSort`，全模块顶栏唯一实现（见「6. 面板头标准」，**必用**）
  - `toast()`（`src/lib/toast.ts`）——操作反馈提示（规范见第 4 节「操作反馈」条目）
  - 其他场景件：`applyTheme`（主题跟随）/ `useHorizontalWheel`（滚轮→横向滚动）/ `useWindowEntrance`（呼出入场动画，失焦置透明+聚焦重放防闪烁）/ `HotkeyRecorder`（热键录制）/ `LazyImage`（懒加载图片）/ 右键菜单三件套 `ui/context-menu(-item/-divider).tsx`

## 2. 新增模块完整步骤（以模块 `foo` 为例）

**改动文件总览**（先看清工作量边界再动手）：

| 文件 | 必需性 | 作用 |
|---|---|---|
| `src-tauri/modules/foo/manifest.json` | ✅ 必需 | 元数据 + 默认配置（Step 1） |
| `src-tauri/src/modules/foo/mod.rs` + `commands.rs` | ✅ 按需（纯前端模块可无后端） | 业务命令层（Step 2） |
| `src-tauri/src/modules/mod.rs` / `lib.rs` | ✅ 有后端时 | 声明 + setup + 注册命令（Step 3） |
| `src/modules/foo/Page.tsx` + `config.ts` + `Settings.tsx` | ✅ 必需 | 功能页 + 配置三件套（Step 4 + 第 3 节） |
| `src/App.tsx` | ✅ 必需 | 页面路由 switch + 设置区挂载（Step 4） |

### Step 1：创建 manifest

`src-tauri/modules/foo/manifest.json`：

```json
{
  "id": "foo",
  "name": "示例模块",
  "icon": "clipboard",
  "enabled": true,
  "default_config": { "max_items": 100 }
}
```

字段说明：
- `id`：唯一标识，作为 config 中 `modules.<id>` 的键、Rust 模块名、前端模块 id
- `name`：设置页/侧边栏显示名
- `icon`：`clipboard` / `gauge`（仪表）/ `smile`（表情）/ `search`（搜索）；新增图标需同步改 `src/App.tsx` 与 `src/components/layout/Sidebar.tsx` 的图标映射
- `enabled`：默认是否启用
- `default_config`：模块配置项的默认值（任意 JSON，启动时并入 config）

> manifest 打包为 resources 嵌入 exe（dev 模式 fallback 到 `src-tauri/modules/` 相对路径），新增模块无需改打包配置。

### Step 2：Rust 后端模块

`src-tauri/src/modules/foo/mod.rs`（必需，至少含 setup 与公开命令）：

```rust
pub mod commands;

use std::sync::Mutex;

pub struct FooState { /* 模块共享状态 */ }

/// 初始化模块：注册共享状态、启动后台任务（若有）
pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    app.manage(Mutex::new(FooState::default()));
    log::info!("foo module ready");
    Ok(())
}
```

> ⚠️ **不要**在 mod.rs 里写模块级 `module_config()` 函数——读配置直接调 `crate::config::module_cfg(&app, "foo")`，写配置用 `crate::config::update_module`（见第 4 节）。历史上每个模块各抄一份导致五份重复，已全部清理。

命令层 `src-tauri/src/modules/foo/commands.rs`（前端 invoke 的入口）：

```rust
#[tauri::command]
pub fn do_something(state: State<'_, Mutex<FooState>>) -> String { /* ... */ }

// ⚠️ 纯「写 JSON 并落盘」的配置保存【不要】写任何命令——
// 前端 useModuleConfig 自动走壳层现成的 set_module_config(module_id, patch)。
// 只有带副作用的设置才值得写专用命令（如 clipboard 的 set_hotkey
// 做热键验证、quota 的 save_settings 保存后重评告警）。
```

约定：
- 命令命名前缀用模块语义（如 `set_max_items`、`get_stats`），避免全局泛名；跨模块同名必须带模块前缀（`#[tauri::command]` 按函数名生成宏符号，rename 解决不了冲突）
- Rust 侧配置读写只用 `config::module_cfg` / `config::update_module`；前端纯配置写入自动走 `set_module_config`
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
- **模块配置**：按第 3 节三件套写法接入 `useModuleConfig`，Settings 组件走受控契约（`{cfg, onUpdate}`），不写任何保存 invoke
- **列表/网格 + 拖拽排序**：用已装的 `@dnd-kit`（参考 quota 面板与剪贴板固定板块）。⚠️ 拖拽对象为**小尺寸条目**时安全；大卡片注意「坑 9」
- **网格布局**：遵守第 5 节网格标准（CSS Grid + grid.ts 公式）
- **热键设置**：用共享 `HotkeyRecorder`（录制式），格式为 `Ctrl/Shift/Alt/Super + 键名`
- **横向滚动列表**：用共享 `useHorizontalWheel`（返回 `{ ref, nodeRef }`，nodeRef 用于读取滚动位置）
- **操作反馈**：用户触发的增删改失败必须 toast（`import { toast } from "@/lib/toast"`）

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

### Step 5：权限声明（无独立窗口）

所有模块均作为主窗口内的一个页面（**独立弹窗已移除**：不要新增 HTML 入口、vite `rollupOptions.input` 条目、Rust 建窗或 capabilities `windows` 声明）。模块前端用到的 Tauri 权限在 `capabilities/default.json` 的 `permissions` 中声明。

### Step 7：测试

后端纯逻辑加 `#[cfg(test)]` 单元测试（当前全项目 66 个，以 `cargo test` 输出为准），`cargo test` 全绿。前端无测试框架，靠人工验收（完成后给用户手动验收清单）。

## 3. 配置管理标准（新模块必须遵守）

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

参考模板：`emoji/config.ts` + `search/SearchSettings.tsx`。

### 3.2 内建行为（Hook 已处理，勿重复实现）

- **键名双向映射**：JS camelCase ↔ config.json snake_case。曾因手写映射不一致导致 emoji 设置整页静默失败——此类 bug 已从机制上杜绝
- **默认值合并**：存储缺失的字段回落 defaults
- **窗口 focus 防抖重读**：主窗与弹窗共用同一 moduleId 即自动保持同步（弹窗呼出即拿到最新配置）
- 后端 `set_module_config` 保存后自动 `reapply_hotkeys`（热键变更即时生效）

### 3.3 控件提交时机

- **Slider 一律 `onValueChange` 直连 `onUpdate`**——Hook 内置 400ms 防抖合并写盘，拖动流畅且不会丢设置：

```tsx
<Slider value={[cfg.gridSize]} onValueChange={([v]) => onUpdate({ gridSize: v })} />
```

- Switch / 按钮组 / Select：即时生效，同样直连
- 唯一例外：**保存需要二次确认流程**时才用 `onValueCommit`（如 clipboard「历史上限」缩小要弹确认框）

### 3.4 例外规则（何时允许专用命令）

带副作用或复合状态的设置保留专用命令，不算破坏统一：
- clipboard 的 `set_hotkey`（注册验证）、`set_max_items`（清理确认）
- quota 的 `save_settings`（保存后立即重评告警）+ `get_settings`（返回含 keyring 账户的复合视图）

判断标准：**纯「写 JSON 并落盘」→ 必须走统一机制；写入之外还有动作 → 才允许专用命令。**

## 4. 数据与配置规范

- 模块配置：`config.json` 的 `modules.<id>`（HashMap<String, Value>）。**前端读写走 `useModuleConfig` + `set_module_config`（见第 3 节）**；Rust 侧统一用 `config.rs` 的两个助手——读 `module_cfg(app, "<id>")`，改写落盘 `update_module(app, "<id>", |v| { ...; Ok(()) })?`（内置加锁/存盘/锁释放时机）。**禁止再造模块级 `module_config()` 副本或手写「锁→get_mut→save」样板**（v0.4.6 已清理五份副本）；写入之外还有动作的才写专用命令
- **操作反馈**：用户触发的命令（增删改、保存）失败必须 toast/内联提示，不得只 `console.error` 静默吞掉；成功无可见变化时也补 toast（参考 quota 的 QuotaSettings.tsx）
- **文件图标/缩略图**：唯一入口是共享命令 `get_file_icon` / `get_file_thumb`，前端一律经 `useFileIcons` 缓存调用；禁止再造模块级图标加载命令或手写缓存 map
- 模块私有数据：`app.path().app_data_dir()/<你的文件>`，即 `%APPDATA%\com.aliboder.easytool\`
- 密钥：`keyring::Entry::new("com.aliboder.easytool", <用户标识>)`。**多账户场景每个账户独立槽位**（参考 quota 的 `get_account_key`/`set_account_key` + `key_ref`，绝不复用固定槽位，否则同类账户串号）
- 配置迁移、旧数据导入：写进 `src-tauri/src/migrate.rs`（一次性，`config.migrated` 标记）
- **时间序列数据**（余额历史/消费历史）：quota 按账户分文件 `balance_history_<account_id>.json`（`{"records":[{time,balance}]}`，ISO 时间），用 `history::daily_series_all` 聚合完整每日序列
- **条目顺序持久化**：数据库加排序列（如剪贴板 `items.pin_order`，NULL=未排过序排最后），查询 `ORDER BY col IS NULL, col ASC`，新增 `set_xxx_order(ids)` 命令保存

## 5. 网格实现标准

涉及格子网格的模块（search/emoji/clipboard）一律遵守：

1. **容器**：真 CSS Grid，`className="grid gap-2"` + `style={{ gridTemplateColumns: repeat(auto-fill, Npx), gridAutoRows: Npx }}`（N=配置的格子尺寸）。**不要用 flex-wrap 模拟网格**
2. **内容缩放公式**：从 `src/lib/grid.ts` 引用 `gridIconSize(cell)`（图标 50%）与 `gridFontScale(cell)`（字号 15%），禁止手写魔法数字。例外：emoji 字形即内容，用 70% 比例
3. **键盘 ↑↓ 跨行步进**：必须用 `gridColumns(el)` 实测列数（勿手写 ±1 或硬编码 gap）；列表视图保持线性 ±1
4. **gap 统一 8px**（`gap-2`）；密集表情格可用 `gap-1`
5. **数据量策略不强制统一**（search 分页 / emoji 批渲染 / clipboard 上限拉取），按各自数据规模选择
6. 剪贴板的横向胶卷条（`grid-flow-col grid-rows-1`）是刻意的横向流设计，不属于本规范约束范围

## 6. 面板头标准（ModuleHeader，新模块必须遵守）

所有模块的顶栏（搜索行 + Tab 行）一律由 `src/components/module-header.tsx` 渲染，**禁止手写两行式头部 JSX**：

```tsx
import { ModuleHeader, HeaderButton, HeaderSort } from "@/components/module-header";

<ModuleHeader
  search={{ value, onChange, placeholder, autoFocus }}  // 第一行：无边框输入框占满
  searchTrailing={<>加载圈/计数</>}                      // 搜索框行内右侧附属
  actions={                                             // 第一行右端按钮组（HeaderButton 统一样式）
    <>
      <HeaderButton title="切换视图" onClick={toggleView}>…</HeaderButton>
      <HeaderButton title="xx设置" active={showSettings} onClick={…}>
        <Settings2 className="size-4" />
      </HeaderButton>
    </>
  }
  tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}  // 第二行 Tab（放不下自动换行）
  activeTab={tab}
  onTabChange={setTab}
  tabsTrailing={<HeaderSort … />}                        // 第二行右端次要控件（可选）
/>
```

规则：
1. **无搜索框的模块**（如额度监控）第一行用 `title=` + `meta=` 占据搜索框位置，结构不变
2. **设置齿轮为最后一个按钮**（所有模块一致）
3. **Tab 放不下自动换行**（flex-wrap 已内置），不要为省高度隐藏或滚动 Tab
4. **排序控件用 `HeaderSort`**：字段按钮点击按 fields 顺序循环、方向按钮翻转升降；字段集由模块自定义（参考 SearchView 的 `SORT_FIELDS`）
5. 视觉规格已内置（border-b、p-2、Tab 选中态 bg-primary 等），调用方不要再叠样式
6. 参考实现：`SearchView.tsx`（功能最全：search + trailing + actions + 图标 tabs + HeaderSort）

## 7. 关键坑（新增模块时必须遵守）

> **最易翻车五条**：坑 1（PowerShell 写文件变 GBK 乱码）、坑 2（Mutex 重入死锁）、坑 4（透明窗口崩溃）、坑 7（keyring 缺 feature 直接 panic）、坑 20（invoke 参数 snake_case **静默失败无报错**）。其余为场景性陷阱，用到对应功能时再查。

1. **不要用 PowerShell 的 `Get-Content`/`Set-Content` 改写源码**（会把 UTF-8 写成 GBK）。改文件一律用编辑器工具
2. **std Mutex 不可重入**：持 `ConfigState` 或任何 Mutex 锁期间，**绝不调用会再次取锁的函数**（如 `module_config`、`fetch_once` 这类内部取锁的）。先收进块作用域释放锁，再把网络/耗时操作放 `spawn_blocking`
3. **同步网络请求**（如 reqwest blocking）必须在后台线程执行，禁止在 IPC 命令主路径直接调用
4. **Windows 下不要给窗口开 `.transparent(true)`**：透明窗口 hide 后再 show 会崩溃（0xcfffffff）。要"悬浮"效果用深色不透明背景
5. **热键匹配**：`shortcut.to_string()` 输出为 `shift+control+keya` 格式，与配置字符串不匹配。必须用 `Shortcut::from_str(&cfg).map(|s| s == *shortcut)` 做对象比较
6. **独立弹窗已移除**：不再需要新增前端入口 / Rust 建窗 / capabilities windows 声明（历史参考：先前的 4 处联动坑，仅适用于已删除的弹窗体系）
7. **keyring 必须启用 `features = ["windows-native"]`**（Cargo.toml），否则 `Entry::new().unwrap()` 直接 panic
8. **新增模块后跑 `codegraph init`** 重建索引，保持 `.codegraph/` 与磁盘一致
9. **@dnd-kit 拖拽 + WebView2 渲染变形**：**大尺寸卡片 + opacity + transform 组合会让窗口形状变形**（压扁）。不要给被拖的大卡片加透明度；DragOverlay 方案也会出问题。额度面板用 `verticalListSortingStrategy` + `will-change: transform` + 拖动中禁 transition。**小尺寸条目（如剪贴板固定板块）拖拽安全**
10. **ResizeObserver 绑定异步挂载节点要用回调 ref**：空依赖 `useEffect` 只在组件挂载时跑一次，若目标节点是异步渲染的（如数据加载后），观察器绑不上。用 `useCallback` 回调 ref（React 19 支持 ref 清理）
11. **横向滚动**：滚轮→`scrollLeft` 用共享 `useHorizontalWheel`；注意 `overflow-x-auto` 会把 `overflow-y` 也变 auto，**悬浮元素（tooltip）别放超出滚动容器顶部**，否则被裁掉
12. **热键录制格式**：global-hotkey crate 接受 `Ctrl/Shift/Alt/Super`（Windows 键是 **Super**，不是 Win）+ 键名（`A-Z/0-9/F1-F24/ArrowUp/Enter/Space` 等）。全局呼出热键用共享 `HotkeyRecorder` 组件（设置页）
13. **版本号三处同步**：改版本需同时改 `package.json`、`tauri.conf.json`、`src-tauri/Cargo.toml`；当前 Tauri CLI **不支持 portable** 打包目标（仅 msi/nsis）
14. **Windows 文件图标**：`SHGFI_USEFILEATTRIBUTES` 取不到格式专属图标（txt/图片等退化为通用图标），须访问真实文件再回退；缓存按路径而非扩展名
15. **多账户密钥槽位必须独立**：quota 新增账户 `key_ref` 分配独立槽位（`quota-<id>`），绝不复用/回退旧槽位（否则所有同类账户串号共用同一密钥）。旧账户用 `migrate_account_keyrefs` 幂等迁移
16. **窗口尺寸记忆要过滤脏数据**：窗口隐藏/最小化时 WebView2 报 0x0，`onResized`/保存/恢复都要校验最小尺寸（<400x300 忽略）；`minWidth/minHeight` 只约束用户拖拽，编程 `set_size` 不受限
17. **独立弹窗已移除**（历史教训：`.visible(false)` 在 Windows WebView2 上仍会闪现，旧弹窗体系用延迟创建规避）
18. **窗口入场动画**：用共享 `useWindowEntrance`（失焦置透明 + 聚焦重放），避免「先显示完整界面再补动画」的闪烁；不要重挂载根节点触发（会丢子组件状态）
19. **SQLite 建索引必须在列添加之后**：索引引用的列若在版本迁移中才添加（如 `pin_order`），索引创建要放在迁移之后，否则新库建表直接失败
20. **Tauri v2 invoke 参数 JS 侧必须 camelCase**：Rust 参数 `follow_mouse` ↔ JS 键名 `followMouse`。用 snake_case 键名调用会反序列化失败且**静默无报错**（emoji 曾因此所有设置存不上）。配置读写走 useModuleConfig 可天然避开；手写 invoke 其他命令时务必注意

## 8. 完成清单

新增模块后逐项自检：

- [ ] manifest.json 字段齐全（id/name/icon/enabled/default_config）
- [ ] `modules/mod.rs` 已声明 `pub mod foo`；lib.rs setup 与 invoke_handler 已注册
- [ ] 前端页面/设置已接入 App.tsx（导航栏自动出现）
- [ ] 配置读写走 `module_cfg` / `update_module`（config.rs 助手），无自建 module_config 副本、无持锁嵌套调用
- [ ] **模块设置走统一地基**：config.ts + useModuleConfig + 受控 Settings（第 3 节），未自写 save_xxx_settings 纯配置命令
- [ ] **用户操作有反馈**：失败必提示（toast/内联），成功无可见变化时补 toast；不得只 console.error
- [ ] **图标/缩略图经 useFileIcons**（未手写缓存、未新增重复命令）
- [ ] **面板头用 ModuleHeader**（第 6 节）：未手写两行式头部；齿轮为最后一个按钮且全模式显示；Tab 溢出依赖内置换行；排序用 HeaderSort
- [ ] Slider 用 onValueChange 直连 onUpdate（Hook 防抖落盘）；手写 invoke 的参数键名为 camelCase
- [ ] 网络/耗时操作在后台线程
- [ ] 拖拽排序：小条目用 @dnd-kit；大卡片注意坑 9（不加 opacity、will-change、禁 transition）
- [ ] 横向滚动 / 热键录制 / 主题复用共享组件（useHorizontalWheel / HotkeyRecorder / applyTheme）
- [ ] `cargo test` 全绿、`npx tsc --noEmit` 无错
- [ ] 手动验收清单已给用户（启动命令 + 验证点）
- [ ] `codegraph init` 重建索引后提交

## 9. 参考实现

新增模块时对照这些现成模块：

- **search** 的 `SearchView.tsx` 同时是**面板头参照实现**（ModuleHeader 全功能：search + searchTrailing + actions + 图标 tabs + HeaderSort，见第 6 节）
- **clipboard**：系统剪贴板监听 + 文件存储（缩略图/图标）+ 固定板块拖拽排序（小条目 @dnd-kit）+ 跟手粘贴（隐藏主窗口注入），最完整的模块参照
- **quota**：后台轮询线程 + **多账户支持**（账户增删改 + 独立密钥槽位 key_ref + 独立余额/历史）+ 告警通知 + 消费历史落 SQLite + 完整时间线（横向滚动）+ 面板卡片拖拽排序（@dnd-kit + will-change），后台任务/数据可视化/多实例类模块参照
- **search**：动态加载第三方 DLL（`Everything64.dll`，MIT，从官方 SDK 下载打包进 `modules/search/`）+ SDK 全局状态用互斥锁串行 + 查询放后台线程 + 复用剪贴板图标/缩略图命令 + 应用中心（已安装应用扫描/频率计数/启动），外部依赖/FFI 类模块参照。⚠️ Tauri 命令若与其他模块同名，**函数名须带模块前缀**（`search_get_status`），`#[tauri::command(rename=...)]` 无法解决宏符号冲突
- **emoji**：`config.ts` + `useModuleConfig` + 受控 Settings 的**配置管理标准参照实现**；含内置表情/图片表情双网格 + 收藏/分组