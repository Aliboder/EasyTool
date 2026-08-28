# EasyTool 教训与经验记录

本文件记录本项目开发中踩过的坑与解决方案。**改代码前先看第一部分速查表**；需要完整上下文（现象/根因/解决细节）时查第二部分按主题归档的记录。

> 2026-08-27 整理合并：原 1273 行（多格式混用、大量重复）重排为「速查 + 主题详录」两段式结构，全文统一换行与编码。

---

## 第一部分 · 易踩坑速查（开发前必读）

### 文件与协作

1. **PowerShell 5.1 写 UTF-8 必坏**：`Get-Content`/`Set-Content`/here-string 在中文 Windows 全程 GBK，`-Encoding UTF8` 还会加 BOM（Cargo 不认）。改含中文的文件一律用 Node.js / 编辑器工具；写后立即 Read + 校验时间戳确认落盘
2. **覆盖已有文件后必须校验落盘结果**（重新 Read / 看 LastWriteTime / 长度），不能只信「写入成功」的返回（曾出现 index.html 没写进去，Vite 把旧站 HTML 原样拷进 dist，模块数异常少才暴露）
3. **提交 ≠ 安全**：编辑器/工具可能用旧缓冲覆盖磁盘上已提交的新内容（功能无端回退但 git log 正常，tsc 还能过）。排查用 `git diff`（不是 status 干净就安全），恢复用 `git checkout -- <file>`；提交前后各 diff 一遍
4. **多会话并发改共享文件会互相覆盖**：另一个会话可能在改 `lib.rs`/`modules/mod.rs`/`App.tsx`（临时注释 `pub mod`、重写热键）。提交前 `git status` + `cargo build` 确认，避免把他人半成品混进自己 commit

### Rust / Tauri 后端

5. **std Mutex 不可重入；持锁期间绝不调用会再次取锁的函数**；网络（reqwest 每个账户最长 15s）、图片 PNG 编码/缩略图、Everything 查询等耗时 I/O 必须放锁外或 `spawn_blocking`——锁内只做内存/DB 快操作（曾导致前端查询阻塞几十秒、图片入库全体排队）
6. **多 Mutex 加锁顺序必须全局一致**（如额度模块统一「QuotaState → QuotaDb」），任何反向加锁都会死锁；只取单锁时也保持同习惯
7. **Mutex 中毒要恢复**：`.lock().unwrap_or_else(std::sync::PoisonError::into_inner)`。一行持锁 panic 后，全部 `.lock().unwrap()` 连环 panic = 应用「活着但功能死」（曾遍布 14 文件 72 处，批量替换修复）
8. **tauri `State` 是借用视图不是句柄**：不能封装成返回 `MutexGuard` 的辅助函数（E0515）。每个命令内联两行 `let state = app.state::<T>(); let s = state.lock()...`
9. **Tauri 命令同名冲突**：`#[tauri::command]` 按**函数名**生成宏符号，不同模块同函数名（`get_status`/`open_file`/`save_settings`）E0428 冲突；`rename=` 只改命令名不解决宏冲突——函数名必须带模块前缀（`search_get_status`），invoke 名 = 函数名
10. **新 Tauri 命令必须注册进 `lib.rs` 的 `generate_handler!`**：漏注册 = 前端 invoke 静默失败（Promise reject 无日志），表现为「操作无效 + UI 回弹 @dnd-kit 松手回弹」。排查前端调用失败先查 invoke_handler 列表
11. **开关类配置必须作用于消费者实际读取的标志**：同一布尔两份存储（state 字段 + static）必失同步，setter 前先问「谁在轮询这个值」，让 setter 直达那个位置
12. **时间口径必须先定死「一个时钟、一个格式」**：时间字符串一律由 Rust `chrono::Local::now()` 本地时间生成（写入/心跳/查询同口径），duration 用 `julianday(两端同格式)` 差值；混用 UTC 存储与本地查询是最常见隐式 bug（时区错日）
13. **SQLite 建索引必须在列添加（迁移）之后**：索引引用的列若在版本迁移中才添加（如 `pin_order`），索引创建放迁移之后，否则新库建表失败
14. **新增数据库列要同步 7 处**：`db.rs`（迁移/SQL/row_to_item/方法）、`models.rs`、`commands.rs`、`lib.rs` 注册、`monitor.rs` 与 `store.rs` 的 Item 构造（grep 要搜 `ItemKind::` 不只 `Item {`）、测试辅助函数、前端 DTO/UI
15. **`keyring` 必须开启 `features = ["windows-native"]`**，否则 `Entry::new().unwrap()` 直接 panic
16. **多账户密钥槽位必须按账户独立**（`quota-<id>`）：任何「按 kind 回退固定槽位」逻辑都会同类账户串号共用同一密钥；迁移幂等（旧账户 `migrate_account_keyrefs`）
17. **开库失败不要 expect**：磁盘库是用户环境的一部分，损坏是常态输入。`quarantine_broken_db` 把损坏库（含 -wal/-shm）改名 `.broken-<时间戳>` 留证后重建空库，模块降级而非应用崩溃
18. **窗口函数差分统计符号以「上一行 - 本行」为准**（`SUM(prev_balance - balance)`），别被「下降」直觉带偏写反；纯函数逻辑换成 SQL 时必须保留原实现 + 加交叉校验单测（同一批数据逐项比对）

