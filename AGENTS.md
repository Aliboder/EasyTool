# EasyTool 工具箱 — AI Agent 指南

本文件帮助 AI Agent 快速理解 EasyTool 的架构、约定和踩坑记录，避免重复探索。开发前必读。

## 项目概览

Windows 桌面工具箱（Tauri 2 + React + TypeScript），单应用 + 模块注册表架构：每个功能是一个「模块」，可在设置页独立启停/配置，扩展新功能只需新增一个模块目录 + manifest。

当前模块：
- `clipboard` 剪贴板（从 PasteBoard 项目移植的 Rust 核心 + 全新前端）
- `quota` 额度监控（从 C# QuotaMonitor 重写，支持多账户：DeepSeek/OpenCode Go 各可配多个账户，独立密钥/余额/历史）

## 技术栈

- 后端：Tauri 2 + Rust（rusqlite、keyring、reqwest、chrono、tauri-plugin-global-shortcut / single-instance / notification / autostart / opener）
- 前端：React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui + lucide-react + @dnd-kit（拖拽排序）
- 构建：Vite（`appType: "mpa"`，多 HTML 入口）、`@tauri-apps/cli`

## 目录结构

```
src-tauri/
├── src/
│   ├── lib.rs            # 壳程序：托盘、全局热键、窗口事件、模块 setup、SimpleLogger、log_frontend 命令
│   ├── config.rs         # AppConfig + ConfigState(Mutex)；含 set_* / save_* 命令
│   ├── migrate.rs        # 旧数据一次性迁移（PasteBoard 库、QuotaMonitor 余额记录）
│   └── modules/
│       ├── mod.rs        # 模块注册表：Manifest 读取（resources）、merge_manifests、get_manifests
│       ├── clipboard/    # 剪贴板：db/monitor/paste/dedup/store/models/state/file_icons/commands
│       └── quota/        # 额度监控：api/alerts/history/commands/mod（多账户：QuotaState 账户数组 + poll_loop 轮询线程）
├── modules/              # 各模块 manifest.json（打包为 resources，嵌入 exe）
├── capabilities/default.json  # 窗口与权限声明
└── tauri.conf.json
src/
├── App.tsx               # 壳 UI：底部导航栏 + 模块页 + 设置页 + 迁移提示条
├── lib/api.ts            # invoke 封装
├── lib/theme.ts          # applyTheme（多窗口共享）
├── lib/use-horizontal-wheel.ts  # 滚轮→横向滚动 hook（剪贴板/消费历史共用）
├── lib/use-window-entrance.ts   # 窗口呼出入场动画（失焦置透明+聚焦重放，避免闪烁）
├── components/hotkey-recorder.tsx  # 热键录制组件（剪贴板与主窗口热键共用）
├── components/LazyImage.tsx      # 懒加载图片（IntersectionObserver）
├── clipboard_popup.tsx   # 剪贴板弹窗入口（延迟创建：首次呼出才建窗）
└── modules/              # clipboard/ 和 quota/ 前端组件
```

## 关键机制

### 窗口（两个，均在 Rust 侧动态创建/定义）
- `main`：主窗口（tauri.conf.json 定义），关闭 = 隐藏到托盘；统一呼出模式下可「点击外部关闭 / 热键切换 / 置顶 / 跳过任务栏」
- `clipboard_popup`：剪贴板弹窗，跟随鼠标或固定位置，失焦自动隐藏，按热键呼出

**坑**：Windows 下 `.transparent(true)` 的 WebView2 窗口在 hide 后再 show 会崩溃（0xcfffffff），已放弃透明方案。

### 全局热键与统一呼出
- `config.unified_hotkey`（默认 true）：
  - 开启：只注册主窗口热键（默认 Ctrl+Shift+E），模块独立热键禁用；主窗口按「面板」行为（点击外部关闭、热键切换、置顶、跳过任务栏、可选跟随鼠标）
  - 关闭：只注册各模块独立热键，主窗口热键失效（改由托盘呼出）
- 热键匹配坑：`shortcut.to_string()` 输出为 `shift+control+keya` 格式，与配置字符串不匹配。必须用 `Shortcut::from_str(&cfg).map(|s| s == *shortcut)` 做对象比较（见 lib.rs handler）
- 重新注册：改热键/unified 后调用 `reapply_hotkeys(app)`
- 热键录制：global-hotkey crate 解析格式为 `Ctrl/Shift/Alt/Super`（Windows 键用 **Super**，不是 Win）+ 键名（`A-Z / 0-9 / F1-F24 / ArrowUp / Enter / Space` 等），见 `HotkeyRecorder`

