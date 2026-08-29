# EasyTool 新增模块开发指南

本指南供 AI Agent 阅读：如何为 EasyTool 快速新增一个功能模块并衔接现有架构。开发前请结合 `AGENTS.md` 阅读；文档与代码不一致时以代码为准。

> 当前事实基线：后端 Rust 单元测试 **116 通过 / 3 ignored**（3 个需真实 Everything / 真实 .ics 文件，默认忽略）；前端 vitest **48 通过**（纯函数单测，见第 7 节）；构建要求 `cargo build` 零警告。

## 1. 模块是什么

EasyTool 是「单应用 + 模块注册表」架构。**一个模块 = 一段相对独立的业务功能**，包含：

```
src-tauri/modules/<id>/manifest.json   # 模块清单（元数据 + 默认配置）
src-tauri/src/modules/<id>/            # Rust 后端（可选，纯前端模块可无）
src/modules/<id>/                      # React 前端（页面 + 配置三件套）
```

- 模块在「设置 → 功能模块」可独立**启用/禁用/拖拽排序**，配置项随模块独立保存（`config.json` 的 `modules.<id>`）
- 底部导航栏由 manifest 驱动：**manifest 一建好，导航按钮自动出现**，无需改导航
- **所有模块都是主窗口内的一个页面**（独立弹窗体系已整体移除，不要新建 HTML 入口/窗口）
- 每个模块页面自带一个**设置抽屉**（页面顶栏齿轮按钮打开），全局设置页不含模块设置
- 共享前端工具（不要重复造轮子）：
  - `useModuleConfig`（`src/hooks/useModuleConfig.ts`）——模块配置统一读写，**新模块设置的必经之路**（见「3. 配置管理标准」）
  - `useFileIcons`（`src/hooks/useFileIcons.ts`）——文件图标/缩略图按路径缓存 + 去重
  - 网格公式库 `src/lib/grid.ts`（见「5. 网格实现标准」）
  - 面板头 `ModuleHeader / HeaderButton / HeaderSort`（`src/components/module-header.tsx`，**必用**，见「6. 面板头标准」）
  - `toast()`、右键菜单三件套 `ui/context-menu(-item/-divider).tsx`、`Drawer`、`useHorizontalWheel`、`useWindowEntrance`、`HotkeyRecorder`、`LazyImage`、`@dnd-kit`（拖拽排序）

## 2. 新增模块完整步骤（以模块 `foo` 为例）

**改动文件总览**（先看清工作量边界再动手）：

| 文件 | 必需性 | 作用 |
|---|---|---|
| `src-tauri/modules/foo/manifest.json` | ✅ 必需 | 元数据 + 默认配置（Step 1） |
| `src-tauri/src/modules/foo/mod.rs` (+`commands.rs`) | 🔸 纯前端模块可无 | 业务命令层 / 后台线程（Step 2） |
| `src-tauri/src/modules/mod.rs` / `lib.rs` | 🔸 有后端时 | 声明 + 并行初始化 + 注册命令（Step 3） |
| `src/modules/foo/Page.tsx` + `config.ts` + `Settings.tsx` | ✅ 必需 | 功能页 + 配置三件套（Step 4 + 第 3 节） |
| `src/App.tsx` | ✅ 必需 | lazу 分包 + keep-alive 挂载 + 预载表（Step 4） |
| `src/components/layout/Sidebar.tsx` | ✅ 必需 | 导航图标映射加一项（Step 4） |
| `src-tauri/capabilities/default.json` | 🔸 用到新插件时 | 权限声明（Step 5） |

### Step 1：创建 manifest

`src-tauri/modules/foo/manifest.json`：

```json
{
  "id": "foo",
  "name": "示例模块",
  "icon": "bot",
  "description": "一句话说明（设置页搜索用，可省略）",
  "enabled": true,
  "default_config": { "max_items": 100 }
}
```

字段：
- `id`：唯一标识 = config 键 `modules.<id>` = Rust 模块名 = 前端模块 id，**全链路同名**
- `name`：导航/设置页显示名；`icon`：导航图标键（见下）
- `enabled`：默认启用；`default_config`：任意 JSON，首次启动并入 config（`modules/merge_manifests`，幂等，已存在的键不覆盖）
- `description`：可选，设置页「功能模块」搜索用