### 全局热键

19. **`unregister_all` 是全局的，不是只清同名键**：严禁「注册新键→unregister_all→只重注册自己的」——其它模块热键全灭。正确顺序：先注册验证 → 写入 config → 调 `reapply_hotkeys`（按新 config 整体重注册）
20. **热键匹配别每次按键都解析 + 持配置锁**：把解析结果缓存到 `ResolvedHotkeys`（`reapply_hotkeys` 时重建 + 用 `Shortcut` 对象比较），handler 只读缓存，避免高频事件下反复分配与锁竞争
21. **非统一模式下主窗口热键根本不注册**（托盘呼出），`set_main_hotkey` 应直接拒绝；统一/独立两种模式的注册逻辑是相反的
22. **热键注册失败要有用户可见提示**（系统通知，被占用最常见）：只写日志 = 用户无法呼出且毫无感知
23. **托盘点击不授予前台权限**：`set_focus` 可能失败，且「没拿到焦点的失焦」易被误判为点外部而隐藏。方案：show 前注入一次无害 F24 按键 + `MAIN_FOCUSED_SINCE_SHOW` 守护（没真正聚焦过的失焦不算）+ 150/400/900ms 焦点重试
24. **失焦隐藏要区分「真失焦」与「拖动中」**：拖动标题栏 move loop 会持续失焦（>200ms 宽限期也覆盖不了）。`GetAsyncKeyState(VK_LBUTTON)` 高位 1 = 左键仍按住 = 正在拖动，继续等待；注意与 `i16` 比较用 `as u16 & 0x8000`（字面量直接与会报 overflowing_literals）

### 窗口 / 弹窗 / Win32

