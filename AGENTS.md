# EasyTool 工具箱 — AI Agent 指南

Windows 桌面工具箱（Tauri 2 + React + TypeScript），**单应用 + 模块注册表**架构：每个功能是一个「模块」，设置页可独立启停/配置，扩展新功能只需新增模块目录 + manifest。

> **文档导航**：开发前按需阅读——
> - `docs/module-guide.md`：**新增模块完整指南**（步骤/规范/坑清单）
> - `docs/lessons.md`：**踩坑经验 + 易踩坑速查表**（改代码前必读）
> - `docs/website-guide.md`：**官网维护指南**（更新功能/版本时必读）
> - `docs/deploy-guide.md`：**Vite+React+GitHub Pages 部署指南**（新项目部署参考）
> - `docs/superpowers/specs/`：功能设计文档

## 当前模块

- `clipboard` 剪贴板：监听系统剪贴板，记录文本/图片/文件，固定/拖拽排序/搜索/跟手粘贴；独立弹窗（延迟创建）
- `quota` 额度监控：DeepSeek / OpenCode Go **多账户**，各账户独立密钥/余额/消费历史/告警；后台轮询
- `emoji` 表情面板：1900+ 表情分类检索，中文/英文/shortcode 搜索，收藏置顶，SendInput 直输；独立弹窗
- `search` 文件搜索：Everything 全文搜索（**需用户安装 Everything**），Everything64.dll 随应用打包；独立弹窗 + 模块页双入口。第一个「应用」Tab = **已安装应用中心**（扫描开始菜单，点击即启动，前台频率排序），搜索时匹配应用置顶显示

## 技术栈

后端 Tauri 2 + Rust（rusqlite / keyring / reqwest / chrono）；前端 React 19 + TS + Tailwind v4 + shadcn/ui + lucide-react + @dnd-kit；构建 Vite（`mpa` 多 HTML 入口）

## 官网

- **线上**：https://aliboder.github.io/EasyTool/
- **源码**：`website/` 目录（独立 Vite + React 工程）
- **部署**：push 到 master → GitHub Actions 自动构建发布
- **维护**：详见 `docs/website-guide.md`

## 目录结构

```
src-tauri/src/
├── lib.rs         # 壳：托盘、全局热键、窗口事件、模块 setup、日志
├── config.rs      # AppConfig + ConfigState(Mutex)、config 读写命令
├── migrate.rs     # 旧数据一次性迁移
└── modules/       # 模块注册表 mod.rs + clipboard/ + quota/ + emoji/ + search/
src-tauri/modules/  # 模块 manifest.json 目录
src/
├── App.tsx        # 壳 UI：底部导航 + 模块页 + 设置页
├── lib/           # api(ipc封装)/theme/use-horizontal-wheel/use-window-entrance/context-menu
├── components/    # ui 组件 + hotkey-recorder + LazyImage + context-menu
├── clipboard_popup.tsx   # 剪贴板弹窗入口（延迟创建）
├── └── modules/       # clipboard/ + quota/ + emoji/ + search/ 前端
website/           # 官网（独立工程，详见 docs/website-guide.md）
```

## 关键机制

### 窗口
- `main` 主窗口：关闭=隐藏到托盘；`unified_hotkey` 开启时按「面板」工作（点外部关闭/热键切换/置顶/跳过任务栏/可选跟随鼠标）
- `clipboard_popup` 剪贴板弹窗：跟随鼠标或固定位置，失焦自动隐藏；**延迟创建**（首次呼出才建窗，避免启动闪现）
- `emoji_popup` 表情弹窗：复用剪贴板弹窗模式（跟随鼠标/失焦隐藏/延迟创建）
- `search_popup` 文件搜索弹窗：复用剪贴板弹窗模式，Everything64.dll 动态加载
- **坑**：Windows 下透明窗口（`.transparent(true)`）hide 后再 show 会崩溃，已放弃透明方案

### 全局热键与统一呼出
- `unified_hotkey=true`（默认）：只注册主窗口热键（默认 Ctrl+Shift+E），各模块独立热键禁用；关闭则反之
- **热键匹配必须用 `Shortcut::from_str(&cfg).map(|s| s == *shortcut)` 对象比较**
- 录制格式：`Ctrl/Shift/Alt/Super + 键名`（Windows 键用 **Super** 不是 Win），见 `HotkeyRecorder`
- 默认热键：主面板 Ctrl+Shift+E / 剪贴板 Ctrl+Shift+V / 表情 Ctrl+Shift+J / 搜索 Ctrl+Shift+F