> `icon` 是**键名字符串**，须在 `src/components/layout/Sidebar.tsx` 的 `ICONS` 映射里加一项（现有键：`clipboard/clock/gauge/smile/search/bot/calendar`，lucide 图标），缺了会回退默认图标。**不要改 manifest 的 icon 为组件引用**。
>
> manifest 打包为 resources 嵌入 exe（dev 模式 fallback 到 `src-tauri/modules/`），新增模块无需改打包配置。

### Step 2：Rust 后端模块

`src-tauri/src/modules/foo/mod.rs`（必需，至少含 setup 与公开命令）：

```rust
pub mod commands;

/// 从 AppHandle 初始化（并行初始化线程里调用；幂等，可重复调用）
pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    // 1. 注册共享状态（Mutex 串行化）
    app.manage(std::sync::Mutex::new(FooState::default()));
    // 2. 后台任务（轮询/监听）用 std::thread::spawn，阻塞式网络放这里
    let handle = app.clone();
    std::thread::spawn(move || loop { /* ... */ });
    log::info!("foo module ready");
    Ok(())
}
```

命令层 `src-tauri/src/modules/foo/commands.rs`（前端 invoke 的入口）：

```rust
#[tauri::command]
pub fn do_something(state: State<'_, Mutex<FooState>>) -> String { /* ... */ }

// ⚠️ 纯「写 JSON 并落盘」的配置保存【不要】写任何命令——
// 前端 useModuleConfig 自动走壳层现成的 set_module_config(module_id, patch)。
// 只有带副作用的设置才写专用命令（如 quota 保存后重评告警）。
```

约定：
- 命令命名带模块语义前缀（`clipboard_*` / `search_*` / `quota_*`），**跨模块同名函数会撞 `__cmd__` 宏**，`#[tauri::command(rename=...)]` 解决不了，必须函数名区分
- 读配置 `crate::config::module_cfg(&app, "foo")`，写配置 `crate::config::update_module(&app, "foo", |v| { ...; Ok(()) })?`；**禁止再造模块级 `module_config()` 副本**（历史五份副本已清理），禁止持锁期间再取锁（坑 2）
- ⚠️ **存储键一律 snake_case**：config.json 里存的都是 snake_case（前端 useModuleConfig 自动把 camelCase 字段转成 snake_case 落盘）。后端读配置**必须读 snake_case 键**——timetracker 曾用 camelCase 读 `afkThresholdSec` 导致设置永不生效（静默），已修的教训
- 密钥类数据存 Windows 凭据库（keyring，`keyring::Entry::new("com.aliboder.easytool", <用户标识>)`），**不落盘明文**；多账户场景每个账户独立槽位（坑 7/15）
- 同步网络请求只在后台线程（坑 3）；轮询热路径用 SQL 聚合/去重，避免每轮全量加载（见第 4 节）

### Step 3：在壳层注册

`src-tauri/src/modules/mod.rs`：`pub mod foo;` 追加声明。

`src-tauri/src/lib.rs`：
1. 写启用判断助手（参考 `clipboard_enabled`，读 `config.modules["foo"].enabled`）
2. **setup 的并行初始化区**（约 535-588 行）加一个与现有模块并列的分支：

```rust
let foo_handle = if foo_enabled(app.handle()) {
    log::info!("[setup] initializing foo module");
    let app_clone = app.handle().clone();
    Some(std::thread::spawn(move || modules::foo::setup_from_handle(&app_clone)))
} else {
    log::info!("[setup] foo module disabled, skipping");
    None
};
```

3. **join 策略**（约 590-696 行，决定主窗口首屏依赖）：
   - 主窗口首屏**依赖**该模块（如剪贴板）→ 在 `reapply_hotkeys` 前同步 join
   - 不依赖 → 参考 quota（延迟 500ms 后台 join）或 search/emoji/timetracker（统一后台线程 join）
4. `invoke_handler` 注册命令：`modules::foo::commands::do_something,`
5. 若模块需要新插件权限（dialog/notification/updater 等），在 `capabilities/default.json` 的 `permissions` 追加（窗口只有 `main`）

### Step 4：前端

#### 4.1 页面组件

`src/modules/foo/Page.tsx`：主窗口内的功能页。需要「切走时暂停工作」的模块（如 emoji 的检测、timetracker 渲染）接收 `active: boolean` prop（参考 `App.tsx` 里 `EmojiPage active={...}`）。页面顶栏一律 `ModuleHeader`，设置放独立组件 + `Drawer`：