25. **焦点事件 ≠ 窗口可见性**：拖动/切焦点都会触发失焦，不要把「失焦」当「隐藏」；动画/显隐判断用 `isVisible()` 守卫（见 `useWindowEntrance`）
26. **Windows 下不要开 `.transparent(true)`**：透明 WebView2 窗口 hide 后再 show 崩溃（0xcfffffff），已放弃透明方案
27. **独立窗口延迟创建**：`.visible(false)` 在 Windows WebView2 上创建初始化期间仍会闪现；首次呼出时才建窗（`ensure_popup_window`），顺带恢复 `popup_size` 并过滤 <400x300 脏值
28. **窗口尺寸记忆要过滤脏数据**：隐藏/最小化时 WebView2 报 0x0。前端 `onResized`、`save_main_size` 命令、setup 恢复三层都校验 <400x300；`minWidth/minHeight` 只约束用户拖拽，编程 `set_size` 不受限
29. **新增前端入口五处联动**：`vite.config.ts` 的 `rollupOptions.input` + 根目录 `.html` + Rust 建窗（`WebviewUrl::App("xxx.html")`）+ `capabilities/default.json` 的 windows/权限 + 共享弹窗 helper
30. **粘贴回原窗口不要用 `SetForegroundWindow`**（Windows 严格限制前台权限，EasyTool 已非前台进程会静默失败）：隐藏本窗口 → 等 100ms 焦点自动回原窗口 → 模拟 Ctrl+V（PowerToys Advanced Paste 同款）
31. **`EM_GETSEL` 返回值 HIWORD=终点/LOWORD=起点且仅 16 位有效**，直接取返回值得反序选区；用指针出参拿完整 32 位 (start, end)
32. **Windows 文件图标**：`SHGFI_USEFILEATTRIBUTES` 取不到格式专属图标，须访问真实文件再回退，缓存按路径而非扩展名；`\\?\` 设备路径先 `strip_prefix`；兜底要保证**永不返回 None**（真实文件→通用图标→生成中性图标），否则前端 `missingIcon` 永久缓存把一次失败放大成整会话缺图标

### 前端 / React

33. **@dnd-kit 拖拽 + WebView2 渲染变形**：大尺寸卡片 + opacity + transform 组合会让窗口压扁。被拖大卡片不加透明度；额度面板用 `verticalListSortingStrategy` + `will-change: transform` + 拖动中禁 transition；**小尺寸条目（剪贴板固定板块）拖拽安全**
34. **ResizeObserver 绑异步挂载节点用回调 ref**（`useCallback`，React 19 支持清理）：空依赖 `useEffect` 只在挂载时跑一次，异步渲染的节点绑不上
35. **横向滚动**：滚轮→`scrollLeft` 用共享 `useHorizontalWheel`；`overflow-x-auto` 会让 `overflow-y` 也变 auto，悬浮元素别放超出滚动容器顶部
36. **`useWindowEntrance` 动画（transform + fill-mode）会让 `fixed` 失效**：浮层/抽屉遮罩用页面根节点 `relative` + `absolute inset-0`，避开包含块陷阱
37. **入场动画要点**：隐藏期间保持透明初始态（失焦重置透明、聚焦重放），否则「先亮→变透明→再淡入」闪烁；不要重挂载根节点触发动画（丢子组件状态）
38. **`setState(prev => prev)` 等于没做防抖**：值不变不触发重渲染。防抖要把「值更新」放进 setTimeout
39. **小数据量（<1000 条）搜索用本地过滤**：一次 `get_all_history` + `useMemo` 内存过滤，比每次 IPC 快千倍（IPC 有序列化/跨进程开销）；数据变更时重拉全量即可
40. **秒级倒计时用自持 interval 的独立小组件**（只重渲染自身），别整页每秒 setState 拖垮图表/拖拽容器
41. **后台刷新类 loading 不能整体替换已有内容**（spinner 顶掉→闪烁）：`loading && 数据为空` 才显示 spinner（保留上一次数据）
42. **异步响应要防迟到覆盖**：列表加序号 ref，`seq !== current` 丢弃旧响应（快速输入/切 Tab 场景）
43. **图标这类「可能失败」的异步资源，成功和失败都要缓存**（失败进 missing 集合），否则失败路径每次渲染反复 invoke + 闪烁
44. **Canvas 像素检测（emoji 支持性）别同步跑**：useState 初始读缓存（未命中先按支持显示）+ `requestIdleCallback`/rAF 分片（24 个/帧）+ localStorage 防抖批写；复用共享 canvas，别逐字符新建 context 扫 4096 像素
45. **keep-alive 切回模块的刷新策略**：激活重载要保留（分片后很便宜），focus 刷新只作补充（切 Tab 不触发 focus，会数据过期）；「按需刷新」要防事件风暴——in-flight 合并（并发共享同一 Promise）+ 150ms 防抖
46. **虚拟列表只适合固定/可预测高度**：文本自动换行高度动态会重叠（estimateSize 固定 80px 案例）——要么 `measureElement` 动态测量，要么小数据量不用虚拟列表
47. **右键菜单**：Portal 到 `document.body` 避开父元素 transform 包含块 + 视口边界钳制；所有可交互元素 + 容器都要 `e.preventDefault()` 阻止浏览器默认菜单
48. **Tauri v2 命令参数 JS 侧必须 camelCase**（Rust snake_case 自动映射为 camelCase）：键名不匹配 → 反序列化失败 → Promise 静默 reject，「设置改完重启回退旧值」是典型信号
49. **文件选择用 plugin-dialog**：WebView 原生 `<input type="file">` 拿不到绝对路径；需 Cargo 依赖 + `.plugin(init())` + capabilities `dialog:default` 三处联动

### Everything / 文件搜索

50. **`Everything64.dll` 导出名带 W 后缀**：`Everything_SetSearchW`/`Everything_QueryW`/`Everything_GetResultFullPathNameW` 等完整名，`GetProcAddress` 字符串必须写完整，否则 "missing symbol"
51. **SDK DLL 需从官方 `Everything-SDK.zip`（voidtools.com）获取**：Everything 安装目录只有 exe/ini/lng；DLL 是 IPC 客户端，**Everything 必须运行**才能查询
52. **SDK 有进程级全局状态**：所有查询经全局 C 静态变量串行，同一进程只能同时一个查询——必须持全局互斥锁（`sdk::sdk_lock`）+ `spawn_blocking` 后台线程
53. **动态加载 DLL 用 `LoadLibraryW` + `GetProcAddress`**（resources 路径运行时不定，静态链接找不到）；`FARPROC` 转具体签名用 `std::mem::transmute_copy`（`transmute` 泛型报 E0512）
54. **Everything 官方安装器不写 App Paths**（只写 Uninstall 键的 InstallLocation）：检测安装用 App Paths → Uninstall InstallLocation → 常见安装目录三路兜底
55. **判断搜索可用性的唯一可靠信号是运行探测**（SDK 查询成功 = 已装且运行中；便携版不写注册表，不能靠注册表判断）；`search_get_status` 只返回 running，前端引导卡给「下载/启动/重测」三按钮；自动启动用 `-startup` 参数静默进托盘（直接 spawn 会弹主窗口）
56. **无限滚动三件套**：`loadMore` + `onScroll` + `onScroll` 绑到滚动容器，缺一不可（TS6133「声明未使用」= 写了一半没接线）；第一页撑不满视口时 onScroll 永不触发，需 `scrollHeight - clientHeight` 兜底续载直到填满；隐藏容器 `clientHeight === 0` 跳过（keep-alive 切走的标签页会静默狂拉数据）

### 构建 / 发版 / 官网

57. **版本号三处同步**：`package.json` + `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml`（`Cargo.lock` 根包一并改），同一次提交；漏一处构建失败或版本不一致（v0.6.6 曾漏 Cargo.toml）
58. **Tauri v2 `createUpdaterArtifacts` 是签名总开关**：不设为 `true`，再正确的密钥也不生成 `.sig`；CI 构建后必须验证 `.sig` 存在；私钥密码是独立 Secret，workflow 两个 env 都要传
59. **CI 产物 glob 先本地验证真实文件名**（Tauri 产物是 `EasyTool_x.x.x_x64-setup.exe`，不是 `*.nsis.exe`）；发布后 `gh release view` 确认 assets 非空
60. **vite 端口 14200**：Windows Hyper-V/WSL 动态排除端口范围会让「空闲」端口绑不上（EACCES）——`netsh interface ipv4 show excludedportrange protocol=tcp` 查；换端口比重启/防火墙可靠
61. **模块 manifest 走 `resources`**（打包嵌入 exe），dev 模式 fallback 到 `src-tauri/modules` 相对路径；新增模块无需改打包配置
62. **官网内容易滞后**（曾停 v0.4.5 实际 v0.5.2+）：删/增模块时官网要同步清理模块列表（bento Card / deep-dive / download WHAT_YOU_GET / hero 副标题 / footer / real-* 组件 / stats-ticker / changelog）

---

## 第二部分 · 详细记录（按主题）

### 剪贴板

**虚拟列表导致文本卡片重叠**：`@tanstack/react-virtual` 固定 `estimateSize={80}`，文本换行后实际高度超 80px 仍按 80 排列 → 重叠。移除虚拟列表恢复普通 `<ul>`（默认 500 条不需要虚拟化）。教训：虚拟列表适合固定/可预测高度；引入优化组件前先评估是否真的需要（速查 #46）。

**「查看大图」无反应 → 应用内预览**：原实现 `openPath`（plugin-opener）调外部看图软件，此环境静默失败 + 需求方向不符。改为应用内遮罩预览：image 复用 `get_image`，files 图片复用现成 `get_file_preview`（最长边 1024 已有缓存），前端全屏遮罩（点遮罩/Esc/关闭）。教训：涉及「打开/预览」先确认用户期望应用内还是外调；排查「点了没反应」先区分后端命令失败 / IPC 失败 / 前端逻辑没走到；有现成能力优先复用。

**粘贴链路**：`SetForegroundWindow` 还原焦点受限（EasyTool 已非前台进程），方案是隐藏本窗口 → 100ms → Ctrl+V（速查 #30）。旧方案残留的 `restore_selection`/`restore_focus`/`EM_SETSEL` 成为 dead_code，删掉并清理仅它们使用的 Win32 import（`record_foreground` 仍被热键调用保留，写不读，后续可简化）。

**搜索性能两连**：① `get_history` 每次对全部图片条目 `Path::exists` 磁盘探测（网络盘/U 盘秒级延迟）→ 只在 image/pinned Tab 需要精确过滤时探测，普通搜索跳过。② 每次输入都 IPC + SQL LIKE，快速输入时重渲染风暴 → 改本地过滤架构（`get_all_history` 全量 + useMemo），移除 debounce（速查 #39）。

**自写剪贴板守卫升级**：按 2000ms 一刀切会吞掉粘贴后的真实快速复制，且轮询签名已推进永不补录 → 改为内容指纹：paste/copy 路径登记 `set_pending_ignore`，监听侧只跳过指纹一致的回声。

### 额度监控

**多账户支持改造**：配置新增 `accounts` 数组，旧配置自动迁移出默认 deepseek + opencode-go 账户；keyring 槽位按账户派生（`key_ref` 兼容旧槽位名）；历史按账户分文件。关键坑：SQLite 建索引必须在列添加（迁移）之后（速查 #13）；旧 `balance_history.json` 需复制为默认账户文件否则消费历史丢失；`get_stats_data`/`get_daily_history` 增加 `account_id` 参数前端统计随选中账户联动。

**多账户密钥串号 + 名称显示密钥**：① 添加账户名称框可误填密钥且无默认 → 名称留空自动编号（OpenCode Go 2）；② 新账户 `key_ref` 为空按 kind 回退旧槽位 → 同类账户共用同一密钥、数据串号。修复：新账户分配独立槽位 `quota-{id}` 绝不复用旧槽位；`migrate_account_keyrefs()` 幂等迁移历史账户；前端提示「留空自动编号」（速查 #16）。

**数据落 SQLite + Go 周期/趋势**：`QuotaDb`（WAL + busy_timeout）三表 `balance_history`/`go_snapshots`/`go_cycles`；旧 JSON 启动幂等导入（settings 记 `json_imported_<id>` 标记、旧文件保留）；`fetch_go` 每次写快照 + `track_go_cycle` 周期检测（`used_percent` 骤降或 resets_at 已过 → 关旧开新）；前端 `MiniDailyBars`/`GoSparkline` SVG 用 `preserveAspectRatio="none"` + `vectorEffect="non-scaling-stroke"` 拉伸不糊。教训：持久化层与纯计算解耦（history 纯函数可测）；多 Mutex 锁顺序一致性是死锁防护的根；迁移幂等 + 保留旧数据（速查 #6/#18）。

**面板重构**：QuotaPage 膨胀到 741 行 → 去掉 dnd 大块拖拽（`SortableBlock`/`panel_order` 及后端命令全删）、新增摘要条 `quota-summary.tsx`、历史图表统一进卡片展开（DeepseekCard 自取 `get_stats_data` 自包含）、设置改抽屉、文件拆分 `QuotaPage`/`quota-cards`/`quota-summary`。教训：增量叠加到「重排两块就得改十处」就该重构；删前端特性时同步清理后端死命令（速查 #36 `fixed` 失效）。

**UI 优化（赠送/充值、徽章、倒计时、恢复通知、燃尽率）**：`Balance` 解析 `granted_balance`/`topped_up_balance`（缺失默认 0）；状态徽章三级；告警判定必须用更新前 `last_balance` 快照（先 `let prev = status.last_balance;` 再覆盖，否则 recover 永不触发）；恢复通知「✅ 余额恢复」；秒级倒计时独立 `Countdown` 小组件隔离重渲染（速查 #40）；燃尽率只在选中账户卡片显示。

### 文件搜索（Everything）

**SDK 集成四坑**：命令同名冲突（速查 #9）、DLL 导出名 W 后缀（#50）、SDK 包需单独下载（#51）、进程级全局状态需串行化（#52）。动态链接符号名先 `dumpbin /exports` 或真实探测测试验证；检测安装三路兜底（#54）；可用性 = 运行探测（#55）。

**无限滚动只显示第一页**：`fetchPage`/`loadMore`/`onScroll` 都写了但 `onScroll` 没绑到 `overflow-y-auto` 容器 → `loadMore` 永不触发，总数字正确但只渲染 100 条。补绑定 + 删死代码 + 填满兜底（速查 #56）。

**应用中心性能**：`.lnk` 每次全量 COM 解析 → `apps.db` 的 `shortcut_cache(path,target,mtime_ms)` 按 mtime 命中缓存，只解析新增/变更的快捷方式。前台频率排序的「应用中心」是原 quicklaunch 模块并入 search 的结果（速查 #62 官网同步清理）。

### 表情模块

**数据源与死代码**：`emoji-datasource` npm 包（`package/emoji.json` 1911 条 + 英文分类/shortcode）一次生成 `emoji.json` 资源（~234KB）提交仓库，无运行时依赖；中文名用高频映射表兜底。1906 条纯前端内存过滤毫秒级完成，后端 `search` 命令是死代码删掉（YAGNI）。

**性能优化三连**（切回卡、首屏卡、呼出卡）：
1. 「每次激活重载数据 + 重建 1906 对象 + 重渲染」+ 缓存冷时 `requestIdleCallback` 连续 144+ 次 canvas 检测（每次新建 context + 4096 像素扫描 + 全量 localStorage 写）→ 切回卡 200ms+。修：检测复用共享 canvas/context + 每帧 rAF 分片（24 个/帧）+ localStorage 防抖批写；未命中先按支持显示字符（速查 #44）。
2. 去掉激活重载后切 Tab（剪贴板→表情）不触发 focus → 「添加表情」后收藏不刷新（DB 已写入）。修：**激活重载要保留**（分片后 ~5ms 不卡），focus 刷新只作补充。排查「操作后不显示」先查 DB 是否写入成功，再查前端刷新时机（速查 #45）。
3. 快捷键呼出时 WebView2 focus 事件连发多次 → `loadCatalog` 并发重载互相叠加（单次呼出 2~6 次、尖峰 400ms+）。修：`loadCatalog` 加 in-flight 合并（共享同一 Promise，同对象 setCat React 跳过重渲染）+ 焦点刷新 150ms 防抖。教训：「按需刷新」也要考虑事件风暴 + 提供合并/防抖。

**右键菜单**：内置表情「复制表情」、自定义表情「复制/收藏/删除」，统一走通用 ContextMenu 组件（速查 #47）。

### 时长统计

**时间口径**：events 表曾用 SQLite `CURRENT_TIMESTAMP`（UTC）存、`date('now','localtime')` 查 → UTC+8 下每天 0:00~8:00 归到昨天。统一 `chrono::Local::now()` 本地时间 + `julianday(两端同格式)`（速查 #12）。

**时间线必须绑定周期**：切到本周/本月时排行/概览/分类占比都更新，唯独下方时间线柱状图不动（数据一直用 `timetracker_get_app_timeline(viewDate)` 取单日事件，与 period 无关）。修：时间线改成周期感知——今日=24 根（小时）、本周/本月=天数根；Timeline 抽象 `granularity: "hour" | "day"` 分组：hour 绝对刻度（满格 60min + 参考线 + 当前时刻线），day 归一化刻度（满格=当日最多、按软件堆叠）；新增 `timetracker_get_app_timeline_range(start,end)` 取整段事件。教训：按周期呈现的时间序列图表，其数据粒度必须与周期强绑定（小时/天）；柱状图刻度：绝对（有物理上限如 24h/60min）用绝对值，否则用「最大值归一化」更直观。

**WinEventHook 回调模式**：on_foreground 回调里同步写 SQLite 会阻塞系统级窗口切换事件派发。正确模式（ActivityWatch 同款）：回调只做 Win32 轻量采集 → mpsc::channel 入队即返回；独立心跳线程 `recv_timeout(15s)` 消费（收到消息立即结算+开新会话，超时心跳 UPDATE 当前会话时长——顺带解决「一直用同一应用直到关机丢整段数据」）。

**会话语义三连**：
1. 跨天会话拆账：23:50 → 次日 00:10 的会话整段归开始那天，次日 10 分钟丢失。心跳/切换结算前先 roll_cross_day_event：昨日 23:59:59 封账原行 + 今日 00:00:00 开新行（继承 app/title/is_active）。凡按日分组统计连续区间的数据模型，写入端必须处理跨边界切片。
2. 心跳封账坑：`UPDATE ... SET end_time=? WHERE end_time IS NULL` 首次心跳就封账 → 下次匹配不到 → 静止超 15s 的时长全部丢失（1 小时只剩 20 分钟）。修：`update_current_event` 只刷新 duration/is_active（**end_time 保持 NULL**），封账单独 `close_current_event`；init 时结算异常退出遗留的 open 会话。会话语义：end_time=NULL = 进行中，值只应增大；验证时长统计一定要直接查库对账（SUM vs 时间跨度）。
3. 活跃翻转切段：is_active 只=最后心跳值，挂机 10 分钟被整段算活跃。修：每心跳读当前会话 is_active，与本次相同就延长，**翻转就封账旧段 + 开新段**（继承同 app/标题、新 is_active）。is_active 属于「片段」不是整条记录的属性。

**「A→A」两阶段**：① 展示层：前台钩子按 HWND 变化切会话，同应用不同窗口/焦点闪变切碎会话 → EventLog 合并连续同 app 事件为一条；② 采集层治本：`switch_session` 先判同应用（按 exe_path 小写比较，同 exe 不切事件），只有真实换应用才产生事件。

**分类体系**：6 类 `efficiency/resource/media/study/system/game`，判定顺序即优先级（游戏→视听→资源→学习→效率→系统兜底）；QQ 品牌消歧（qqmusic 先归视听）；避免过短子串（x/go/et/line 误配）；编程助手（含 "code"）与 AI 对话（豆包/秘塔）区分。多端联动：Rust 判定、前端 `CATEGORY_LABELS`/`CATEGORY_HEX` 唯一常量来源，所有 UI 从 `Object.entries` 派生，改一处全生效；`reapply_categories()` 幂等重算存量（只动 `category_locked=0`）；分类指纹（`AUTO_CATEGORIZE_VERSION` + 规则顺序）避免启动全量重算。用户正则规则缓存编译（static RwLock 列表，规则变更时 `reload_rules` 刷新）+ 规则变更触发存量重算。

**应用名三级解析**：前台钩子只能拿 exe_path → `display_name.rs`：① 读 search `apps.db` 的 `shortcut_cache`（.lnk 主名，复用缓存不重复 COM 解析）；② `GetFileVersionInfoW` + `VerQueryValueW` 的 `FileDescription`（`\\VarFileInfo\\Translation` 枚举语言比固定 `040904B0` 兼容性好）；③ 兜底 exe 主名。展示名与判定名分离（`display_name` vs `app_name`），避免友好名破坏 `auto_categorize`/正则。

**页面轮询双门控**：时长统计页 30s 轮询改为「当前 Tab 活跃 + document 可见」双门控，keep-alive 隐藏/弹窗失焦即停止轮询；重新可见时立即补一次刷新，避免数据过期（与表情页刷新策略同源的资源优化，速查 #45）。

**图标消失三连**：
1. 无图标占位太淡（20% 透明色块）≈ 消失 → 显式 `bg-muted` 方框 + FileQuestion（照抄搜索「应用」Tab）。
2. 轮询刷新 loading 把已有内容整体换成 spinner → `loading && 数据为空` 才显示 spinner（速查 #41）。
3. `file_icon_png` 对 `\\?\` 设备路径 / 失效受限 exe / UWP 进程会返回 None，且**行为不稳定**（单线程 Some、并行 None）→ 前端 `missingIcon` + 后端 `ICON_CACHE` 双重永久缓存 → 一次失败整会话缺图标。根修：`file_icon_png` 保证永不返回 None（strip `\\?\` → 真实文件 → 通用图标 → `generic_icon_png()` 生成中性图标兜底）（速查 #32）。

### 窗口 / 弹窗 / 动画演进

**弹窗闪现 → 延迟创建**：`.visible(false)` 不能阻止 WebView2 初始化期间短暂可见，且抢焦点后失焦触发隐藏 =「闪现→消失」。改为首次呼出才建窗（`ensure_popup_window`），减少启动开销（WebView2 建窗很重）（速查 #27）。

**入场动画三阶段**：
1. Tauri 无窗口级动画 API → 前端 `useWindowEntrance`：监听 focus 事件 → remove class → 强制 reflow → add class 重放 CSS 动画；不重挂载根节点（丢子组件状态）。
2. 闪烁：窗口 show 瞬间是动画完成态（不透明），focus 事件才重放 →「先亮→变透明→再淡入」。修：失焦/隐藏时重置透明初始态，show 的第一帧即透明，动画与显示同步。
3. 拖动闪烁：焦点事件无法区分真隐藏与拖动失焦 → 失焦延迟 250ms 查 `isVisible()`，仅真隐藏才重置透明；聚焦仅「从隐藏变可见」才播放（速查 #25/#37）。

**尺寸记忆 0x0 → 三层防护**：隐藏/最小化 WebView2 报 0x0，防抖保存后 setup `set_size(0,0)`（编程调用绕过 minWidth/minHeight）→ 窗口极小像卡死。前端 onResized 过滤 + `save_main_size` 校验 + setup 恢复校验三层 <400x300；另在「点 X 隐藏」「托盘退出」两个时机后端主动保存，兜底前端防抖未触发（速查 #28）。

**blur-grace 演进**（失焦自动隐藏的完整历史）：初版固定 200ms 宽限期 → 第一次拖动失踪（拖动 move loop 持续失焦 >200ms）→ 加左键按住判断（速查 #24）→ EasyAsk 子 WebView 抢焦点（子 HWND 算窗口聚焦，IsChild 判定）→ 移除 EasyAsk 后换通用方案：F24 按键注入 + `MAIN_FOCUSED_SINCE_SHOW` 守护 + 焦点重试（速查 #23）。教训：面板式窗口的失焦隐藏要覆盖「瞬时失焦」「拖动中」「呼出后未真正聚焦」三类假失焦。

**弹窗 helper 收敛**：剪贴板/搜索/表情/时长统计四弹窗统一到 `lib.rs` 的 `ensure_popup_window`/`show_popup_at`/`popup_position_physical`（Win32 物理坐标 + 光标所在显示器工作区钳制），模块只留 label/html/尺寸参数；顺带统一恢复 `popup_size` 并过滤脏值。

### 启动流程

**setup 阻塞推迟首帧**：search/emoji 的 `join()` 排在 setup 里，任何模块初始化慢都推迟窗口显示。修：模块工作 spawn 时已并行，**join 只是同步点**——首屏不依赖的模块（search/emoji/timetracker）join 放 `build_tray` 之后的后台线程；剪贴板保留同步 join（主窗口首屏数据源，开库毫秒级）；quota 延迟 500ms 初始化；`win.show()` 移到 setup 外（见下）。

**主窗口「先空白、闪一下、才加载」**：窗口显示时机（Rust）与内容就绪时机（前端 WebView 加载 + React 挂载 + 懒加载，dev 模式可达数秒）从未对齐。修：**显示决定权交给前端**——Rust 不再 show，新增 `main_window_ready` 命令（show+unminimize+set_focus）；前端 bootstrap 完成 → 预载全部模块 chunk → 双 rAF（等主题应用/首帧绘制）→ invoke；setup 尾部 15s 兜底线程（查 `is_visible()` 再 show，避免覆盖用户交互）。多端协作的「就绪」必须显式握手 + 超时兜底。

**keep-alive 误杀首屏**：清理 effect 依赖 `enabledModules`，首次渲染清单未就绪时为空数组 → 把 `visited` 里的合法模块全滤掉，且单向过滤（只滤不回填）永不恢复 → 剪贴板页面空白。修：守卫 `if (!orderedManifests.length) return;`（区分「数据未就绪」与「用户全禁用」——后者要照常清理）；落地面板 = 排序第一位且启用的模块（active/visited 初始为空 + 兜底补入 `enabledModules[0]`），不要写死 id。

**启动体检（P1×6 + P2×12）**：① Mutex 中毒零恢复系统性风险 → 全部 `into_inner` 恢复（速查 #7）；② 时间窗守卫配内容指纹（见剪贴板）；③ EM_GETSEL 出参（速查 #31）；④ 非 async 命令跑主线程冻结 UI → 同步命令改 async 时 `State<'_,T>` 不能 move 进 spawn_blocking（E0521），改传 AppHandle 闭包内再取；⑤ 异步迟到响应防覆盖（速查 #42）；⑥ 失败路径不能跳过恢复动作：换主热键 save_config 失败提前 return 时已 unregister_all → 先恢复热键注册再返回错误。

