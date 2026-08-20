# EasyTool 工具箱 — AI Agent 指南

Windows 桌面工具箱（Tauri 2 + React + TypeScript），**单应用 + 模块注册表**架构：每个功能是一个「模块」，设置页可独立启停/配置，扩展新功能只需新增模块目录 + manifest。

> **文档导航**：开发前按需阅读——
> - `docs/module-guide.md`：**新增模块完整指南**（步骤/规范/坑清单）
> - `docs/lessons.md`：**踩坑经验 + 易踩坑速查表**（改代码前必读）
> - `docs/superpowers/specs/`：功能设计文档；`docs/superpowers/plans/`：实现计划

## 当前模块

- `clipboard` 剪贴板：监听系统剪贴板，记录文本/图片/文件，固定/拖拽排序/搜索/跟手粘贴；独立弹窗（延迟创建）
- `quota` 额度监控：DeepSeek / OpenCode Go **多账户**，各账户独立密钥/余额/消费历史/告警；后台轮询
- `search` 文件搜索：Everything 全文搜索（**需用户安装 Everything**），Everything64.dll 随应用打包（MIT 许可）；独立弹窗 + 模块页双入口；结果列/排序可自定义；复制路径/文件联动写入剪贴板历史

## 技术栈

后端 Tauri 2 + Rust（rusqlite / keyring / reqwest / chrono）；前端 React 19 + TS + Tailwind v4 + shadcn/ui + lucide-react + @dnd-kit；构建 Vite（`mpa` 多 HTML 入口）

## 目录结构

```
src-tauri/src/
├── lib.rs         # 壳：托盘、全局热键、窗口事件、模块 setup、日志
├── config.rs      # AppConfig + ConfigState(Mutex)、config 读写命令
├── migrate.rs     # 旧数据一次性迁移
└── modules/       # 模块注册表 mod.rs + clipboard/ + quota/
src/
├── App.tsx        # 壳 UI：底部导航 + 模块页 + 设置页
├── lib/           # api(ipc封装)/theme/use-horizontal-wheel/use-window-entrance
├── components/    # ui 组件 + hotkey-recorder + LazyImage
├── clipboard_popup.tsx   # 剪贴板弹窗入口（延迟创建）
└── modules/       # clipboard/ + quota/ 前端
```

## 关键机制

### 窗口
- `main` 主窗口：关闭=隐藏到托盘；`unified_hotkey` 开启时按「面板」工作（点外部关闭/热键切换/置顶/跳过任务栏/可选跟随鼠标）
- `clipboard_popup` 剪贴板弹窗：跟随鼠标或固定位置，失焦自动隐藏；**延迟创建**（首次呼出才建窗，避免启动闪现）
- `search_popup` 文件搜索弹窗：复用剪贴板弹窗模式（跟随鼠标/失焦隐藏/延迟创建），Everything64.dll 动态加载
- **坑**：Windows 下透明窗口（`.transparent(true)`）hide 后再 show 会崩溃，已放弃透明方案

### 全局热键与统一呼出
- `unified_hotkey=true`（默认）：只注册主窗口热键（默认 Ctrl+Shift+E），各模块独立热键禁用；关闭则反之（主窗口改由托盘呼出）
- **热键匹配必须用 `Shortcut::from_str(&cfg).map(|s| s == *shortcut)` 对象比较**（`to_string()` 输出 `shift+control+keya` 格式不匹配）
- 录制格式：`Ctrl/Shift/Alt/Super + 键名`（Windows 键用 **Super** 不是 Win），见 `HotkeyRecorder`

