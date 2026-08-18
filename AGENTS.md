# EasyTool 工具箱 — AI Agent 指南

本文件帮助 AI Agent 快速理解 EasyTool 的架构、约定和踩坑记录，避免重复探索。开发前必读。

## 项目概览

Windows 桌面工具箱（Tauri 2 + React + TypeScript），单应用 + 模块注册表架构：每个功能是一个「模块」，可在设置页独立启停/配置，扩展新功能只需新增一个模块目录 + manifest。

当前模块：
- `clipboard` 剪贴板（从 PasteBoard 项目移植的 Rust 核心 + 全新前端）
- `quota` 额度监控（从 C# QuotaMonitor 重写）

## 技术栈

- 后端：Tauri 2 + Rust（rusqlite、keyring、reqwest、chrono、tauri-plugin-global-shortcut / single-instance / notification / autostart / opener）
- 前端：React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui + lucide-react
- 构建：Vite（`appType: "mpa"`，多 HTML 入口）、`@tauri-apps/cli`

## 目录结构

```
src-tauri/
├── src/
│   ├── lib.rs            # 壳程序：托盘、全局热键、窗口事件、模块 setup、SimpleLogger、log_frontend 命令
│   ├── config.rs         # AppConfig（modules/hotkeys/theme/migrated/unified_hotkey）+ ConfigState(Mutex)
│   ├── migrate.rs        # 旧数据一次性迁移（PasteBoard 库、QuotaMonitor 余额记录）
│   └── modules/
│       ├── mod.rs        # 模块注册表：Manifest 读取（resources）、merge_manifests、get_manifests
│       ├── clipboard/    # 剪贴板：db/monitor/paste/dedup/store/models/state/file_icons/commands
│       └── quota/        # 额度监控：api/alerts/history/commands/mod（QuotaState + poll_loop 轮询线程）
├── modules/              # 各模块 manifest.json（打包为 resources，嵌入 exe）
├── capabilities/default.json  # 窗口与权限声明
└── tauri.conf.json
src/
├── App.tsx               # 壳 UI：侧边栏 + 模块页 + 设置页 + 迁移提示条
├── lib/api.ts            # invoke 封装
├── float_window.tsx / clipboard_popup.tsx  # 独立窗口入口
└── modules/              # clipboard/ 和 quota/ 前端组件
```

## 关键机制

### 窗口（三个，均在 Rust 侧动态创建）
- `main`：主窗口（tauri.conf.json 定义），关闭 = 隐藏到托盘
- `clipboard_popup`：剪贴板弹窗，跟随鼠标定位，失焦自动隐藏，按热键呼出
- `quota_float`：额度悬浮窗（220×80，decorations(false)），设置页开关显示/隐藏

**坑**：Windows 下 `.transparent(true)` 的 WebView2 窗口在 hide 后再 show 会崩溃（0xcfffffff），已放弃透明方案，悬浮窗用深色不透明背景。

### 全局热键与统一呼出
- `config.unified_hotkey`（默认 true）：开启时只注册主窗口热键（Ctrl+Shift+E），模块独立热键全部禁用；关闭时两者共存
- 热键匹配坑：`shortcut.to_string()` 输出为 `shift+control+keya` 格式，与配置字符串不匹配。必须用 `Shortcut::from_str(&cfg).map(|s| s == *shortcut)` 做对象比较（见 lib.rs handler）
- 重新注册：改热键/unified 后调用 `reapply_hotkeys(app)`

### 配置与数据
- 目录：`%APPDATA%\com.aliboder.easytool\`（`app_data_dir()`）
- `config.json`：`{modules, hotkeys, theme, migrated, unified_hotkey}`；模块配置为 `HashMap<String, Value>`
- `clipboard.db`（SQLite，WAL 模式）、`images/`、`thumbs/`、`balance_history.json`（`{"records":[{time,balance}]}`，ISO 时间）
- 密钥存 Windows Credential Manager（keyring，service `com.aliboder.easytool`，users `deepseek` / `opencode-go`），不落盘明文

### API
- DeepSeek：`GET https://api.deepseek.com/user/balance`，Bearer 鉴权，取 `balance_infos` 中 CNY `total_balance`
- OpenCode Go：`GET https://opencode.ai/zen/go/v1/usage`（JSON 字段 camelCase 需 serde rename），usage 的 percent 是 0~100 直用，其他是 0~1 需 ×100；未配 key 时读取本机 `~/.local/share/opencode/auth.json`