**开库与迁移兜底**：`quarantine_broken_db`（损坏库改名留证 + 重建空库，速查 #17）；迁移失败落盘计数器（连续 3 次停止自动重试）；热键注册失败系统通知（速查 #22）；日志加时间戳；主窗口 `backgroundColor: #0a0a0a`（= dark 主题底色）防 WebView2 白底闪白。

### 全局热键

`unregister_all` 全局坑（速查 #19，`set_hotkey`/`search_set_hotkey`/`set_main_hotkey` 都栽过）；解析结果缓存 `ResolvedHotkeys`（#20）；统一/独立模式相反注册 + 非统一模式拒绝主热键（#21）；失败通知（#22）；F24 呼出保护（#23）。**统一模式（默认）**：只注册主窗口热键（Ctrl+Shift+E），主窗口按「面板」工作（置顶 + 跳过任务栏 + 点外部关闭 + 可选跟随鼠标）；**独立模式**：各模块自己的热键，主窗口靠托盘呼出。

### 更新 / 发版 / 官网

**自动更新实现**：tauri-plugin-updater + GitHub Releases 端点；ed25519 密钥对（私钥存 GitHub Secret + 密码独立 Secret，公钥 base64 放 `tauri.conf.json`）；CI 用 `tauri-apps/tauri-action` 构建 → 签名 → 发布；用户端设置页「检查更新」+ 启动静默检查横幅。三大坑：`createUpdaterArtifacts` 必须显式 `true`（速查 #58）；NSIS glob 要本地验证（`*-setup.exe`，#59）；发布后 `gh release view` 确认 assets 与 `.sig` 存在。