```tsx
export function FooPage() {
  const { cfg, update } = useModuleConfig("foo", FOO_DEFAULTS);
  const [showSettings, setShowSettings] = useState(false);
  return (
    <>
      <ModuleHeader
        title="示例模块"                       // 无搜索框时用 title/meta 占位
        meta={<>附加说明</>}
        actions={
          <>
            {/* ...功能按钮... */}
            <HeaderButton title="foo 设置" active={showSettings} onClick={() => setShowSettings(v => !v)}>
              <Settings2 className="size-4" />
            </HeaderButton>
          </>
        }
      />
      {/* 页面主体（列表 / 网格 / 图表） */}
      <Drawer open={showSettings} onClose={() => setShowSettings(false)} title="示例模块设置">
        <FooSettings cfg={cfg} onUpdate={update} />
      </Drawer>
    </>
  );
}
```

#### 4.2 配置三件套

`src/modules/foo/config.ts`（类型 + 默认值）→ `useModuleConfig("foo", FOO_DEFAULTS)` → 受控 `Settings.tsx`（见第 3 节）。**模块设置不进全局设置页**，都在本模块的 Drawer 里。

#### 4.3 App.tsx 接入（关键步骤，漏一步页面不出）

`src/App.tsx` 里模块是 **lazy 分包 + keep-alive** 挂载，共四处：

```tsx
// ① lazy 分包（页面首次访问才加载）
const importFoo = () =>
  import("@/modules/foo/Page").then((m) => ({ default: m.FooPage }));
const FooPage = lazy(loadPage("foo", importFoo));

// ② 预载表：启动时按「上次使用模块」预载落地页 + 后台预载其余（key 必须与模块 id 一致）
const PAGE_IMPORTS: Record<string, () => Promise<{ default: React.ComponentType<any> }>> = {
  // ...现有 5 个模块...
  foo: importFoo,
};

// ③ keep-alive 渲染区（renderModules()）：
{visited.has("foo") && (
  <div className={active === "foo" ? "h-full" : "hidden"}>
    <FooPage />
  </div>
)}
```

> 检查点：**`PAGE_IMPORTS` 没有 foo 的 entry** → 启动预载失效、恢复上次模块时该页空白。拖动/排序等交互参考现有模块；大卡片拖拽见坑 9 的固定高度方案。

#### 4.4 Sidebar 图标

`src/components/layout/Sidebar.tsx` 的 `ICONS` 映射加一项：`foo: FooIcon,`（lucide 图标组件）。导航顺序/启用在设置页拖拽/开关，代码无需改。

### Step 5：权限声明

所有模块均为主窗口内页面——**不要新增 HTML 入口、vite `rollupOptions.input` 条目、Rust 建窗或 capabilities `windows` 声明**（单入口 MPA 不要动，见 `vite.config.ts`）。模块前端用到的 Tauri 插件权限统一在 `capabilities/default.json` 的 `permissions` 中追加。

### Step 6：测试

- 后端纯逻辑 `#[cfg(test)]`（当前 116 通过 / 3 ignored，`cargo test` 为准）
- **前端纯函数也可以有单测**（vitest，当前 48 通过）：
  - 纯函数必须放在**不含 `@/` 导入**的文件里（vitest 解析不了 `@` 别名）——参考 `modules/quota/pricing.ts`、`modules/clipboard/date-group.ts`
  - **内容含 JSX 的文件即使纯函数也要 `.tsx` 后缀**——参考 `modules/search/search-utils.tsx`
  - 校验：`npx vitest run`、`npx tsc --noEmit`、`npm run build`

## 3. 配置管理标准（新模块必须遵守）

模块设置的前后端机制已全项目统一为一份，**新模块直接踩在地基上**：

### 3.1 三件套写法

```
src/modules/foo/config.ts      # ① 配置类型 + 默认值
src/modules/foo/Page.tsx       # ② 一行接入 Hook
src/modules/foo/Settings.tsx   # ③ 纯受控展示组件
```