### 额度轮询
- `poll_loop` 后台线程按 `refresh_interval_sec`（最小 5s）调 `fetch_once`：查询余额 + Go 套餐 → 更新 `QuotaState` → 告警（阈值一次 + 消费突增每日一次）→ 追加历史 → emit `quota://updated`
- 前端 `get_status` / `get_stats_data` 轮询获取

### 迁移
- `migrate::run_migration` 在 setup 启动时自动执行一次，结果写 `config.migrated` 标记
- 剪贴板：读 `%APPDATA%\com.aliboder.pasteboard\pasteboard.db`（先复制 db+wal+shm 到 temp 避免锁原库），按 hash `INSERT OR IGNORE`，图片文件搬到新 images/thumbs
- 余额：读 `Documents\QuotaMonitor\余额记录.json`（`{records:[{time,balance}]}`，time 可能是 .NET `/Date(ms)/` 格式），按时间合并去重

## 开发命令

```bash
npm run tauri dev      # 开发（需保持 http://localhost:1420 端口空闲）
npm run tauri build    # 打包（产物在 src-tauri/target/release/bundle/nsis/ 与 portable/）
cargo test             # Rust 测试（在 src-tauri/ 下执行）
npx tsc --noEmit       # 前端类型检查
```

## 测试

- 后端 36 个单元测试（clipboard 24 + quota 10 + 迁移 2 + 其他），纯逻辑测试无 GUI 依赖
- 前端无测试框架；验证依赖人工

## 已知坑与约束

1. **PowerShell 读写文件编码**：`Get-Content`/`Set-Content` 会把 UTF-8 文件写成 GBK，曾损坏 Rust 源码。改文件一律用编辑器工具，不要用 PowerShell 重写
2. **std Mutex 不可重入**：曾因 `save_settings` 持 ConfigState 锁后调 `fetch_once`（内部再拿同锁）死锁导致应用无响应。新增代码注意：**持锁期间绝不调用会再次取锁的函数**；网络操作放 `spawn_blocking`
3. **同步网络请求**：`fetch_once` 是同步 reqwest，必须在后台线程执行，禁止在 IPC 命令主路径直接调用
4. **透明窗口崩溃**：见上文窗口节
5. **新增前端入口**：需同时改 `vite.config.ts` 的 `rollupOptions.input`、根目录新建 `.html`、Rust 侧建窗口（`WebviewUrl::App("xxx.html")`）、`capabilities/default.json` 的 `windows` 数组和所需权限
6. 模块 manifest 走 `resources`（打包后嵌入 exe），dev 模式 fallback 到 `src-tauri/modules` 相对路径
7. `keyring` 必须启用 `features = ["windows-native"]`，否则 Windows 上 `Entry::new().unwrap()` 直接 panic

## 代码查询规则（必须遵守）

- 本项目已初始化 CodeGraph（`.codegraph/`）。**所有查代码的操作——定位符号、理解逻辑、找调用方、了解影响范围——一律先用 `codegraph_explore`，禁止先 grep/find/Read**。一次调用即可返回符号源码 + 调用链 + 影响范围，比搜索循环更准更省。
- 查询需传 `projectPath`（如 `D:\SystemFiles\Documents\Project\EasyTool`），或直接在本项目会话中省略。
- 新增/改动大量代码后，用 `codegraph init`（在项目根目录）重建索引，保持索引与磁盘一致。
- 找不到结果时再退回 grep/Glob/Read 兜底。

## 协作约定（本项目用户）

- 用户不写代码、不验代码、不用 git：代码由 AI 完成，编译/测试通过后**只告诉用户启动命令和手动验收清单**，用户亲自验证通过才算完成
- git 提交由 AI 主动做；提交前 `git status`/`git diff` 检查，只提交相关文件
- 大改动先汇报方案与改动范围，用户同意后实施