**v0.5.0 发布（PowerShell 编码 + glob）**：`gh release create` 后 CI 失败两次——① PowerShell 5.1 here-string/变量全程 GBK 把 Cargo.toml 中文写乱码（`宸ュ叿绠?`）；② workflow glob `*.nsis.exe` 匹配不上真实产物 `EasyTool_0.5.0_x64-setup.exe` → assets 为空。修：写中文文件一律 Node.js；glob 改 `*-setup.exe`（速查 #1/#59）。

**官网内容滞后 + Playwright 验收**：官网曾长期停在 v0.4.5；quicklaunch 并入 search 后官网仍当活跃模块展示（速查 #62 清理清单）。Playwright 测「hover 才显示」的控件：滚动会打断 :hover（click 自带滚动 → 无限重试「not visible」）→ 先 `scroll_into_view_if_needed()` → `hover()` → `click(force=True)`；aria-label 随状态变化的选择器用模糊匹配（`[aria-label*="固定"]`）。

**官网工程坑**：写入 `website/index.html` 未落盘，Vite 把旧静态站 HTML 原样拷进 dist（模块数异常少 + dist 体积≈旧源文件是信号）——改造成 React 工程前确认根 `index.html` 已替换；残留旧 `dist/` 要先清（速查 #2）。

### 已移除模块（参考价值）