```tsx
// ① config.ts —— state 字段用 camelCase；存储键由 Hook 自动转 snake_case
export interface FooConfig { viewMode: "grid" | "list"; gridSize: number; }
export const FOO_DEFAULTS: FooConfig = { viewMode: "grid", gridSize: 64 };

// ② Page.tsx —— 读取、保存、focus 重读、键名映射全部内置
const { cfg, update } = useModuleConfig("foo", FOO_DEFAULTS);
update({ gridSize: 80 });   // 即改即落盘（400ms 防抖），无需任何 invoke

// ③ Settings.tsx —— 受控契约，禁止自持状态副本、禁止自行 invoke
<FooSettings cfg={cfg} onUpdate={update} />
function FooSettings({ cfg, onUpdate }: { cfg: FooConfig; onUpdate: (p: Partial<FooConfig>) => void }) { ... }
```

参考模板：`emoji/config.ts` + `emoji/Settings.tsx`、`search/SearchSettings.tsx`。

### 3.2 内建行为（Hook 已处理，勿重复实现）

- camelCase（前端）↔ snake_case（config.json）**双向映射**——曾因手写映射不一致导致设置整页静默失败，已机制化杜绝
- 缺失字段回落 defaults；窗口 focus 防抖重读 + 卸载时补写未落盘的 patch
- 后端 `set_module_config` 保存后自动 `reapply_hotkeys`（热键变更即时生效）

### 3.3 控件提交时机

- **Slider 用 `onValueChange` 直连 `onUpdate`**——Hook 内置 400ms 防抖合并写盘
- Switch / Select / 按钮组：即时生效直连
- 唯一例外：需要二次确认流程的才用 `onValueCommit`（如剪贴板「历史上限」缩小弹确认）

### 3.4 例外规则（允许专用命令的场景）

判断标准：**纯「写 JSON 并落盘」→ 走统一机制；写入之外还有动作 → 才写专用命令**。现有例外：clipboard `set_hotkey`（注册验证）/`set_max_items`（清理确认）；quota `save_settings`（保存后重评告警）等。

## 4. 数据与配置规范

- 配置读写只用 `config.rs` 两助手 + 前端 `useModuleConfig`（见上）；Rust 侧 `module_cfg(app, "<id>")` 读、`update_module(app, "<id>", |v| ...)?` 写（内置加锁/落盘）
- **操作反馈**：用户触发的命令失败必须 toast/内联提示，不得静默吞掉；成功无可见变化也补 toast
- **文件图标/缩略图**：唯一入口为共享命令 `get_file_icon`/`get_file_thumb` + 前端 `useFileIcons`，禁止再造
- 模块私有数据：`app_data_dir()` 下；**时间序列数据统一落 SQLite**（`quota.db` 的 `balance_history`/`go_snapshots`/`go_cycles` 等）：
  - 追加类表注意防膨胀：余额同值去重只刷时间戳（`append_balance`）、快照「使用未变不写行」（`persist_go`）+ 按账户 `prune`（5000/20000 条）
  - 轮询热路径统计用 SQL 聚合（`spend_stats` 的 LAG 窗口），不每轮全量 load+遍历
  - 旧 `balance_history_<id>.json` 为历史遗留（启动幂等导入 SQLite 后不再新增）
- 密钥：`keyring::Entry::new("com.aliboder.easytool", <用户标识>)`；**多账户每账户独立槽位**（参考 quota 的 `key_ref` + `migrate_account_keyrefs` 幂等迁移）
- 配置迁移/旧数据导入：写 `src-tauri/src/migrate.rs`（一次性，`config.migrated` 标记）
- 条目顺序持久化：DB 加排序列 + `ORDER BY col IS NULL, col ASC` + `set_xxx_order(ids)` 命令（剪贴板 `pin_order`、quota `save_account_order`）
- 多账户/多实例类模块参考 quota 的「registry 驱动」：供应商/账户类型元数据集中一张注册表（`modules/quota/registry.tsx`），新类型加一条元数据即可自动长出卡片

## 5. 网格实现标准

涉及格子网格的模块（search/emoji/clipboard）遵守：
1. 真 CSS Grid（`grid gap-2` + `gridTemplateColumns: repeat(auto-fill, Npx)`），**不用 flex-wrap 模拟网格**
2. 内容缩放公式从 `src/lib/grid.ts` 引用（`gridIconSize`/`gridFontScale`），不手写魔法数字
3. 键盘 ↑↓ 跨行步进用 `gridColumns(el)` 实测列数
4. gap 统一 8px；键盘导航/批渲染/分页按各自数据规模选择