### 配置与数据
- 目录：`%APPDATA%\com.aliboder.easytool\`（`app_data_dir()`）
- `config.json`：`{modules, hotkeys, theme, migrated, unified_hotkey, main_size, main_follow_mouse}`；模块配置为 `HashMap<String, Value>`
- `clipboard.db`（SQLite，WAL 模式）含 `pin_order` 列（schema v2，固定条目手动排序）、`images/`、`thumbs/`
- 额度历史按账户分文件：`balance_history_<account_id>.json`（`{"records":[{time,balance}]}`，ISO 时间）；旧单文件 `balance_history.json` 已迁移为默认 deepseek 账户
- 密钥存 Windows Credential Manager（keyring，service `com.aliboder.easytool`）。**每个账户独立槽位**：默认账户 `deepseek` / `opencode-go`，新增账户 `quota-<account_id>`（key_ref 字段）；账户无 key_ref 时回退到旧槽位（仅历史数据，新账户绝不回退）

### API
- DeepSeek：`GET https://api.deepseek.com/user/balance`，Bearer 鉴权，取 `balance_infos` 中 CNY `total_balance`
- OpenCode Go：`GET https://opencode.ai/zen/go/v1/usage`（JSON 字段 camelCase 需 serde rename），usage 的 percent 是 0~100 直用，其他是 0~1 需 ×100；未配 key 时读取本机 `~/.local/share/opencode/auth.json`

### 额度轮询（多账户）
- `poll_loop` 后台线程按 `refresh_interval_sec`（最小 5s）调 `fetch_once`：遍历所有账户（`account_configs`）逐账户查询 → 更新 `QuotaState.accounts` → 逐账户告警（阈值统一、消费突增每日一次）→ 逐账户追加历史 → emit `quota://updated`
- 前端 `get_status`（返回账户数组）/ `get_stats_data(account_id)` / `get_daily_history(account_id)`（统计按账户）
- 账户增删改：`add_account(kind,name)` / `remove_account(id)` / `rename_account(id,name)` / `set_account_key(id,key)`
- 消费历史：完整时间线用 `history::daily_series_all`（最早记录日→今天），前端横向滚动查看

### 固定条目排序
- DB `items.pin_order`（INTEGER，NULL = 未排过序，按时间倒序排最后）
- 固定 Tab 查询按 `pin_order IS NULL, pin_order ASC, created_at DESC` 排序
- 拖拽排序：前端按区（图片/文件/文本）用 @dnd-kit 重排后调 `set_pin_order(ids)` 持久化整组顺序

### 迁移
- `migrate::run_migration` 在 setup 启动时自动执行一次，结果写 `config.migrated` 标记
- 剪贴板：读 `%APPDATA%\com.aliboder.pasteboard\pasteboard.db`（先复制 db+wal+shm 到 temp 避免锁原库），按 hash `INSERT OR IGNORE`，图片文件搬到新 images/thumbs
- 余额：读 `Documents\QuotaMonitor\余额记录.json`（`{records:[{time,balance}]}`，time 可能是 .NET `/Date(ms)/` 格式），按时间合并去重

## 开发命令

```bash
npm run tauri dev      # 开发（需保持 http://localhost:1420 端口空闲）
npm run tauri build    # 打包（产物在 src-tauri/target/release/bundle/nsis/）
cargo test             # Rust 测试（在 src-tauri/ 下执行）
npx tsc --noEmit       # 前端类型检查
```

**注意**：当前 Tauri CLI 只支持 `msi/nsis` 打包目标，**不支持 portable**。发版流程：改版本号（三处同步）→ build → git tag → `gh release create`。

## 测试

- 后端 36 个单元测试（clipboard / quota / 迁移 / 图标探针），纯逻辑测试无 GUI 依赖（file_icons 的 probe_icons 除外，依赖真实 Shell 图标）
- 前端无测试框架；验证依赖人工

## 已知坑与约束