**quicklaunch（已并入 search「应用中心」）**：
1. Settings 的 `setTimeout(() => onRefresh?.(), 100)` 闭包捕获旧 fetchItems，用旧参数覆盖新结果 → 移除冗余 setTimeout，parent useEffect 已监听 cfg 变化自动重取；
2. 中文名称排序：SQLite `ORDER BY name` 按码点不按拼音 → 前端 `localeCompare("zh-CN-u-co-pinyin")`；
3. 7 个分散 state 统一为单个 cfg + patch 更新函数（对齐 search 模块的配置管理模式）；
4. Tauri v2 命令参数 JS 侧 camelCase（速查 #48）。

**EasyAsk（主窗口内嵌子 WebView 直连 AI 对话网页，实验后移除）**——若未来再做多 webview：
1. `WebviewBuilder::build` 在 Windows 同步命令/事件处理器死锁，建窗必须 `Window::add_child` + 命令声明 `async fn`；
2. 多 webview API 挂在 tauri `unstable` feature 后面（`WebviewBuilder` 重导出 + `add_child` 都门控）；
3. `get_webview`/`get_window` 在内部 trait 上拿不到——`add_child` 返回的 `Webview` 存进模块 state 供后续命令取用；
4. 子 WebView 不在 DOM 里，keep-alive `hidden` class 盖不住 → 进入/离开模块页显式 show/hide；
5. 定位 = 容器 `getBoundingClientRect()` × `devicePixelRatio` 物理像素，ResizeObserver + resize 防抖重发；
6. 导航幂等：比对 `last_url`，URL 未变不重复 navigate（不丢聊天状态）；
7. 子 WebView 抢焦点会触发「失焦自动隐藏」死循环（子 HWND 焦点算窗口聚焦）；
8. 移除模块清单：manifest + Rust 目录 + `pub mod` 声明 + lib.rs（setup/命令注册/热键/事件特判）+ 前端整套 + App.tsx（lazy import/PAGE_IMPORTS/挂载）+ 独享 Cargo feature（unstable）+ AGENTS.md 模块列表；移除后 grep `(?i)<id>` 全仓库（含 website/.github/tools）确认零残留。