### 配置与数据
- 数据目录 `%APPDATA%\com.aliboder.easytool\`：`config.json`、`clipboard.db`（SQLite WAL，含 `pin_order` 列）、`apps.db`（已安装应用频率计数）、`images/`、`thumbs/`
- 额度历史按账户分文件 `balance_history_<account_id>.json`
- 密钥存 keyring（service `com.aliboder.easytool`），**每账户独立槽位**；新账户绝不回退旧槽位
- search 模块：`Everything64.dll` 打包在 `src-tauri/modules/search/`；查询须持全局互斥锁且放后台线程
- search 模块：`apps.db` 存储已安装应用的使用频率（前台事件钩子累计）；`quicklaunch.db` 为已退役模块的历史遗留文件

### 额度轮询（多账户）
- `poll_loop` 后台线程按 `refresh_interval_sec`（≥5s）调 `fetch_once`
- API：DeepSeek `GET /user/balance`；OpenCode Go `GET /zen/go/v1/usage`（camelCase 需 serde rename）
- 账户命令：`add_account` / `remove_account` / `rename_account` / `set_account_key`

### 剪贴板要点
- 监听：事件驱动（WM_CLIPBOARDUPDATE）+ 500ms 轮询兜底；按 hash 去重
- 固定条目排序：`items.pin_order`（NULL=未排过序排最后）

### 表情面板要点
- 数据源：`emoji-datasource` npm 包生成 `emoji.json`（~234KB），含 1911 条
- 检测：系统字体优先 → canvas 像素检测 → Twemoji CDN 兜底
- 直输：文本表情 SendInput 直接输入（不写剪贴板）；图片表情 write+Ctrl+V

### 迁移
- `migrate::run_migration` 启动自动执行一次，结果写 `config.migrated` 标记（幂等）
- 剪贴板：PasteBoard 库按 hash 导入；余额：QuotaMonitor 记录按时间合并去重

## 开发命令

```bash
npm run tauri dev      # 开发（需保持 localhost:14200 空闲）
npm run tauri build    # 打包（产物 src-tauri/target/release/bundle/nsis/）
cargo test             # Rust 测试（在 src-tauri/ 下）
npx tsc --noEmit       # 前端类型检查
```

- 打包只支持 `msi/nsis`（**不支持 portable**）
- 后端 51 个单元测试；前端无测试框架，验证靠人工

## 发版流程（AI 代发版时必须按此执行）

发版由 GitHub Actions 自动构建+签名+发布，**不要手动 build 和上传**。步骤：

1. **三处版本号同步**（必须同时改，漏一个会导致构建失败或版本不一致）：
   - `package.json` → `"version": "x.y.z"`
   - `src-tauri/tauri.conf.json` → `"version": "x.y.z"`
   - `src-tauri/Cargo.toml` → `version = "x.y.z"`

2. **提交并打 tag**：
   ```bash
   git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
   git commit -m "release: vX.Y.Z"
   git tag vX.Y.Z
   git push --tags
   ```

3. **GitHub Actions 自动执行**：推送 `v*` tag 后，`.github/workflows/release.yml` 自动在 Windows 环境构建 NSIS 安装包 → 用 `TAURI_SIGNING_PRIVATE_KEY`（GitHub Secret）签名 → 创建 GitHub Release 并附带 `.nsis.exe`。

4. **用户端更新**：用户打开 EasyTool → 设置页点「检查更新」（或启动时自动横幅提示）→ 下载签名安装包 → 重启完成更新。

**注意事项**：
- 签名私钥存在 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`，**绝不提交到代码仓库**（已在 .gitignore）
- 构建产物路径：`src-tauri/target/release/bundle/nsis/*.nsis.exe`
- 如需本地构建测试：`$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "src-tauri/updater.key"; npm run tauri build`

## 代码查询规则（必须遵守）

- 项目已初始化 CodeGraph（`.codegraph/`）：**所有查代码一律先用 `codegraph_explore`，禁止先 grep/Read**
- 新增/改动大量代码后 `codegraph init` 重建索引
- 新增功能模块时先读 `docs/module-guide.md`
- 更新官网时先读 `docs/website-guide.md`

## AI 行为准则

1. **先调研再动手**：更新功能前先搜索业界成熟方案（GitHub/文档/社区），不要从零造轮子；有现成方案直接参考，没有再自研
2. **协作流程**：收到需求后 → 了解代码现状并说明理解 → 给出方案选项 → 等用户审查同意 → 才可修改代码
3. **想清楚再写**：有歧义或多种理解时摆出来问；有更简单的做法就直接说
4. **简单优先**：最小代码解决当前问题；不做投机扩展
5. **外科手术式修改**：只动必须改的代码；清理自己制造的死代码
6. **目标驱动**：把任务转成可验证目标；多步骤任务先列计划

## 协作约定（本项目用户）

- 用户不写代码、不验代码、不用 git：代码由 AI 完成，编译/测试通过后**只告诉用户启动命令和手动验收清单**，用户亲自验证通过才算完成
- git 提交由 AI 主动做；提交前 `git status`/`git diff` 检查，只提交相关文件
- 大改动先汇报方案与改动范围，用户同意后实施
- **每次修复 bug 或解决技术问题后，必须将经验教训记录到 `docs/lessons.md`**
- 每次回答用户消息结束时，**单独一行**输出标签：`Aliboder`