1. **PowerShell 读写文件编码**：`Get-Content`/`Set-Content` 会把 UTF-8 文件写成 GBK，曾损坏 Rust 源码。改文件一律用编辑器工具，不要用 PowerShell 重写
2. **std Mutex 不可重入**：曾因 `save_settings` 持 ConfigState 锁后调 `fetch_once`（内部再拿同锁）死锁导致应用无响应。新增代码注意：**持锁期间绝不调用会再次取锁的函数**；网络操作放 `spawn_blocking`
3. **同步网络请求**：`fetch_once` 是同步 reqwest，必须在后台线程执行，禁止在 IPC 命令主路径直接调用
4. **透明窗口崩溃**：见上文窗口节
5. **新增前端入口**：需同时改 `vite.config.ts` 的 `rollupOptions.input`、根目录新建 `.html`、Rust 侧建窗口（`WebviewUrl::App("xxx.html")`）、`capabilities/default.json` 的 `windows` 数组和所需权限
6. 模块 manifest 走 `resources`（打包后嵌入 exe），dev 模式 fallback 到 `src-tauri/modules` 相对路径
7. `keyring` 必须启用 `features = ["windows-native"]`，否则 Windows 上 `Entry::new().unwrap()` 直接 panic
8. **@dnd-kit 拖拽 + WebView2 渲染变形**：**大尺寸卡片 + opacity + transform 组合会让窗口形状变形**（压扁）。不要给被拖的大卡片加透明度；DragOverlay 方案也会出问题；额度面板用 `verticalListSortingStrategy` + `will-change: transform` + 拖动中禁 transition。**小尺寸条目（剪贴板固定板块）拖拽安全**
9. **ResizeObserver 绑定异步挂载节点要用回调 ref**：空依赖 `useEffect` 只在组件挂载时跑一次，若目标节点是异步渲染的（如数据加载后），观察器绑不上。用 `useCallback` 回调 ref（React 19 支持 ref 清理）
10. **横向滚动**：滚轮→`scrollLeft` 用共享 `useHorizontalWheel`（callback ref，返回 `{ ref, nodeRef }`）；注意 `overflow-x-auto` 会把 `overflow-y` 也变 auto，悬浮元素别放超出滚动容器顶部
11. **版本号三处同步**：改版本需同时改 `package.json`、`tauri.conf.json`、`src-tauri/Cargo.toml`
12. **Windows 文件图标**：`SHGFI_USEFILEATTRIBUTES` 取不到格式专属图标（txt/图片等都退化为通用图标），必须访问真实文件（`SHGetFileInfoW` 不带该 flag）再回退；按扩展名缓存会污染同扩展名所有文件，按路径缓存
13. **多账户密钥槽位必须独立**：quota 新增账户 `key_ref` 分配独立槽位（`quota-<id>`），**绝不复用/回退旧槽位**（否则所有同类账户串号共用同一密钥）。旧账户迁移用 `migrate_account_keyrefs`（启动时把 key_ref 为空的账户迁到独立槽位，幂等）
14. **窗口尺寸记忆要过滤脏数据**：窗口隐藏/最小化时 WebView2 报 0x0，`onResized`/`save_main_size`/setup 恢复都必须校验最小尺寸（<400x300 忽略），否则窗口启动后极小。`minWidth/minHeight` 只约束用户拖拽，编程 `set_size` 不受限
15. **独立窗口延迟创建**：不要在 setup 中创建隐藏弹窗（`.visible(false)` 在 Windows WebView2 上仍会闪现），改为首次呼出时才建窗（见 `clipboard::ensure_popup_window`）
16. **窗口入场动画**：用共享 `useWindowEntrance`（失焦时内容置透明、聚焦时重放动画），避免「先显示完整界面再补动画」的闪烁；不要用重挂载根节点方式触发（会丢子组件状态）

## 代码查询规则（必须遵守）

- 本项目已初始化 CodeGraph（`.codegraph/`）。**所有查代码的操作——定位符号、理解逻辑、找调用方、了解影响范围——一律先用 `codegraph_explore`，禁止先 grep/find/Read**。一次调用即可返回符号源码 + 调用链 + 影响范围，比搜索循环更准更省。
- 查询需传 `projectPath`（如 `D:\SystemFiles\Documents\Project\EasyTool`），或直接在本项目会话中省略。
- 新增/改动大量代码后，用 `codegraph init`（在项目根目录）重建索引，保持索引与磁盘一致。
- 找不到结果时再退回 grep/Glob/Read 兜底。

## 新增模块

- **新增功能模块时，先读 `docs/module-guide.md`（新增模块开发指南）**，按其中的步骤、规范与坑清单实施，可参考 clipboard / quota 两个现成模块

## 协作约定（本项目用户）

- 用户不写代码、不验代码、不用 git：代码由 AI 完成，编译/测试通过后**只告诉用户启动命令和手动验收清单**，用户亲自验证通过才算完成
- git 提交由 AI 主动做；提交前 `git status`/`git diff` 检查，只提交相关文件
- 大改动先汇报方案与改动范围，用户同意后实施
- **每次修复 bug 或解决技术问题后，必须将经验教训记录到 `docs/lessons.md`**，包括：问题描述、根本原因、解决方案、教训总结、相关代码位置
- 每次回答用户消息结束时，**单独一行**输出标签：`Aliboder`