## 6. 面板头标准（ModuleHeader，新模块必须遵守）

所有模块顶栏一律 `src/components/module-header.tsx` 渲染，**禁止手写两行式头部**：

```tsx
<ModuleHeader
  search={{ value, onChange, placeholder, autoFocus }}  // 第一行：无边框输入框（无搜索框用 title/meta 占位）
  actions={/* 第一行右端按钮组，设置齿轮必须是最后一个 */ }
  tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} // 第二行 Tab（放不下自动换行）
  activeTab={tab}
  onTabChange={setTab}
  tabsTrailing={<HeaderSort … />}                        // 第二行右端次要控件（可选）
/>
```

参考实现：`search/SearchView.tsx`（全功能参照）。

## 7. 关键坑（新增模块时必须遵守）

> **最易翻车五条**：坑 1（PowerShell 写文件变 GBK 乱码）、坑 2（Mutex 重入死锁）、坑 7（keyring 缺 feature 直接 panic）、坑 20（invoke 参数 snake_case **静默失败**）、坑 21（App.tsx 接入漏 PAGE_IMPORTS/Sidebar 图标 → 页面不显示）。

1. **不要用 PowerShell 的 `Get-Content`/`Set-Content` 改写源码**（UTF-8 → GBK）。改文件一律用编辑器工具
2. **std Mutex 不可重入**：持锁期间绝不调用会再次取锁的函数（`module_cfg`、`fetch_once` 等）；先释放锁，耗时/网络操作放 `spawn_blocking`
3. **同步网络请求必须后台线程**（IPC 命令主路径禁止）
4. **Windows 不要给窗口开 `.transparent(true)`**（hide 后 show 崩溃 0xcfffffff）
5. **热键匹配**：`Shortcut::from_str(&cfg).map(|s| s == *shortcut)` 对象比较，不用 `to_string()` 字符串（格式为 `shift+control+keya`）
6. **独立弹窗已移除**：不新增前端入口/Rust 建窗/capabilities windows 声明
7. **keyring 必须 `features = ["windows-native"]`**，否则 `Entry::new().unwrap()` 直接 panic
8. 新增模块后跑 `codegraph init` 重建索引（本机不可用时靠 grep/read 兜底）
9. **@dnd-kit 大卡片拖拽变形的根治方案（额度面板现行）**：变形根因是「网格单元被拉伸到行内最高卡片高度，而 Card 只有内容高度」→ 排序矩形比可见卡片高一截（幽灵空白）。方案：
   - 网格单元（SortableCard 包装层）**硬编码固定高度** `h-[12.5rem]`（rem 随界面缩放等比，90-120% 下都成立）
   - Card `h-full` 撑满单元 + `overflow-hidden` 兜底截断，内容再多不撑破行高
   - `rectSortingStrategy` + PointerSensor 距离阈值 5 防误触；拖拽中禁文字选中（select-none）
   - 小尺寸条目（剪贴板固定板块）拖拽安全，无需此方案
10. **ResizeObserver 绑异步挂载节点用回调 ref**（空依赖 useEffect 只跑一次，节点未渲染绑不上）
11. **横向滚动**滚轮→`scrollLeft` 用共享 `useHorizontalWheel`；`overflow-x-auto` 会把 overflow-y 也变 auto，悬浮元素别放滚动容器顶部
12. **热键录制格式**：`Ctrl/Shift/Alt/Super`（Windows 键是 **Super** 不是 Win）+ 键名；用共享 `HotkeyRecorder`
13. **版本号三处同步**：`package.json` / `tauri.conf.json` / `src-tauri/Cargo.toml`（+ `Cargo.lock` 由 cargo check 同步）；Tauri CLI 不支持 portable（仅 msi/nsis）
14. **Windows 文件图标**：`SHGFI_USEFILEATTRIBUTES` 取不到格式专属图标，须访问真实文件再回退；缓存按路径不按扩展名
15. **多账户密钥槽位必须独立**（`quota-<id>`），绝不复用/回退旧槽位，防串号
16. **窗口尺寸记忆过滤脏数据**：隐藏/最小化时 WebView2 报 0x0，保存/恢复都要校验最小尺寸（<400x300）与离屏坐标（<-32000）
17. （弹窗体系历史教训，仅存档）`.visible(false)` 在 Windows WebView2 仍会闪现
18. **窗口入场动画**用共享 `useWindowEntrance`，不要重挂载根节点
19. **SQLite 建索引放在列添加之后**（版本迁移中加的列，索引创建放迁移后，否则新库建表失败）
20. **Tauri v2 invoke 参数 JS 侧必须 camelCase**：Rust 参数 `follow_mouse` ↔ JS `followMouse`；用 snake_case 键名会反序列化失败且**静默无报错**（emoji 曾因此所有设置存不上）。配置读写走 useModuleConfig 天然避开；手写 invoke 其他命令务必注意
21. **App.tsx 接入四处缺一不可**：lazy 分包、`PAGE_IMPORTS` entry、renderModules 挂载块、Sidebar `ICONS` 图标映射。漏 PAGE_IMPORTS → 启动预载/恢复上次模块失效；漏 ICONS → 导航回退默认图标
22. **启用状态由 manifest + config 驱动**：模块启用状态一律读 `config.modules.<id>.enabled`（设置页开关/排序落盘），前端不要硬编码模块列表或另起一套开关状态
23. **UTC 与本地时间口径统一**：时间字符串一律本地时间生成（`chrono::Local::now()`）生成后入库存取/查询同口径；跨时区统计按 `date(time/1000,'unixepoch','localtime')` 切桶，混用会跨日错账