### 配置与数据
- 数据目录 `%APPDATA%\com.aliboder.easytool\`：`config.json`、`clipboard.db`（SQLite WAL，含 `pin_order` 列）、`images/`、`thumbs/`
- 额度历史按账户分文件 `balance_history_<account_id>.json`
- 密钥存 keyring（service `com.aliboder.easytool`），**每账户独立槽位**：默认账户 `deepseek`/`opencode-go`，新增账户 `quota-<id>`（key_ref 字段）；新账户绝不回退旧槽位
- search 模块：`Everything64.dll` 打包在 `src-tauri/modules/search/`（资源目录，dev fallback 相对路径）；SDK 有进程级全局状态，查询须持全局互斥锁（`sdk::sdk_lock`）且放后台线程（Everything 查询同步阻塞）

### 额度轮询（多账户）
- `poll_loop` 后台线程按 `refresh_interval_sec`（≥5s）调 `fetch_once`：遍历 `account_configs` 逐账户查询 → 更新 `QuotaState.accounts` → 逐账户告警（阈值统一）→ 逐账户写历史 → emit `quota://updated`
- API：DeepSeek `GET /user/balance`（取 CNY total_balance）；OpenCode Go `GET /zen/go/v1/usage`（camelCase 需 serde rename，percent 字段 0~100 直用其余 ×100）
- 账户命令：`add_account` / `remove_account` / `rename_account` / `set_account_key`；统计命令带 `account_id` 参数

### 剪贴板要点
- 监听：事件驱动（WM_CLIPBOARDUPDATE）+ 500ms 轮询兜底；按 hash 去重
- 固定条目排序：`items.pin_order`（NULL=未排过序排最后），拖拽后调 `set_pin_order(ids)` 持久化

### 迁移
- `migrate::run_migration` 启动自动执行一次，结果写 `config.migrated` 标记（幂等）
- 剪贴板：PasteBoard 库按 hash 导入；余额：QuotaMonitor 记录按时间合并去重

## 开发命令

```bash
npm run tauri dev      # 开发（需保持 localhost:14200 空闲；1420 可能被 Windows 动态端口排除范围占用）
npm run tauri build    # 打包（产物 src-tauri/target/release/bundle/nsis/）
cargo test             # Rust 测试（在 src-tauri/ 下）
npx tsc --noEmit       # 前端类型检查
```

- 打包只支持 `msi/nsis`（**不支持 portable**）。发版流程：改版本号（**三处同步**：package.json / tauri.conf.json / Cargo.toml）→ build → git tag → `gh release create`
- 后端 36 个单元测试；前端无测试框架，验证靠人工

## 代码查询规则（必须遵守）

- 项目已初始化 CodeGraph（`.codegraph/`）：**所有查代码——定位符号/理解逻辑/找调用方/评估影响——一律先用 `codegraph_explore`，禁止先 grep/Read**；一次调用返回源码 + 调用链 + 影响范围
- 新增/改动大量代码后 `codegraph init` 重建索引，保持与磁盘一致
- 新增功能模块时先读 `docs/module-guide.md`

## AI 行为准则

1. **想清楚再写**：明确说出假设；有歧义或多种理解时摆出来问，不默默选一个；有更简单的做法就直接说并反对过度方案；不确定就停下提问
2. **简单优先**：最小代码解决当前问题；不做投机扩展、不为单次使用建抽象、不加没被要求的配置/灵活度
3. **外科手术式修改**：只动必须改的代码；匹配现有风格；清理**自己**制造的死代码（自己改出来的未用 import/变量/函数），不动无关旧代码
4. **目标驱动**：把任务转成可验证目标（"加校验"→"写测试让测试过"）；多步骤任务先列简短计划 + 每步验证点

## 协作约定（本项目用户）

- 用户不写代码、不验代码、不用 git：代码由 AI 完成，编译/测试通过后**只告诉用户启动命令和手动验收清单**，用户亲自验证通过才算完成
- git 提交由 AI 主动做；提交前 `git status`/`git diff` 检查，只提交相关文件
- 大改动先汇报方案与改动范围，用户同意后实施
- **每次修复 bug 或解决技术问题后，必须将经验教训记录到 `docs/lessons.md`**（问题/根因/方案/教训/代码位置）
- 每次回答用户消息结束时，**单独一行**输出标签：`Aliboder`