### 其它

**模块设置页统一风格**：所有模块设置页遵守「外层 p-6 + Card 分组 + SettingRow 行」骨架（共享 Drawer 内容区本身不带内边距，各设置组件必须自己供应）；写新模块设置页先照抄现有模块（clipboard/quota/search）骨架，别自创一套。

**vite 端口 EACCES**：Windows Hyper-V/WSL 动态保留端口范围（1331-1430 曾含 1420），端口「空闲」≠「可绑定」→ 换到 14200（vite.config.ts + tauri.conf.json devUrl 两处同步）（速查 #60）。

**Tauri State/命令清单**：「新增数据库列 7 处」「新命令三处联动（函数 + generate_handler + invoke 名一致）」是高频遗漏点（速查 #10/#14）。排查「松手回弹/设置不生效」先确认 onDragEnd 是否执行、IPC 是否报错——异步失败常表现为 UI 无变化而非报错。

**托盘图标**：Tauri 2 `TrayIconBuilder` 不会自动继承窗口图标，必须显式 `.icon(app.default_window_icon()...)`。

**模块启停与后台线程**：后台线程循环要感知 `enabled`（禁用时跳过工作继续 sleep），「软停止」比「硬停止」（信号 + join）简单够用；模块「关闭」包含 UI 层（侧边栏不显示）与功能层（后台任务停止）两个层面。