## 8. 完成清单

新增模块后逐项自检：

- [ ] manifest.json 字段齐全（id/name/icon/description?/enabled/default_config）
- [ ] `modules/mod.rs` 已 `pub mod foo`；lib.rs 并行初始化 + enabled 助手 + invoke_handler 已注册
- [ ] App.tsx 四处接入齐（lazy + PAGE_IMPORTS + renderModules + Sidebar ICONS）
- [ ] 配置读写走 `useModuleConfig` + `module_cfg/update_module`；无自建 module_config 副本、无持锁嵌套
- [ ] 纯配置保存未写专用命令（例外仅限带副作用的设置）
- [ ] 用户操作有反馈（失败 toast，成功无变化补 toast）
- [ ] 图标/缩略图经 useFileIcons；面板头用 ModuleHeader（齿轮最后）
- [ ] 时间序列数据落 SQLite + 防膨胀（去重/未变不写/prune）；统计走 SQL 聚合
- [ ] 密钥走 keyring 独立槽位；网络在后台线程；热键/滚轮/入场动画复用共享组件
- [ ] 大卡片拖拽用固定高度单元方案（坑 9）；需要的话补 vitest 纯函数单测（无 `@/` 导入、JSX 用 .tsx）
- [ ] `cargo test` 全绿、`cargo build` 零警告、`npx tsc --noEmit`、`npx vitest run`、`npm run build` 全过
- [ ] 手动验收清单已给用户（启动命令 + 验证点）；`codegraph init` 重建索引后提交

## 9. 参考实现

- **search** `SearchView.tsx`：面板头全功能参照（search + searchTrailing + actions + 图标 tabs + HeaderSort）；`search-utils.tsx` 是「含 JSX 的纯函数文件也可 vitest」的样例
- **clipboard**：系统监听 + 文件存储 + 固定板块小条目拖拽 + 跟手粘贴（隐藏主窗口注入）；`date-group.ts` 是「无依赖纯函数被 vitest」的样例
- **quota**：后台轮询线程 + **多账户 registry 驱动**（8+ 供应商，卡片形态注册表）+ 定时任务/告警 + SQLite 时间序列 + 卡片统一等高拖拽排序（坑 9 方案）+ 峰谷纯函数 `pricing.ts` 双端实现（Rust + TS 各一套单测）——**后台任务 / 数据可视化 / 多实例 / 统一等高卡片 类模块的首选参照**
- **timetracker**：SetWinEventHook 事件采集 + 心跳线程 + 跨天会话分桶 + 分类规则——系统事件/会话类模块参照；`db_stats.rs` 是「大 db.rs 拆分」样例
- **calendar**：RRULE 重复规则「存一条规则 + 按需展开」的纯函数（Rust + TS 双实现双单测同一批用例）、ICS 导入导出（现成 crate，不重复造轮子）、常驻提醒线程 + 外部订阅定时刷新、`event_overrides` 例外表——**规则存储 / 导入导出 / 提醒线程 类模块的首选参照**
- **emoji**：`config.ts` + `useModuleConfig` + 受控 Settings 的配置标准参照