# EasyTool 教训与经验记录

本文件记录开发过程中遇到的问题、解决方案和经验教训。每次修复 bug 或解决技术问题后，应将经验记录于此。

## 易踩坑速查（开发前必读）

1. **PowerShell 读写文件编码**：`Get-Content`/`Set-Content` 会把 UTF-8 文件写成 GBK，曾损坏 Rust 源码。改文件一律用编辑器工具，不要用 PowerShell 重写
2. **std Mutex 不可重入**：持 `ConfigState` 或任何 Mutex 锁期间，**绝不调用会再次取锁的函数**（如 `module_config`、`fetch_once`）；网络/耗时操作放 `spawn_blocking`
3. **同步网络请求**：`fetch_once` 是同步 reqwest，必须在后台线程执行，禁止在 IPC 命令主路径直接调用
4. **Windows 下不要开 `.transparent(true)`**：透明 WebView2 窗口 hide 后再 show 会崩溃（0xcfffffff）
5. **新增前端入口**：需同时改 `vite.config.ts` 的 `rollupOptions.input`、根目录新建 `.html`、Rust 侧建窗（`WebviewUrl::App("xxx.html")`）、`capabilities/default.json` 的 `windows` 数组与权限
6. 模块 manifest 走 `resources`（打包后嵌入 exe），dev 模式 fallback 到 `src-tauri/modules` 相对路径
7. `keyring` 必须启用 `features = ["windows-native"]`，否则 `Entry::new().unwrap()` 直接 panic
8. **@dnd-kit 拖拽 + WebView2 渲染变形**：**大尺寸卡片 + opacity + transform 组合会让窗口压扁**。被拖大卡片不加透明度；DragOverlay 方案也会出问题；额度面板用 `verticalListSortingStrategy` + `will-change: transform` + 拖动中禁 transition。**小尺寸条目（剪贴板固定板块）拖拽安全**
9. **ResizeObserver 绑定异步挂载节点用回调 ref**：空依赖 `useEffect` 只在挂载时跑一次，异步渲染的节点绑不上。用 `useCallback` 回调 ref（React 19 支持清理）
10. **横向滚动**：滚轮→`scrollLeft` 用共享 `useHorizontalWheel`（返回 `{ ref, nodeRef }`）；`overflow-x-auto` 会让 `overflow-y` 也变 auto，悬浮元素别放超出滚动容器顶部
11. **版本号三处同步**：改版本需同时改 `package.json`、`tauri.conf.json`、`src-tauri/Cargo.toml`
12. **Windows 文件图标**：`SHGFI_USEFILEATTRIBUTES` 取不到格式专属图标，必须访问真实文件再回退；缓存按路径而非扩展名
13. **多账户密钥槽位必须独立**：quota 新增账户 `key_ref` 分配独立槽位（`quota-<id>`），**绝不复用/回退旧槽位**（否则同类账户串号共用同一密钥）；旧账户用 `migrate_account_keyrefs` 幂等迁移
14. **窗口尺寸记忆要过滤脏数据**：窗口隐藏/最小化时 WebView2 报 0x0，`onResized`/`save_main_size`/setup 恢复都要校验最小尺寸（<400x300 忽略）；`minWidth/minHeight` 只约束用户拖拽，编程 `set_size` 不受限
15. **独立窗口延迟创建**：不要在 setup 创建隐藏弹窗（`.visible(false)` 在 Windows WebView2 上仍会闪现），首次呼出时才建窗（见 `clipboard::ensure_popup_window`）
16. **窗口入场动画**：用共享 `useWindowEntrance`（失焦时内容置透明、聚焦时重放动画），避免「先显示完整界面再补动画」闪烁；不要重挂载根节点触发（会丢子组件状态）
17. **SQLite 建索引必须在列添加之后**：索引引用的列若在版本迁移中才添加（如 `pin_order`），索引创建要放迁移之后，否则新库建表失败
18. **焦点事件 ≠ 窗口可见性**：拖动/切焦点会触发失焦，不要把「失焦」当「隐藏」；动画/显隐判断用 `isVisible()` 守卫（见 useWindowEntrance）
19. **多会话并发改同一批文件会互相覆盖**：另一个窗口/AI 会话在开发别的模块时可能临时注释你的 `pub mod emoji;`、改 `lib.rs` 热键等。提交前 `git status` + 重新 `cargo build` 确认，避免把他人半成品混入自己 commit（文件级 git add 无法拆分同文件内他人的改动）
20. **纯前端过滤代替后端检索**：Emoji 全量 1906 条在内存过滤（中文名/英文名/shortcode）毫秒级完成，无需后端 `search` 命令——写了 `data::search` 是死代码，删掉避免 warning
21. **Emoji 数据源**：`emoji-datasource` npm 包（`package/emoji.json`）含 1911 条 + 英文分类/shortcode，一次生成 `emoji.json` 资源（~234KB）提交仓库即可，无运行时依赖；中文名用高频映射表兜底
22. **文件选择用 plugin-dialog**：WebView 原生 `<input type="file">` 拿不到绝对路径（Tauri v2 无 File.path），导入图片需装 `@tauri-apps/plugin-dialog` + `tauri-plugin-dialog`（Cargo 依赖 + `.plugin(init())` + capabilities `dialog:default` 三处联动）
23. **Tauri 命令同名冲突**：`#[tauri::command]` 按**函数名**生成宏符号（`__cmd__xxx`/`__tauri_command_name_xxx`），不同模块同函数名（如 `get_status`/`open_file`/`save_settings`）会 E0428 冲突。`#[tauri::command(rename="...")]` 只改命令名**不解决宏符号冲突**，必须直接改函数名带模块前缀（如 `search_get_status`），invoke 名 = 函数名
24. **Everything SDK DLL 导出名带后缀**：`Everything64.dll` 导出的是 `Everything_SetSearchW`/`Everything_QueryW`/`Everything_GetResultFullPathNameW` 等完整名（W=宽字符），不是去掉后缀的 `Everything_SetSearch`。用 `GetProcAddress` 动态加载时字符串必须写完整，否则 "missing symbol"（有真实环境探测测试 `real_sdk_probe` 可复现）
25. **Everything64.dll 需从官方 SDK 包获取**：Everything 安装目录**不含** SDK DLL（只有 exe/ini/lng），`Everything-SDK.zip`（voidtools.com）里才有 `Everything64.dll` + 头文件 + lib。打包放 `src-tauri/modules/search/`（resources），dev 模式 fallback 相对路径。Everything 必须运行（DLL 是 IPC 客户端，与 Everything.exe 通过窗口消息/共享内存通信）
26. **Everything SDK 有进程级全局状态**：所有查询通过全局 C 静态变量串行，同一进程只能同时一个查询，必须持全局互斥锁（`sdk::sdk_lock`）；查询同步阻塞，放 `spawn_blocking` 后台线程
27. **动态加载 DLL 用 GetProcAddress 而非静态链接**：Everything64.dll 在 resources 目录（运行时路径不定），静态链接 lib 会找不到 DLL；用 `LoadLibraryW` + `GetProcAddress` 动态解析函数指针，`FARPROC` 转具体签名用 `std::mem::transmute_copy`（`transmute` 对泛型 T 报 E0512 无法固定大小）
28. **Everything 官方安装器不写 App Paths 注册表**：只写 Uninstall 键（`HKLM\SOFTWARE\...\Uninstall\Everything` 的 `InstallLocation`）。检测是否安装查 App Paths 会误判为「未安装」（即使 Everything 正在运行）。可靠做法：App Paths → Uninstall InstallLocation → 常见安装目录 三路兜底（`search::find_everything_exe`）；真实探测测试 `real_find_everything`（#[ignore]）
29. **不要靠注册表判断「能否搜索」**：Everything 有便携版/绿色版（不写任何注册表），装在任意目录也能用。判断搜索可用性的**唯一可靠信号是运行探测**——SDK 查询成功 = 已安装且正在运行（SDK 经窗口消息/共享内存与 Everything.exe 通信）。因此 `search_get_status` 只返回 running（查询探测），不再区分「未装/未运行」，前端引导卡统一提示 + 下载/启动/重测三按钮。注册表 `find_everything_exe` 仅用于「尝试自动启动」
30. **DeepSeek 余额接口带赠送/充值字段**：`/user/balance` 的 `balance_infos` 里每货币还有 `granted_balance`/`topped_up_balance`（赠送/充值），别只取 `total_balance`；字段可能缺失，解析用 `Option<String>`，缺失默认 0
31. **告警判定要在覆盖状态前取快照**：`fetch_deepseek` 里 `status.last_balance` 若先被新值覆盖再判 `should_recover` 会新旧混淆永不触发；先 `let prev = status.last_balance;` 捕获旧值，warn/recover 都用 prev 计算
32. **秒级倒计时用独立小组件**：整页每秒 setState 会让图表/拖拽容器频繁重渲染；抽成自持 interval 的 `Countdown` 小组件（只重渲染自身），`fmtCountdown` 保持纯函数
33. **额度历史改用 SQLite（quota.db）**：`balance_history`/`go_snapshots`/`go_cycles` 三表 + WAL + busy_timeout；旧 `balance_history_<id>.json` 启动时**幂等导入**（db settings 表记 `json_imported_<id>` 标记，旧文件保留不删），统计纯函数与存储解耦
34. **多 Mutex 锁顺序必须一致**：额度模块 `fetch_once`/`restore_from_db` 都按「QuotaState → QuotaDb」顺序加锁；任何反向加锁（先 db 后 state）都会死锁。跨函数只取一把锁时（如只读 db 的命令）也要保持一致习惯
35. **useWindowEntrance 动画会让 `fixed` 失效**：入场动画（`zoom-in-95` 等）带 transform + `animation-fill-mode`，使 `position: fixed` 子元素相对动画容器（而非视口）定位。浮层/抽屉遮罩改用页面根节点 `relative` + `absolute inset-0` 代替 `fixed`，避开包含块陷阱
36. **新增 Tauri 命令必须注册进 `generate_handler!`**：只写 `#[tauri::command]` 函数不注册，前端 invoke 会静默失败（Promise reject，无日志），表现为「操作无效 + UI 回弹」。排查前端调用失败先查 `src-tauri/src/lib.rs` 的 `invoke_handler` 列表
37. **无限滚动 = 滚动容器必须绑 `onScroll`**：写了 `loadMore`/`onScroll` 但没把 `onScroll` 挂到 `overflow-y-auto` 容器上 = 永不触底加载，只显示第一页 + 计数严重不符。新增分页列表时检查滚动容器有没有 `onScroll`（TS6133「声明未使用」常是这个信号）
38. **onScroll 触发式加载在全屏/大窗口下有死锁**：第一页（如 100 条）撑不满超高视口时无滚动 → `onScroll` 永不触发 → 永远只显示第一页。兜底：结果变化后检查容器 `scrollHeight - clientHeight < 阈值` 就自动继续 `loadMore` 直到填满/加载完；隐藏容器 `clientHeight === 0` 要跳过，否则 keep-alive 切走的标签页会静默狂拉数据
39. **Everything 后台启动用 `-startup` 参数**：直接 `spawn Everything.exe` 会弹主窗口（突兀）。加 `.arg("-startup")` 让它最小化到系统托盘启动（Everything 官方文档：Start minimized in the system tray），实现无感后台启动（`search::ensure_everything_running`）
40. **不要在持锁状态下做耗时 I/O**：`fetch_once` 曾在持有 `QuotaState` 锁时做网络请求（每个账户最长 15s 超时，多账户串行）→ 前端 `get_status`/`save_settings` 阻塞几十秒像卡死。网络请求必须移到锁外（先取数，再锁内应用结果），锁内只做内存/DB 快操作
41. **剪贴板监听线程持 DB 锁做图片编码会阻塞前端查询**：`save_from_clipboard` 曾在持有 `db` 锁时做 PNG 编码 + 缩略图生成 + 磁盘写入（CPU/IO 密集），期间 `get_history`/`pin_item` 全部排队。锁内只做入库拿 id，图片落盘放锁外，回填路径再短锁
42. **热键注册用 `unregister_all` 会注销全部热键**：`set_hotkey`/`search_set_hotkey` 里「注册新键→unregister_all→只重注册自己的」会让剪贴板/搜索等其它模块热键全部失效（unregister_all 是全局的，不是只清同名键）。正确顺序：先注册验证 → 写入 config → 调 `reapply_hotkeys`（按新 config 整体重注册）。主窗口 `set_main_hotkey` 同理；非统一模式下主热键根本不注册，应直接拒绝
43. **热键匹配不要每次按键都解析 + 持配置锁**：全局热键 handler 每次按键都 `Shortcut::from_str` 解析 4 个热键字符串并全程持锁。把解析结果缓存到 `ResolvedHotkeys`（`reapply_hotkeys` 时重建），handler 只读缓存比较，避免高频事件下反复分配 + 锁竞争
44. **useState 里 `setState(prev => prev)` 等于没做防抖**：`onSearchChange` 里 setTimeout 包一层 `setSearch(prev => prev)` 值不变不触发重渲染，防抖失效、每次按键立即全量加载。防抖要把「值更新」放进 setTimeout
45. **Canvas 像素检测别在渲染期同步跑**：`SmartEmoji` 用 `useMemo` 同步做 64×64 canvas 逐像素扫描，首屏几百个不同 emoji 会卡。改为 useState 初始读缓存（未命中先按支持显示字符）+ `requestIdleCallback` 异步检测后 setState，不阻塞首帧
46. **keep-alive 模块切回不要全量重载 + 逐字符检测要分片**：表情页「每次激活重载数据 + 重建 1906 对象 + 重渲染」且缓存冷时 `requestIdleCallback` 会连续跑 144+ 次 canvas 检测（每次新建 context + 4096 像素扫描 + 全量 localStorage 写）→ 切回卡 200ms+。修复：切回不重载改窗口 `focus` 刷新（同搜索页）；检测复用共享 canvas + 每帧 rAF 分片（24 个/帧）+ localStorage 防抖写（一批只写一次）。判定依据：日志里 `loadCatalog` 4~18ms 很快，而 `first paint after cat` 尖峰 212~262ms，量级正好 ≈ 144 × 单字符检测 ~1.5ms
47. **去掉激活重载会造成 keep-alive 页面数据过期**：表情页把「切回就重载」换成「窗口 focus 刷新」后，主窗口内**切 Tab（剪贴板→表情）不触发 focus** → 右键剪贴板图片「添加表情」后收藏里看不到新表情（DB 已写入，是前端没刷新）。正确做法：**激活刷新要保留**（检测分片后已很便宜 ~5ms，不再卡），focus 刷新只作为补充覆盖「停留页面时外部操作变脏」的场景。排查「操作后不显示」先查 DB 确认是否写入成功，再查前端刷新时机
47. **窗口「focus 刷新」对呼出场景是并发风暴**：表情页「窗口聚焦时 loadCatalog 刷新」本身没问题，但快捷键呼出时 WebView2 的 focus 事件会连发多次（日志可见单次呼出后 `loadCatalog` 2~6 次连续执行），且每次 `setCat` 传新对象都会重渲染 240 个表情 → 并发重载互相叠加，`loadCatalog` 尖峰 400ms+、`first paint` 250ms+，窗口像冻结。修复两处：`loadCatalog` 加 in-flight 合并（并发调用共享同一 Promise，谁先发起谁执行，其余等同一结果；同一对象 setCat React 跳过重渲染）；焦点刷新加 150ms 防抖（连续 focus 只保留最后一次）。教训：**「按需刷新」也要考虑事件风暴 + 提供合并/防抖**，否则刷新本身就是卡顿源
48. **主窗口内嵌子 WebView（多 webview）**：① 建子 WebView 用 `Window::add_child(builder, pos, size)`——Windows 上 `WebviewBuilder::build` 在同步命令/事件处理器会死锁，涉及建窗的命令必须声明 `async fn`；② `WebviewBuilder` 重导出与 `add_child` 都被 `tauri` 的 `unstable` feature 门控（Cargo.toml 需加 `features = ["unstable"]`，官方多 webview 标准做法，不影响现有行为）；③ 子 WebView 是远程内容拿不到 Tauri IPC，天然安全，无需 capabilities；④ 子 WebView 不在 DOM 里，模块 keep-alive 用 `hidden` class 隐藏容器盖不住它，切走/卸载必须显式 `hide()`；⑤ 定位 = 容器 `getBoundingClientRect()` × `devicePixelRatio` 物理像素，ResizeObserver + window resize 防抖重发；⑥ `get_webview`/`get_window` 在内部 trait 上，`WebviewWindow` 拿不到——`add_child` 返回的 `Webview` 存进模块 state 供后续命令取用；⑦ 导航幂等：比对 `last_url`，URL 未变不重复 navigate（切走再切回不整页重载）。详见 lessons ##70

---

## 按日期记录

### 额度监控 UI 优化：赠送/充值明细、三级徽章、秒级倒计时、恢复通知、燃尽率

**问题描述**：参考 onWatch 优化额度监控模块 UI 与告警，共 5 项改动：DeepSeek 卡片补赠送/充值明细、状态徽章分三级、Go 卡片倒计时秒级刷新、余额恢复通知、DeepSeek 卡片显示「按近期日均可用约 N 天」。

**方案**：
- `api.rs`：`Balance` 结构加 `granted`/`topped_up`，`parse_balance` 解析 `granted_balance`/`topped_up_balance`（缺失默认 0）
- `mod.rs`：`AccountStatus` 加两字段并透传；`fetch_deepseek` 用 `prev` 快照同时判定 warn/recover，新增恢复通知「✅ 余额恢复」
- `alerts.rs`：新增纯函数 `should_recover`（prev < 阈值 && cur >= 阈值）+ 单测
- `QuotaPage.tsx`：`DeepseekCard` 显示赠送/充值 + 燃尽率；`AccountBadge` 三级（不足/偏低/正常）；`Countdown` 小组件秒级刷新

**关键点**：
1. 告警判定必须用更新前的 `last_balance` 快照（prev），否则 recover 永远不触发
2. 秒级倒计时不能整页每秒 setState，用独立小组件隔离重渲染
3. 前端统计（`get_stats_data`）只对选中账户加载，燃尽率只在选中账户卡片显示（未选账户 avg7 传 0 不渲染）

**教训**：告警/状态机类逻辑的「旧值判定」要在写入新值前完成；纯函数判定（alerts.rs）+ 隔离重渲染（Countdown）保持可测、可复用。

**相关代码**：
- `src-tauri/src/modules/quota/api.rs` / `mod.rs` / `alerts.rs` / `commands.rs`
- `src/modules/quota/QuotaPage.tsx`

---

### 额度监控数据落 SQLite + Go 周期/趋势 + 紧急阈值

**问题描述**：参考 onWatch 把额度监控升级：余额历史从 JSON 迁到 SQLite，新增 Go 快照落盘、Go 重置周期检测、利用率趋势图、卡片点击展开、DeepSeek 紧急阈值、重启回填。

**方案**：
- 新增 `db.rs`：`QuotaDb`（WAL + busy_timeout）三表 `balance_history`/`go_snapshots`/`go_cycles` + `settings`
- `history.rs` 持久层从 JSON 换 SQLite（`load/append` 改收 `&QuotaDb` + account_id），纯统计函数与测试保留
- 启动时 `import_json_history`（幂等，settings 标记）+ `restore_from_db`（回填最新余额/Go 快照）
- `fetch_go` 每次轮询写快照 + `track_go_cycle` 周期检测（用量骤降或 resetsAt 已过 → 关旧周期开新周期，记峰值/总消耗）
- 新增命令 `get_go_history`/`get_go_cycles`；`critical_threshold` 配置（默认预警/2）+ 前端徽章三档（红=告急/橙=偏低/绿=正常）+ 设置页输入框
- 前端 `MiniDailyBars`（DeepSeek 展开柱状图）、`GoSparkline`（Go 展开 SVG 趋势图）

**关键点**：
1. `QuotaDb` 单独 `app.manage(Mutex<QuotaDb>)`，`QuotaState` 保持 `Default`；锁顺序统一「QuotaState → QuotaDb」
2. JSON→SQLite 迁移幂等（db settings 表 `json_imported_<id>`），旧文件保留不删，零丢失
3. 周期检测用「当前窗口最新快照 vs 上一份」：`used_percent` 下降或 `resets_at` 已过视为窗口重置
4. 前端 Go 趋势图 `preserveAspectRatio="none"` + `vectorEffect="non-scaling-stroke"` 拉伸不糊

**教训**：持久化层与纯计算解耦（history 纯函数可测）；多 Mutex 加锁顺序一致性是死锁防护的根；迁移要幂等 + 保留旧数据。

**相关代码**：
- `src-tauri/src/modules/quota/db.rs`（新）/ `history.rs` / `mod.rs` / `commands.rs`
- `src/modules/quota/QuotaPage.tsx` / `QuotaSettings.tsx`
- `src-tauri/src/lib.rs`（注册 `get_go_history`/`get_go_cycles`）

---

### 额度监控面板重构：去 dnd 拖拽、摘要条、设置抽屉、文件拆分

**问题描述**：QuotaPage.tsx 经 6 轮增量修改膨胀到 741 行，出现历史图表双入口、信息层级混乱、账户选择器分散、dnd 大块拖拽低价值、设置整页切换、无整体摘要等问题。

**方案**：
- 去掉 dnd-kit 大块拖拽（`SortableBlock`/`panel_order` 及后端命令全删）
- 新增 `quota-summary.tsx` 摘要条（总余额/告急/偏低/Go 窗口，纯前端计算）
- 历史图表统一进卡片展开：DeepSeek 卡自取 `get_stats_data` 算燃尽率（不再依赖父级选中账户），`MiniDailyBars`/`GoSparkline` 保留
- 设置改侧滑抽屉（页面根节点 `relative` + 遮罩/抽屉 `absolute`），不整页替换
- 文件拆分：`QuotaPage.tsx`（布局+状态）/ `quota-cards.tsx`（卡片+图表+公共工具）/ `quota-summary.tsx`（摘要）

**关键点**：
1. `fixed` 在 `useWindowEntrance` 动画容器内失效（transform 包含块），抽屉用 `absolute`
2. 卡片自取数据（DeepseekCard 挂载时 `get_stats_data`）使组件自包含，删掉父级选中账户联动
3. 删 dnd 后同步删除后端 `get_panel_order`/`save_panel_order` 命令 + lib.rs 注册，避免死代码

**教训**：增量叠加会让单文件腐化，到"重排两块就得改十处"就该重构；UI 浮层定位要考虑动画容器的 transform 包含块；删前端特性时同步清理后端死命令。

**相关代码**：
- `src/modules/quota/QuotaPage.tsx`（重写）/ `quota-cards.tsx`（新）/ `quota-summary.tsx`（新）
- `src-tauri/src/modules/quota/commands.rs`（删 panel_order）/ `src-tauri/src/lib.rs`（删注册）

---

### 设置面板统一抽屉式：共享 Drawer 组件

**问题描述**：额度监控改成设置抽屉后与其他模块（整页替换）不一致。用户选定抽屉式，需把剪贴板/表情/搜索的设置也统一成抽屉。

**方案**：
- 新增共享 `src/components/ui/drawer.tsx`（遮罩 + 右侧 420px 抽屉 + 标题 + 关闭按钮），四模块复用
- 每个模块根节点加 `relative`，抽屉用 `absolute`（避开 useWindowEntrance 动画 transform 包含块）
- 把 `{showSettings ? (<设置/全页>) : (主内容)}` 改成「主内容常显 + 末尾挂 `<Drawer open>`」；大 fragment 分支拆开时保留 `<>...</>` 包裹，只在闭合处挂 Drawer

**关键点**：
1. `fixed` 在动画容器内失效 → 抽屉统一 `absolute`（根节点 `relative`）
2. 改造大 fragment 三元：把开三元 `{showSettings ? (...) : (<>` 整体换成 `<>`，删掉多余 `)}`，Drawer 加在 fragment 闭合之后
3. 搜索/剪贴板设置按钮本来就只在 `!popup`（主窗口）显示，弹窗不受影响

**教训**：跨模块统一交互时抽共享组件避免四处复制；改「三元换抽屉」时先定位 fragment 闭合，避免大括号错乱；并行会话在改的文件（SearchView 的 LucideIcon 等错误）不动，避免冲突。

**相关代码**：
- `src/components/ui/drawer.tsx`（新，共享）
- `src/modules/quota/QuotaPage.tsx` / `src/modules/clipboard/Clippage.tsx` / `src/modules/emoji/Page.tsx` / `src/modules/search/SearchView.tsx`

---

### 文件搜索模块新增：Everything SDK 集成（DLL 动态加载）

**问题描述**：为 EasyTool 新增 `search` 文件搜索模块（Everything 后端），过程中踩了 4 个关键坑。

**根本原因**：
1. `#[tauri::command]` 宏按函数名生成符号，与 clipboard/quota 的同名命令冲突；
2. `Everything64.dll` 导出名带 W 后缀，与头文件宏定义（UNICODE 下自动映射）不一致；
3. 官方 SDK DLL 不随 Everything 安装包附带，需单独下载；
4. 进程级全局状态 + 同步阻塞查询需要串行化。

**解决方案**：
1. 命令函数名带 `search_` 前缀（`search_get_status`/`search_open_file` 等），Tauri 命令名 = 函数名；
2. `GetProcAddress` 用完整导出名 `Everything_SetSearchW` 等；
3. 从 voidtools 官方 `Everything-SDK.zip` 下载 `Everything64.dll` 打包进 `modules/search/`；
4. `sdk::sdk_lock()` 全局互斥锁 + `spawn_blocking` 后台执行。

**教训**：动态链接 DLL 时符号名要核对 DLL 真实导出（可先用 `dumpbin /exports` 或真实探测测试验证）；Tauri 多模块要避免命令函数名全局冲突。

**相关代码**：
- `src-tauri/src/modules/search/`（sdk/commands/mod）
- `src/modules/search/`（SearchView/SearchSettings/Page/Popup）
- `src/search_popup.tsx`、`search_popup.html`
- `src-tauri/modules/search/`（manifest.json + Everything64.dll）
- 联动：`src-tauri/src/modules/clipboard/mod.rs` 新增 `record_file_to_history`

---

### 表情模块新增：数据源、并发开发、死代码

**问题描述**：新增 emoji 模块过程中遇到三类问题：1) 与另一个窗口的开发会话并发改同一批文件（`pub mod emoji;` 被临时注释、lib.rs 热键被重写）；2) 计划里设计的后端 `search` 函数实际没人调用；3) 计划写的过程中用 PowerShell 改写 md 导致中文乱码。

**根本原因**：
1. 项目允许多个 AI 会话/窗口并行开发不同模块，都落在 `lib.rs`/`modules/mod.rs` 等共享文件上；
2. Emoji 全量数据在前端内存过滤足够快，后端检索函数是投机扩展；
3. 违反 module-guide 坑 1（用 PowerShell `Get-Content`/`Set-Content` 改写 UTF-8 文件）。

**解决方案**：
1. 开发前 `git status` + 提交前 `cargo build` 双重确认；被注释的模块声明恢复；接受共享文件内他人改动随自己 commit 一起进（告知用户）；
2. 删除 `data::search`/`groups`/`keywords` 字段及对应测试（YAGNI），只留 `load`；
3. 用编辑器 write 工具重建损坏的计划文件。

**教训**：并发开发要勤看 `git status`；不要为"可能用到"写抽象（前端本地过滤够用）；UTF-8 文件禁用 PowerShell 改写。

**相关代码**：
- `src-tauri/src/modules/emoji/`（新模块：db/data/commands/paste/mod）
- `tools/gen-emoji.mjs`（数据生成脚本）
- `src/modules/emoji/`（Page/Settings/Popup）
- `docs/superpowers/specs/2026-08-20-emoji-module-design.md`、`docs/superpowers/plans/2026-08-20-emoji-module.md`

---

### 虚拟列表导致文本卡片重叠

**问题描述**：软件窗口宽度调小后，文本自动转行，剪贴板的文本卡片会重叠。

**根本原因**：使用 `@tanstack/react-virtual` 的 `VirtualList` 组件时，设置了固定的 `estimateSize={80}` 来估算每个卡片高度。当文本内容转行后，实际高度超过 80px，但虚拟列表仍然按 80px 间距排列，导致重叠。

**解决方案**：移除虚拟列表，恢复为普通 `<ul>` 列表渲染。剪贴板条目通常不多（默认最大 500 条），不需要虚拟列表优化。

**教训**：
1. 虚拟列表适用于**固定高度**或**高度可预测**的列表项（如图片网格、文件列表）
2. 对于**高度动态变化**的内容（如文本自动转行），虚拟列表需要使用 `measureElement` 动态测量，或者直接不使用虚拟列表
3. 引入优化组件前，先评估是否真正需要——过度优化反而引入新问题

**相关代码**：
- `src/modules/clipboard/Clippage.tsx` - 文本卡片渲染
- `src/components/VirtualList.tsx` - 虚拟列表组件（已创建但未使用）

---

### 模块关闭后后台线程仍运行

**问题描述**：在设置面板关闭模块后，后台线程（剪贴板监听、额度轮询）仍持续运行，浪费 CPU/IO/网络资源。

**根本原因**：后台线程在启动时创建，运行无限循环，不检查 `enabled` 配置标志。只有在启动时判断模块未启用才不创建线程。

**解决方案**：在后台线程循环中添加 `enabled` 检查：
- 剪贴板模块：在 `poll_thread` 和 `process_clipboard_change` 中检查 `crate::clipboard_enabled(app)`
- 额度模块：在 `poll_loop` 中检查 `crate::quota_enabled(&app)`
- 禁用时跳过所有操作，线程仅做 sleep + 配置读取

**教训**：
1. 模块的"关闭"应该包含两个层面：UI 层面（侧边栏不显示）和功能层面（后台任务停止）
2. 后台线程需要感知模块的启用/禁用状态，否则会造成资源浪费
3. "软停止"（跳过工作但线程不退出）比"硬停止"（发送停止信号、join线程）更简单，适合此场景

**相关代码**：
- `src-tauri/src/modules/clipboard/monitor.rs` - 剪贴板监听线程
- `src-tauri/src/modules/quota/mod.rs:185-209` - 额度轮询线程
- `src-tauri/src/lib.rs` - `clipboard_enabled()` / `quota_enabled()` 函数

---

### 托盘没有图标

**问题描述**：软件运行后，系统托盘区域没有显示图标。

**根本原因**：`TrayIconBuilder::new()` 没有调用 `.icon()` 方法设置图标。Tauri 2 中托盘图标必须显式设置，不会自动使用窗口图标。

**解决方案**：在 `build_tray` 函数中添加 `.icon(app.default_window_icon().cloned().expect("no window icon"))`。

**教训**：
1. Tauri 2 的 `TrayIconBuilder` 不会自动继承窗口图标，必须显式调用 `.icon()` 设置
2. 可以使用 `app.default_window_icon()` 获取 `tauri.conf.json` 中配置的窗口图标

**相关代码**：
- `src-tauri/src/lib.rs:80-105` - `build_tray` 函数

---

### 启动时闪现剪贴板弹窗（升级方案）

**问题描述**：初次修复（`.visible(false)`）后，启动时仍会闪现一个尺寸不对的窗口然后消失。

**根本原因**：`.visible(false)` 不能完全阻止 Windows WebView2 窗口在**创建初始化期间**短暂可见（WebView2 环境初始化时窗口会短暂显示）。且弹窗抢焦点后失焦，触发 `hide_after_blur_grace` 导致"闪现→消失"。

**解决方案**：改为**延迟创建**——启动时完全不创建弹窗窗口，首次按热键呼出时才创建（`ensure_popup_window`）。窗口创建时本来就要显示，不存在闪现问题，同时减少启动开销（WebView2 窗口创建很重）。

**教训**：
1. `.visible(false)` 在 Windows WebView2 上**不能保证**窗口创建期间不闪现
2. 根治"启动闪现"的最可靠方案是**延迟创建**：需要时才创建窗口
3. 隐藏窗口 + 失焦自动隐藏逻辑叠加，会把"闪现"放大成"闪现→消失"的明显现象

**相关代码**：
- `src-tauri/src/modules/clipboard/mod.rs` - `ensure_popup_window` 延迟创建弹窗
- `src-tauri/src/lib.rs` - setup 中不再创建弹窗

---

### 窗口呼出动画实现

**问题描述**：窗口通过热键呼出时直接闪现，希望增加淡入/缩放等过渡动画。

**方案**：Tauri 2 无窗口级动画 API，改为前端 CSS 动画实现：
1. 新建 `src/lib/use-window-entrance.ts` hook：监听窗口 `onFocusChanged` 事件，窗口聚焦时通过 `classList.remove` → 强制 reflow → `classList.add` 重放 CSS animation
2. 弹窗（Clippage）：`animate-in fade-in-0 duration-150`（纯透明度，避开 scale 变形坑）
3. 主窗口（App）：根 wrapper `animate-in fade-in-0 zoom-in-95 duration-150`
4. 模块切换：`<main key={active}>` 重挂载 + `fade-in slide-in-from-right-2`

**关键点**：
- 窗口 hide 后 webview 继续运行，show 时页面不会重新加载，CSS 动画不会自动重播
- 必须监听窗口聚焦事件手动重置动画（remove class → offsetWidth 强制 reflow → add class）
- 首次挂载时也要手动播放一次（应用启动窗口已显示的场景）
- **不要重挂载整个 App 根节点触发动画**（会导致子组件状态全部丢失、重新加载数据）；用内部 wrapper 或重放技巧

**相关代码**：
- `src/lib/use-window-entrance.ts` - 动画重放 hook
- `src/App.tsx` - 主窗口 + 模块切换动画
- `src/modules/clipboard/Clippage.tsx` - 弹窗动画

---

### 窗口呼出动画闪烁（先显示界面再补动画）

**问题描述**：快捷键呼出主界面时，先显示完整界面框架，随后才播放动画，产生「闪烁」突兀感。

**根本原因**：窗口 hide 后 webview 继续运行，页面已渲染到动画完成态（不透明）。show 窗口瞬间用户看到的是不透明完整界面；随后 focus 事件才触发动画重放——先把内容重置为透明再淡入，形成「先亮 → 变透明 → 再淡入」的跳变。

**解决方案**：`useWindowEntrance` 改为双向状态管理：
- 窗口**失焦/隐藏**时 → 把内容重置为透明初始态（`opacity: 0`）
- 窗口**聚焦/呼出**时 → 从透明态播放动画（淡入 + 缩放）
- 首次挂载：先设透明，仅当窗口已聚焦才播放一次（避免与 focus 事件重复播放）

这样窗口 show 出来的第一帧就是透明的，动画与显示同步，无闪烁。

**教训**：
1. 动画「触发时机」晚于「窗口显示时机」必然产生先显示后补动画的闪烁，必须让窗口显示瞬间就处于动画初始态
2. 隐藏期间保持透明初始态，是「动画与显示同步」的关键
3. 避免 mount 播放 + focus 事件重复播放：mount 时用 `isFocused()` 判断是否立即播放

**相关代码**：
- `src/lib/use-window-entrance.ts` - 失焦重置透明 + 聚焦重放

---

### 拖动窗口时入场动画闪烁

**问题描述**：拖动主窗口时，页面动画会反复重放/闪烁。剪贴板弹窗（自定义拖拽区）同样受影响。

**根本原因**：`useWindowEntrance` 监听 `onFocusChanged`，但焦点事件无法区分「窗口真正隐藏」和「拖动/切焦点导致的短暂失焦」。Windows 上拖动窗口会触发失焦→聚焦，导致：失焦→内容透明化，聚焦→重放动画 = 闪烁。

**解决方案**：用 `isVisible()` 区分失焦类型：
- 失焦时延迟 250ms 检查 `isVisible()`，仅当窗口确实不可见（隐藏）才重置透明
- 聚焦时仅当窗口「从隐藏变为可见」才播放动画；窗口一直可见（拖动恢复）不播放
- 初始化：窗口可见则直接播放（启动场景），不可见（延迟创建的弹窗）则标记隐藏等 show 时播放

**教训**：
1. 焦点事件 ≠ 窗口可见性：拖动/切换焦点都会触发失焦，不能把「失焦」当「隐藏」
2. 动画触发条件要用「隐藏→可见」的状态转变判断，而不是每次聚焦都播放
3. 用 `isVisible()` 查询做状态守卫，区分真实隐藏与短暂失焦

**相关代码**：
- `src/lib/use-window-entrance.ts` - isVisible 状态守卫

---

### 额度监控多账户支持改造

**问题描述**：额度监控只支持单个 DeepSeek key 和单个 OpenCode Go key，无法满足多账户需求。

**方案**：
- 配置新增 `accounts` 数组（id/kind/name/key_ref），旧配置自动迁移出默认 deepseek + opencode-go 两个账户
- keyring 槽位按账户派生（key_ref 兼容旧槽位名，旧密钥不丢失）
- QuotaState 从单账户改为账户数组，`fetch_once` 遍历所有账户查询
- 历史记录按账户分文件（`balance_history_{id}.json`），消费统计互不干扰
- 前端设置页支持账户增删改 + 每账户密钥管理，主页每账户一张卡片

**关键点**：
1. **schema 迁移顺序坑**：SQLite 建索引必须在对应列添加之后。`idx_items_pinned_order` 引用 `pin_order` 列，该列在版本迁移（v2）中才添加，索引创建必须在迁移之后，否则测试环境（schema_version=0）建库直接失败
2. **旧数据迁移**：旧单文件 `balance_history.json` 需复制为默认账户的 `balance_history_deepseek.json`，否则老用户消费历史丢失
3. **后端接口签名变化**：`get_stats_data`/`get_daily_history` 增加 `account_id` 参数，前端统计需随选中账户联动

**教训**：
1. 功能扩展涉及数据结构变更时，必须考虑旧数据/旧配置的平滑迁移，且迁移要幂等
2. 加数据库索引前确认列一定已存在（建表 or 迁移后），不要假设建表语句包含所有列

**相关代码**：
- `src-tauri/src/modules/quota/mod.rs` - 账户模型 + 遍历查询
- `src-tauri/src/modules/quota/commands.rs` - 账户增删改命令
- `src-tauri/src/modules/quota/history.rs` - 历史存储（按账户分文件）
- `src/modules/quota/QuotaPage.tsx` / `QuotaSettings.tsx` - 前端多账户 UI

---

### 窗口尺寸记忆保存 0x0 导致窗口启动后极小

**问题描述**：应用启动后主窗口极小几乎看不见，拖大后正常。托盘图标在，但窗口「不显示」像卡死。

**根本原因**：窗口隐藏/最小化时 WebView2 触发 `onResized` 事件，`payload.width/height` 报 0x0；前端防抖 400ms 后把 0x0 保存进 `config.json` 的 `main_size`。下次启动 setup 用 `set_size(0, 0)` 恢复尺寸——而 `set_size` 编程调用可绕过 `minWidth/minHeight`（该限制只在用户鼠标拖拽时生效），窗口就变成极小、几乎不可见，误以为程序卡死。

**解决方案**（三层防护）：
1. 前端 `onResized` 回调过滤 0/小于最小尺寸的值（<400x300 不保存）
2. 后端 `save_main_size` 命令校验最小尺寸（小于 400x300 直接忽略）
3. 后端 setup 恢复尺寸时校验最小尺寸（脏数据用默认 960x640）

**教训**：
1. 窗口最小尺寸（minWidth/minHeight）只约束用户拖拽，编程 `set_size` 不受限制，恢复尺寸时必须自行校验
2. 窗口隐藏/最小化会触发 resize 事件并报告 0x0，尺寸记忆功能必须过滤脏数据
3. 排查「窗口不显示」类问题，先查配置里的窗口尺寸等持久化状态，不一定是代码卡死

**相关代码**：
- `src/App.tsx` - onResized 过滤 0 尺寸
- `src-tauri/src/config.rs` - save_main_size 校验
- `src-tauri/src/lib.rs` - setup 恢复尺寸校验

---

### 多账户密钥串号 + 账户名称显示密钥

**问题描述**：
1. 添加账户时输入密钥，账户名称显示为密钥形式（sk-...），不美观且暴露密钥
2. 添加第二个 OpenCode 套餐后，两个账户数据完全一致，共用同一套密钥（DeepSeek 同样存在此问题）

**根本原因**：
1. 添加账户 UI 名称框可被误填密钥，且后端无序号名称，名称默认就是密钥文本
2. **密钥槽位串号**：新增账户 `key_ref` 为空，`keyring_user()` 按 kind 回退到旧槽位（go→`opencode-go`，deepseek→`deepseek`），所有同类新增账户共用同一 keyring 槽位 → 数据串号

**解决方案**：
1. 后端 `add_account`：名称留空自动编号（OpenCode Go 2 / DeepSeek 2）；新账户 `key_ref` 分配独立槽位 `quota-{id}`，绝不复用旧槽位
2. 新增 `migrate_account_keyrefs()`：key_ref 为空的非默认账户启动时迁移到独立槽位（旧密钥复制过去），幂等
3. 前端添加账户名称提示「留空自动编号」

**教训**：
1. 密钥/凭据存储槽位必须按实体唯一分配，任何「按类型 fallback 到固定槽位」的逻辑都会导致同类实体串号
2. 名称类字段要有默认值生成逻辑，避免用户误填敏感内容；敏感信息与展示名严格分离
3. 迁移逻辑要幂等（已迁移的跳过），并在启动初始化阶段执行

**相关代码**：
- `src-tauri/src/modules/quota/commands.rs` - `add_account` 独立槽位 + 自动编号
- `src-tauri/src/modules/quota/mod.rs` - `migrate_account_keyrefs` 槽位迁移
- `src/modules/quota/QuotaSettings.tsx` - 添加账户名称提示

---

## 2026-08-19

### 剪贴板「查看大图」无反应 → 改为应用内预览

**问题描述**：右键图片 → 查看大图，完全没反应（系统看图软件也不弹出）。

**根本原因**：原实现调用 `openPath`（plugin-opener）打开图片文件，依赖系统默认看图软件。该调用在此环境下静默失败（无错误日志、无报错）。且用户期望的是应用内弹窗预览大图，而非调用外部看图软件——功能方向本身就不符合预期。

**解决方案**：改为应用内覆盖层预览：
- image 类型复用现成的 `get_image` 命令取原图 base64；
- files 图片类型复用现成的 `get_file_preview` 命令（最长边 1024，`file_preview_png` 已有缓存）——无需新增后端代码；
- 前端新增全屏遮罩覆盖层（z-[60]），点遮罩 / Esc / 关闭按钮关闭，加载中显示 spinner。

**教训**：
1. 涉及"打开/预览"类功能，先确认用户期望是应用内展示还是调用外部程序，方向错了整个功能都是无效功；
2. 排查"点了没反应"类问题，先区分是后端命令失败、IPC 失败、还是前端逻辑没走到——本次前端 invoke 调用链正确、后端命令正常，最终定位到 openPath 外部调用静默失败 + 需求方向不符；
3. 找现成能力优先：`file_preview_png`（最长边 1024）早已存在并已注册为 `get_file_preview` 命令，只差前端接线，避免重复造轮子。

**相关代码**：
- `src/modules/clipboard/Clippage.tsx` - `viewImage` 改为应用内预览 + 覆盖层 UI
- `src-tauri/src/modules/clipboard/file_icons.rs` - `file_preview_png`（复用，未改动）

---

## 2026-08-19

### vite 端口 1420 启动报 EACCES（Windows 动态端口排除范围占用）

**问题描述**：`npm run tauri dev` 启动 vite 时报 `listen EACCES: permission denied ::1:1420`，且端口查询显示空闲。

**根本原因**：Windows 的 Hyper-V/WSL 会动态保留一段 TCP 端口范围（`netsh interface ipv4 show excludedportrange protocol=tcp` 显示 1331-1430 被排除）。1420 落在保留范围内，普通进程无法绑定，报 EACCES。即使端口显示"空闲"也绑不上。

**解决方案**：把开发端口从 1420 改到不在排除范围的 14200，同步修改两处：
- `vite.config.ts` - `server.port`
- `src-tauri/tauri.conf.json` - `build.devUrl`

**教训**：
1. `listen EACCES` 在 Windows 上先查 `netsh interface ipv4 show excludedportrange protocol=tcp`，端口"空闲"≠"可绑定"；
2. 端口被排除范围吞掉时，换端口比重启/改防火墙更可靠（排除范围随 Hyper-V/WSL 状态动态变化）；
3. 排错用最小验证：`node -e` 起 net server 分别试绑 `::1` 和 `127.0.0.1`，能快速区分 IPv6 问题 vs 端口被占用。

**相关代码**：
- `vite.config.ts` - `port: 14200`
- `src-tauri/tauri.conf.json` - `devUrl: http://localhost:14200`

---

## 2026-08-20

### 模块拖拽排序松手回弹 → 新 Tauri 命令没注册进 generate_handler

**问题描述**：设置页新增模块拖拽排序，拖动后松手又回到原位。

**根本原因**：新增的 `set_module_order` 命令只写了 `#[tauri::command]` 函数，没加进 `lib.rs` 的 `generate_handler!`。前端 `invoke("set_module_order")` 返回未注册命令错误，`onReorder` 里 `await` 抛出未捕获异常，config 未更新，@dnd-kit 因 items 没变回弹原位。

**解决方案**：`lib.rs` `generate_handler!` 补注册 `config::set_module_order`。

**教训**：
1. 新增 Tauri 命令三处联动：函数 + `generate_handler!` 注册 + 前端 invoke 名一致，漏注册表现为前端静默失败；
2. @dnd-kit「松手回弹」常是 onDragEnd 里数据源没同步更新（这里因 IPC 报错没走到 setState），排查先确认 onDragEnd 是否真正执行、异步调用是否报错。

**相关代码**：
- `src-tauri/src/lib.rs` - `generate_handler!` 补 `config::set_module_order`
- `src-tauri/src/config.rs` - `set_module_order`

---

## 2026-08-20

### 文件搜索只显示第一页 100 条 → 无限滚动 onScroll 未绑定滚动容器

**问题描述**：搜索框输入 "A"，顶部显示海量总数，但结果面板只渲染有限数量（约 100 条），滚动到底不再加载，显示数与实际严重不符。

**根本原因**：`SearchView.tsx` 已实现 `fetchPage`（offset 分页）、`loadMore`（触底加载）、`onScroll`（滚动检测），但 `onScroll` 从未绑定到结果滚动容器（`<div className="flex-1 overflow-y-auto">` 只写了 overflow，没挂 `onScroll`）。因此 `loadMore` 永不触发，只加载 offset=0 的第一页 100 条，`total` 却显示 Everything 真实全量命中数。后端 `sdk::search` 的 `set_max`/`set_offset`/`get_tot_results` 分页本身正确。

**解决方案**：结果滚动容器补 `ref={scrollRef} onScroll={onScroll}`；顺带删掉 `loadMore` 里未使用的 `parts` 死代码、补漏导的 `import type { LucideIcon }`（最后一条 TS2304）。

**教训**：
1. 无限滚动的三件套（`loadMore` + `onScroll` + 滚动容器 `onScroll` 绑定）缺一不可，TS6133「声明未使用」是「功能写了一半没接线」的信号；
2. 排查「列表只显示固定数量 + 计数不符」优先查分页触发器是否真的接上了 UI 事件，而不是先怀疑后端分页。

**相关代码**：
- `src/modules/search/SearchView.tsx` - 结果滚动容器补 `onScroll`/`scrollRef`，删 `loadMore` 死 `parts`，补 `LucideIcon` 类型导入

---

## 2026-08-20

### 表情模块切换卡顿：激活全量重载 + 逐字符 Canvas 检测阻塞主线程

**问题描述**：主窗口每次切回表情模块都卡顿约 200~260ms；文件搜索结果更多却流畅。

**根本原因**：
1. `Page.tsx` 有 `useEffect([active])`，每次切回表情页都重新 `loadCatalog()`（重建 1906 个对象）+ `setCat` 全量重渲染 144 个节点——搜索页 keep-alive 后无此逻辑，状态常驻；
2. `SmartEmoji` 缓存冷时，144 个字符各做一次「新建 64×64 canvas + 2D context → fillText → getImageData 4096 像素 → 双重 for 扫描 → **整个 SUPPORT_CACHE JSON.stringify 写 localStorage**」，单字符约 1.5~3ms，合计 220~430ms，正好吻合日志 `first paint after cat` 尖峰（`loadCatalog` 仅 4~18ms，不是瓶颈）。

**解决方案**：
- 去掉激活重载，改为窗口 `focus` 时刷新（同搜索页策略）+ 使用表情后后台 `load()` 刷新统计；
- `SmartEmoji` 检测改造：复用**单个共享 canvas/context**（不再每次新建）；待检测字符入队、**每帧 rAF 只处理 24 个**（片间让出主线程）；localStorage **防抖**（500ms 一批写一次，不再逐字符写全量 Map）。未命中仍先按「支持」渲染字符，检测完再替换 Twemoji。

**教训**：
1. 排查「数据多却不卡 / 数据少反而卡」先看加载与渲染量是否一致——搜索按页渲染（PAGE_SIZE=100），表情页看似只显示 144 个，但激活时全量重建 + 逐字符检测才是开销来源；
2. 前端瓶颈判定用已有诊断日志：数据加载耗时 vs 渲染耗时分开看，尖峰量级与每节点成本相乘对比即可定位；
3. 逐字符的 O(n) 检测要么缓存结果、要么分片让出主线程；持久化写入（localStorage）必须防抖合并，别逐次写全量。

**相关代码**：
- `src/modules/emoji/SmartEmoji.tsx` - 共享 canvas + 分片队列（`BATCH_PER_FRAME=24`）+ 防抖 `schedulePersist`
- `src/modules/emoji/Page.tsx` - 去掉 `active` 重载，改 `window focus` 刷新；`onPick` 后后台刷新

---

## 2026-08-20

### 启动后第一次拖动主窗口突然消失

**问题描述**：软件启动后第一次拖动主窗口（拖系统标题栏），窗口突然消失；之后拖动正常。

**根本原因**：unified 模式下主窗口按「面板」工作，`lib.rs` 的 `on_window_event` 里 `Focused(false)` 会触发 `hide_after_blur_grace`（失焦 200ms 仍未聚焦则隐藏，用于「点外部关闭」）。拖动标题栏时 Windows 进入 move loop，窗口持续失焦；第一次拖动往往从默认位置拖到目标位置、耗时 >200ms，200ms 后 `is_focused()` 仍为 false → 窗口被 `hide()`。之后拖动多为快速微调（<200ms）或拖动松手后焦点及时恢复，所以「只有第一次」。

**解决方案**：`hide_after_blur_grace` 改为循环：200ms 后若未聚焦，先查鼠标左键是否仍按住（`GetAsyncKeyState(VK_LBUTTON)`）——按住说明正在拖动标题栏（move loop 中），继续等待而非隐藏；松手后 move loop 结束焦点恢复，不隐藏。「点外部关闭」时左键早已松开，仍正常隐藏。

**教训**：
1. 拖动标题栏/边缘缩放会让窗口短暂失焦（move loop），「失焦 → 隐藏」类逻辑必须区分「失焦」与「正在被用户拖动」；鼠标左键按住是判断拖动中的可靠信号（拖动期间左键必按着）
2. 面板式窗口的失焦隐藏不能只靠延时宽限期兜底，宽限期能覆盖瞬时失焦，覆盖不了持续 >200ms 的拖动
3. `GetAsyncKeyState` 返回 `i16`（高位 1 表示按下），比较时用 `as u16 & 0x8000`，字面量 `0x8000` 直接与 `i16` 相与会报 overflowing_literals

**相关代码**：
- `src-tauri/src/lib.rs` - `hide_after_blur_grace` 加左键按住判断（`Win32_UI_Input_KeyboardAndMouse` 依赖已有）
- `src/lib/use-window-entrance.ts` - 已有「失焦 ≠ 隐藏，用 `isVisible()` 判断」的同类经验

---

## 2026-08-20

### 启动先闪默认尺寸再恢复 + 恢复的尺寸不是上次关闭时的大小

**问题描述**：彻底退出后重开，窗口先按默认尺寸（960×640）闪一下，然后才变成记忆尺寸；有时恢复的尺寸不是上次关闭时的尺寸。

**根本原因**（两个独立问题）：
1. **闪默认尺寸**：`tauri.conf.json` 主窗口按默认尺寸创建并立即显示，setup 运行后才 `set_size` 恢复记忆尺寸 → 先显示默认再改，视觉上闪一下；
2. **恢复尺寸不对**：尺寸只靠前端 `onResized` 防抖 400ms 后 `save_main_size` 保存（`App.tsx`）。用户调整尺寸后 400ms 内就点 X 隐藏或托盘退出，防抖还没触发 → 保存的是更早的尺寸，下次启动就恢复到旧尺寸。

**解决方案**：
1. `tauri.conf.json` main 窗口加 `"visible": false`（初始隐藏），setup 恢复记忆尺寸后再 `win.show()`——启动直接以正确尺寸出现，无闪现；也顺带与前端 `useWindowEntrance` 的「启动从隐藏变可见时播放入场动画」流程天然匹配；
2. 新增后端 `save_main_window_size()`（`inner_size` + 校验 ≥400×300），在**点 X 隐藏到托盘**（`CloseRequested`）和**托盘「退出」菜单**两个时机主动保存当前尺寸，兜底前端防抖未触发的场景。

**教训**：
1. 「恢复窗口状态」不能等窗口创建后再改——要么创建前注入，要么初始隐藏 + 恢复后再显示，否则必然闪默认值；
2. 前端防抖保存（为降 IO 频率）必然牺牲"关窗/退出前最后一刻的状态"——持久化关键状态要在关闭/退出事件里主动兜底，不能只靠防抖；
3. 保存窗口尺寸统一用 `inner_size`（与前端 `onResized` payload 一致），校验最小尺寸的过滤逻辑要在所有保存入口重复（前端防抖、`save_main_size` 命令、后端兜底）。

**相关代码**：
- `src-tauri/tauri.conf.json` - main 窗口 `visible: false`
- `src-tauri/src/lib.rs` - `save_main_window_size`（CloseRequested + 托盘 quit 调用）、setup 恢复尺寸后 `win.show()`
- `src/App.tsx` - 前端 onResized 防抖保存（保留）

---

## 2026-08-21

### 官网工程：写入新 index.html 未落盘，Vite 把旧静态站 index.html 原样复制进 dist

**问题描述**：把 `website/` 从旧静态站改造成独立 React 工程。写入了新的 `website/index.html`（返回"写入成功"），但磁盘上 `index.html` 仍是旧站文件（时间戳更早、内容是旧站）。`npm run build` 报诡异警告：`<script src="app.js"> in "/index.html" can't be bundled without type="module" attribute`、`styles.css doesn't exist at build time`，且 `dist/index.html` 15917 字节与旧站源文件大小一致——Vite 把旧 index.html 当入口原样拷进 dist，React 应用根本没打包（"2 modules transformed"）。

**根本原因**：`website/index.html` 的写入在磁盘上没有生效（旧文件时间戳早于本次写入，src/ 下其它新文件都正常落盘，唯独 index.html 没覆盖成功）。Vite 以项目根 `index.html` 为入口，读到的仍是旧站 HTML——它不含 `type="module"` 脚本，Vite 不转译、直接复制到 dist。真正的信号不是报错，而是「模块数量异常少」+「dist 体积与旧源文件一致」。

**解决方案**：重新用编辑器工具写入 `website/index.html`，写后**立即 Read 校验内容 + LastWriteTime** 确认生效，再删旧 `dist/` 重跑 `npm run build`——这次 2002 modules transformed，产出正常 `index.html`(0.98kB) + `assets/*.js/css`。

**教训**：
1. 覆盖已有文件后**必须校验落盘结果**（重新 Read 或看时间戳/长度），不能只信"写入成功"的返回
2. Vite 构建的坑标志：`dist/index.html` 体积 ≈ 旧源文件、`transformed` 模块数异常少、警告里出现本应已删除的旧资源名（app.js/styles.css）——这些都指向「入口 index.html 不是你以为的那个」
3. 改造旧静态站为 React 工程时，先确认根 `index.html` 已替换成含 `<script type="module">` 的新文件，再谈构建；残留的旧 `dist/` 也会误导判断，先清掉

**相关代码**：
- `website/index.html` - 重写后校验通过
- `website/` - 新 React 工程（Vite + React19 + TS + Tailwind v4 + react-bits BlurText）

---

<!-- 新增教训请添加到上方，格式如下：
## YYYY-MM-DD

### 教训标题

**问题描述**：...

**根本原因**：...

**解决方案**：...

**教训**：...

**相关代码**：...
-->
---

## 2026-08-21

### Playwright 测试「悬停才显示」的按钮：滚动打断 :hover + aria-label 随状态变化

**问题描述**：用 Playwright 自动化验收新官网时，点击剪贴板迷你组件的「固定」按钮超时失败。两个坑叠加：① 按钮放在 `hidden group-hover:flex` 容器里，只有鼠标悬停所在行才可见；Playwright 的 click 在行动前会重新把元素滚到视口内，页面一滚鼠标坐标对应的行就变了，:hover 失效 → 按钮「不可见」无限重试。② 列表第一行默认处于已固定状态，该行按钮的 aria-label 是「取消固定」而不是「固定」，按初始状态写死的选择器根本匹配不到。

**根本原因**：CSS :hover 是鼠标坐标和页面滚动的耦合产物，自动化中任何额外滚动都可能让它失效；aria-label 随交互状态变化的元素，「按当前状态猜标签」的选择器天然脆弱。

**解决方案**：三步走——先 `scroll_into_view_if_needed()` 滚到位，再 `hover()` 建立悬停态，最后 `click(force=True)` 跳过可见性断言（click 事件照常触发 React handler）；选择器改用 `[aria-label*="固定"]` 模糊匹配，同时覆盖固定/取消固定两种状态。

**教训**：
1. 测 hover 才出现的控件：滚动 → 悬停 → force 点击，不要指望一次自带滚动的 click 能保住 :hover
2. aria-label / 文案随状态变化的元素，测试选择器一律模糊匹配或加 data-testid
3. 见到「element is not visible」重试循环，先查两件事：hover 被滚动打断、元素标签随状态变了

**相关代码**：
- `website/src/components/minis/clipboard.tsx` - group-hover 显隐的操作按钮

## 45. 右键菜单智能定位

**问题**：
- 右键菜单在窗口边缘时会被截断
- 当父元素有 `transform` 属性时，`position: fixed` 会相对于父元素定位，导致菜单位置偏移

**解决方案**：
- 使用通用 `ContextMenu` 组件（`src/components/ui/context-menu.tsx`）
- 组件自动计算菜单位置，确保不超出窗口边界
- 使用 Portal 渲染到 `document.body`，避免父元素 `transform` 影响

**经验教训**：
1. 右键菜单必须调用 `e.preventDefault()` 阻止浏览器默认菜单
2. 容器元素也需要添加 `onContextMenu={(e) => e.preventDefault()}` 阻止空白处的浏览器默认菜单
3. 菜单位置计算需要考虑视口边界，避免菜单被截断
4. 使用 Portal 渲染到 `document.body` 可以避免父元素 `transform` 影响定位

**相关代码**：
- `src/components/ui/context-menu.tsx` - 通用 ContextMenu 组件
- `src/components/ui/context-menu-item.tsx` - 通用 ContextMenuItem 组件
- `src/components/ui/context-menu-divider.tsx` - 通用 ContextMenuDivider 组件

## 46. 表情模块右键菜单

**问题**：
- 表情模块没有右键菜单功能
- 需要为内置表情和自定义表情添加右键菜单

**解决方案**：
- 内置表情：右键菜单支持"复制表情"
- 自定义表情：右键菜单支持"复制表情"、"添加到收藏"、"删除"
- 使用通用 ContextMenu 组件

**经验教训**：
1. 右键菜单功能应该为所有可交互元素提供
2. 使用通用组件可以保持一致的交互体验

**相关代码**：
- `src/modules/emoji/Page.tsx` - 表情模块右键菜单实现

---

## 快速启动模块重构（v0.4.5）

### 1. Settings 组件的 setTimeout 导致排序切换失效

**问题**：在设置中切换排序方式后，排序没有生效。

**根因**：Settings 组件中 `setTimeout(() => onRefresh?.(), 100)` 调用的是旧的 `fetchItems`（闭包捕获了旧的 `cfg.sortBy`），在 parent useEffect 正确获取数据后又用旧参数覆盖了结果。

**解决方案**：移除 Settings 中冗余的 `setTimeout` 和 `onRefresh` prop。parent useEffect 已经在 `cfg` 变化时自动重新获取数据。

**经验教训**：
1. 当 state 通过 props 传给子组件时，子组件的闭包会捕获旧值
2. 如果 parent 已经有 useEffect 监听 state 变化并重新获取数据，子组件不需要再调用 refresh

**相关代码**：
- `src/modules/quicklaunch/Settings.tsx`
- `src/modules/quicklaunch/Page.tsx`

### 2. 中文名称排序需要前端 localeCompare

**问题**：按名称排序时，中文名称排序结果不符合拼音顺序。

**根因**：SQLite 的 `ORDER BY name` 默认按 Unicode 码点排序，中文字符的码点不是按拼音顺序排列的。

**解决方案**：在 `fetchItems` 的非手动排序分支中，对结果用 `localeCompare("zh-CN-u-co-pinyin")` 做前端拼音排序。

**经验教训**：
1. SQLite 不原生支持中文拼音排序，需要前端二次处理
2. `localeCompare` 的 `"zh-CN-u-co-pinyin"` 参数可以按拼音排序中文
3. 数据量小的模块（几十到几百条）前端排序无性能问题

**相关代码**：
- `src/modules/quicklaunch/Page.tsx` - fetchItems 函数

### 3. 统一配置状态管理（对齐文件搜索模块）

**问题**：快速启动模块有 7 个分散的 state（viewMode、sortBy、gridSize 等），导致配置管理混乱、切换排序时闪烁、loadConfig 重复调用等问题。

**根因**：与文件搜索模块的设计不一致——文件搜索用单个 `cfg` 对象 + `setSort`/`toggleView` 函数，快速启动用分散 state + `onSettingsChange` 回调。

**解决方案**：
- 新增 `QuicklaunchConfig` 接口和 `QL_DEFAULTS` 默认值
- 合并 5 个分散 state 为单个 `cfg` 状态
- 新增 `updateConfig(patch)` 和 `toggleView()` 函数
- `loadConfig` 直接解析到 `cfg`，不再分散设置
- `fetchItems` 移除 `setLoading(true)` 闪烁
- 非手动排序模式下跳过 DndContext/SortableItem

**经验教训**：
1. 同一项目的多个模块应保持一致的配置管理模式
2. 单个 cfg 对象比多个分散 state 更容易维护
3. 文件搜索模块是快速启动模块的良好参考实现

**相关代码**：
- `src/modules/quicklaunch/Page.tsx` - 主组件重构
- `src/modules/quicklaunch/Settings.tsx` - 简化为接收 cfg + onUpdate

### 4. Tauri v2 命令参数 JS 侧必须用 camelCase

**问题**：表情模块设置（热键/点击行为/跟随鼠标/网格大小）全部保存失败且无报错。

**根因**：invoke 参数用了 snake_case 键名（如 ollow_mouse），Tauri v2 默认将 Rust snake_case 参数映射为 JS camelCase（如 ollowMouse）。键名不匹配 → 反序列化失败 → Promise 静默 reject。

**解决方案**：JS invoke 一律传 camelCase 键名。排查信号：设置改完重启后回退旧值 = 保存没写进去。

**相关代码**：
- `src/modules/emoji/Settings.tsx` - save 函数

45. **提交 ≠ 安全：工作区文件可能被编辑器旧缓冲覆盖**：VS Code 等编辑器若保留旧版本缓冲，一次保存会把磁盘上较新的已提交内容退回旧版（本次「边拉边生效」改造 5 个文件整体回退且 tsc 可编译通过，极难察觉）。信号：功能行为无故回退但 git log 显示代码早已提交。排查用 git diff（非 git status 干净就安全），恢复用 git checkout -- <file>。多会话/多人协作时（见坑 19）提交前后都应 diff 一遍

---

## 2026-08-24

### 启动流程体检：setup 内阻塞会推迟首帧 + 开库 expect 一炸全灭

**问题描述**：冷启动全链路审查发现两类问题：① search/emoji 模块的 `join()` 排在 setup 里，任何模块初始化慢都会推迟窗口显示；② 剪贴板/表情开库失败（库损坏）直接 `expect` panic，应用完全无法启动且无托盘无提示，用户只能手动删数据文件。

**根本原因**：
1. `win.show()` 在 setup 内调用时，**真正绘制要等 setup 返回、事件循环启动之后**——所以把 show 提前到 join 之前毫无用处，唯一有效手段是把阻塞移出 setup。join 只是同步点，模块工作在 spawn 时已并行开始；
2. `AppState::new(...).expect(...)` / `Db::open(...).expect(...)` 把「数据损坏」升级成「程序崩溃」，错误处理层级错配。

**解决方案**：
1. search/emoji 的 join 移入 `build_tray` 之后的 `std::thread::spawn` 后台线程（剪贴板保留同步 join——它是主窗口首屏数据源，且备份是 6h 节流、VACUUM 超 8MB 才触发，关键路径只剩毫秒级开库）；
2. 新增 `lib.rs::quarantine_broken_db(path)`：开库失败时把损坏库（含 -wal/-shm）改名 `.broken-<时间戳>` 留证后重建空库；剪贴板重建再失败才返回 Err（模块降级禁用），emoji 同样兜底；
3. 迁移失败加落盘计数器（`migration_clipboard_failed`），连续 3 次失败停止自动重试，防旧库损坏时每次启动白跑复制+导入；
4. 热键注册失败补发系统通知（`notify_hotkey_failed`，tauri_plugin_notification Rust 侧直调无需 capability）——原来只写日志，统一模式下热键被占用=用户无法呼出窗口且毫无感知；
5. 日志加时间戳（SimpleLogger 加 `chrono::Local::now()`）；主窗口配置 `"backgroundColor": "#0a0a0a"`（= dark 主题 oklch(0.145 0 0)，Tauri ≥2.1 支持）防 WebView2 白底在暗色主题下的白闪。

**教训**：
1. **setup 是首帧之前的关键路径**：里面每一毫秒都算启动耗时；show() 在其中只是标记可见，不产生绘制。要提前显示就把工作移出去，而不是挪 show 的位置；
2. **join 与工作的区别**：spawn 出去的初始化早已并行执行，同步等待点放哪里只影响「谁等它」，不影响「它何时完成」——首屏不依赖的模块，join 放后台即可；
3. **expect 只该用于「不可能失败」的场景**：磁盘上的数据库文件是用户环境的一部分，损坏是常态输入，必须降级隔离（改名留证+重建）而非崩溃；
4. 给用户的可感知故障（热键失效、注册失败）必须有日志之外的反馈通道。

**相关代码**：
- `src-tauri/src/lib.rs` - setup 尾部后台 join、`quarantine_broken_db`、`notify_hotkey_failed`、SimpleLogger 时间戳
- `src-tauri/src/modules/clipboard/mod.rs` / `modules/emoji/mod.rs` - 开库兜底
- `src-tauri/src/migrate.rs` - 迁移失败计数上限
- `index.html` / `src-tauri/tauri.conf.json` - 标题、backgroundColor

---

## 2026-08-24

### 启动后剪贴板页面空白：keep-alive 清理 effect 在清单就绪前"误杀"首屏模块

**问题描述**：冷启动后主窗口显示剪贴板模块但内容区全空；右键→刷新（WebView2 默认菜单）无效；点底栏「剪切板」才转圈（懒加载）后显示内容。

**根本原因**：App.tsx keep-alive 的清理 effect 依赖 `enabledModules`，但首次渲染时 config/manifests 未返回，`enabledModules = []`，effect 把 `visited` 里的 `"clipboard"` 全部过滤掉；bootstrap 完成后 effect 重跑却**只过滤不回填**（空集滤空集），`{visited.has("clipboard") && <Clippage/>}` 永远为假 → 懒加载组件永不挂载。点底栏有效是因为 `selectModule` 会重新 `setVisited` 回填。

**解决方案**：清理 effect 开头加守卫 `if (!enabledModules.length) return;`——清单未就绪时无从校验，不清理。

**教训**：
1. **"按允许列表修剪状态"的 effect 必须防空列表**：数据未就绪时的空允许列表会把合法状态清空，且单向过滤逻辑永远不会自我恢复；
2. 排查"组件没渲染"先确认**挂载条件**（这里是 `visited.has()`），而不是数据加载链路——日志里懒加载 chunk 完全没有触发记录就是关键信号（既无成功也无失败=请求从未发出）；
3. 时间戳日志的排查价值：多次 "app mounted" 无 "clippage mounted" 直接把问题定位到挂载条件而非 IPC/后端。

**相关代码**：
- `src/App.tsx` - 清理 effect 加空列表守卫

### 追加：守卫条件语义修正 + 落地面板改为「排序第一位」

**演进**：上一条修复用的守卫 `if (!enabledModules.length) return;` 有语义漏洞——它把「清单未就绪」和「用户真的禁用了全部模块」混为一谈，后者会导致运行中关掉最后启用模块时残留僵尸页面。

**修正**：守卫改判 `if (!orderedManifests.length) return;`——4 个内置模块无论开关与否都会进清单，清单为空只可能是未就绪；全禁用是合法状态照常清理。

**新需求落地**：启动落地面板从写死 `"clipboard"` 改为「排序第一位且启用的模块」。实现：`active`/`visited` 初始为空，复用清理 effect 的既有兜底（active 不在可用列表 → `enabledModules[0]`），另在 visited 为空时补入 `enabledModules[0].id` 保证首屏组件挂载。运行中拖动排序不跳转，仅影响下次启动；全部禁用时内容区留空、设置入口独立可达（Sidebar 硬编码）。

**教训**：
1. 「列表为空就跳过」类守卫必须区分**数据未就绪**与**真实的空状态**，两者需要的处理相反；
2. 默认选中项不要写死 id，交给「第一个可用项」的统一兜底逻辑，天然覆盖禁用/排序等组合场景。

**相关代码**：
- `src/App.tsx` - active/visited 初始为空 + 清理 effect 守卫改 orderedManifests + 名单回填

---

## 2026-08-24

### 主窗口「先空白、闪一下、才加载」：显示时机与内容就绪解耦

**问题描述**：冷启动时主窗口先弹出（只有深色底无内容），过一会儿界面框架带入场动画"闪一下"出现，再转圈后才显示剪贴板内容。

**根本原因**：窗口显示时机由 Rust 决定（setup 完成就 `win.show()`），内容就绪由前端决定（WebView 加载页面 + React 挂载 + 懒加载模块代码，开发模式 vite 首次编译可达数秒）——两者从未对齐，「窗口出现」远早于「首帧绘制」。「闪一下」是界面框架的入场动画（fade+zoom 150ms），因空白期刚结束、数据未跟上而显得像卡顿重绘。

**解决方案**：把显示决定权交给前端——
1. Rust：setup 不再 `show()`；新增 `main_window_ready` 命令（show+unminimize+set_focus）；setup 尾部起 15s 兜底线程，前端异常未发信号则强制显示；
2. 前端：bootstrap 完成 → 预载全部四个模块 chunk（与 lazy 共用同一 import thunk，命中缓存零额外请求）→ 双 rAF（确保主题类已应用、首帧已绘制）→ invoke `main_window_ready`。

效果：窗口出现瞬间即完整内容，入场动画从"异常闪烁"变为正常开场；预载顺带让模块切换零等待。注意入场动画此时由 focus 事件触发播放（useWindowEntrance 的 hidden→visible 分支），与显示天然同步。

**教训**：
1. **多进程/多端协作的"就绪"必须显式握手**：Rust 无法感知 WebView 何时画完第一帧，靠猜测的固定时机必然或早（空白）或晚（白等）；让就绪方主动发信号 + 超时兜底是标准模式；
2. 兜底线程要查 `is_visible()` 再 show，避免覆盖用户正常交互后的状态；
3. 排查此类问题先量时间差：日志里后端就绪到前端 mounted 的 gap 直接暴露矛盾所在。

**相关代码**：
- `src-tauri/src/lib.rs` - `main_window_ready` 命令 + setup 移除 show + 15s 兜底
- `src/App.tsx` - PAGE_IMPORTS 抽取共用 import + bootstrap 后双 rAF 发信号

---

## 2026-08-24

### 全库审计修复（P1×6 + P2×12）：锁中毒、守卫误伤、竞态覆盖、主线程冻结

**审计发现与修复要点**：

1. **Mutex 中毒零恢复是系统性风险**：`.lock().unwrap()` 遍布 14 个文件 72 处，任意线程持锁 panic 后所有后续 `.lock()` 连环 panic——quota 轮询线程死亡、剪贴板命令全体报错，应用"活着但功能死"。修复：全部替换为 `.lock().unwrap_or_else(std::sync::PoisonError::into_inner)`（中毒时强行取回 guard 继续）。
2. **时间窗守卫必须配内容指纹**：自写剪贴板守卫按 2000ms 一刀切，粘贴后用户快速复制的真实内容被吞且轮询签名已推进永不补录。修复：paste/copy 路径登记 `set_pending_ignore` 内容指纹，监听侧只跳过指纹一致的回声。
3. **Win32 打包返回值要查文档**：EM_GETSEL 返回值 HIWORD=终点/LOWORD=起点且仅 16 位有效，直接取返回值得反序选区；改用指针出参拿完整 32 位 (start,end)。
4. **非 async 命令跑在主线程**：同步 SDK 探测/缩略图解码/sleep(60ms) 都冻结 UI。async 化时 `State<'_,T>` 不能 move 进 spawn_blocking 闭包（E0521 borrowed data escapes），改传 AppHandle、闭包内 `app.state::<T>()`。
5. **异步响应要防迟到覆盖**：Clippage/SearchView 列表加代序号 ref，`seq !== current` 直接丢弃旧响应。
6. **失败路径不能跳过恢复动作**：换主热键 save_config 失败提前 return 时已 unregister_all 且不再 reapply=热键全灭；先恢复注册再返回错误。

**教训**：
1. 同类模式批量修复（如 72 处锁）用机械化替换一次到位；每处并发修复都要回答「谁在等这把锁」；
2. toast 渲染在自己窗口里，窗口一隐藏提示即失效——错误反馈要保证存活到用户看到；
3. 配置/历史类 JSON 写盘一律临时文件+rename 原子替换，崩溃半截文件的代价是静默全量重置。

## 45. 新增数据库列时的完整修改清单

**场景**：给剪贴板模块添加备注（note）字段

**涉及文件**：
1. `db.rs`：schema 迁移（version 3）、SQL 查询加 note、row_to_item 解析 note、set_note 方法
2. `models.rs`：Item/ItemDto 加 note 字段、to_dto 透传
3. `commands.rs`：新增 set_item_note 命令
4. `lib.rs`：注册新命令到 generate_handler
5. `monitor.rs`：所有 Item 初始化加 note: None
6. `store.rs`：测试中 Item 初始化加 note: None
7. `Clippage.tsx`：ItemDto 接口、右键菜单、编辑 UI、显示备注

**易漏点**：
- monitor.rs/store.rs 中构造 Item 的地方（只搜 grep `Item {` 不够，要搜 `ItemKind::`）
- 测试中的辅助函数（test_item/file_item/text_item）
- lib.rs 的 generate_handler 注册

## 46. 磁盘探测不要每次搜索都执行

**场景**：剪贴板搜索框输入卡顿

**根因**：`get_history` 每次调用都会对所有图片条目执行 `Path::exists` 磁盘探测（网络盘/U盘可能秒级延迟），搜索时频繁触发导致卡顿。

**修复**：只在 `kind == "image" || kind == "pinned"` 时才执行图片磁盘探测（这两种 Tab 需要精确过滤）。普通搜索（kind = "all" / "text"）跳过探测，因为图片文件不存在不影响搜索结果的显示（用户可以搜索图片的内容/备注）。

**教训**：磁盘 I/O 操作要尽可能减少，尤其是网络盘/慢盘场景。不需要实时检测时用缓存或跳过探测。

## 47. 小数据量搜索用本地过滤，不要每次 IPC

**场景**：剪贴板搜索框输入卡顿（字符延迟出现）

**根因**：每次 search 变化都触发 IPC 调用后端 SQL LIKE 查询，快速输入时多个 IPC 往返堆积，异步回调连续 setState 导致重渲染风暴，输入框被卡住。

**修复**：改为本地搜索架构：
1. 后端新增 `get_all_history` 命令（返回全部条目，无 filter/limit）
2. 前端挂载时一次性加载全部数据到 `allItems` state
3. 用 `useMemo` 内存过滤出 `displayItems`（search + filter，纳秒级）
4. 移除 debounce（本地过滤不需要）
5. `clipboard://changed` 触发全量刷新

**教训**：
- 小数据量（<1000 条）搜索用本地过滤，比每次 IPC 快 1000 倍
- IPC 有开销（序列化/反序列化、跨进程通信），避免高频调用
- `useMemo` 内存过滤纳秒级，输入即时响应
- 数据变更时（固定/删除/备注）重新加载全量数据即可

## 48. 粘贴到原窗口不要用 SetForegroundWindow，隐藏窗口即可

**场景**：剪贴板统一模式下，选择条目后文本没有粘贴到原输入框

**根因**：使用 `SetForegroundWindow` 还原焦点，但 Windows 对前台窗口有严格限制——只有当前前台进程才能调用 `SetForegroundWindow`。EasyTool 执行 `paste_item` 时已经不是前台进程，所以 `SetForegroundWindow` 静默失败，Ctrl+V 发送到了 EasyTool 自身。

**修复**：参考 PowerToys Advanced Paste 的做法：
1. 隐藏 EasyTool 窗口（`win.hide()`）
2. 等待 100ms（窗口隐藏完成，焦点自动返回到原窗口）
3. 直接发送 Ctrl+V

**教训**：
- Windows 对 `SetForegroundWindow` 有严格限制，不要依赖它
- 窗口隐藏后，Windows 会自动把焦点返回到原窗口（默认行为）
- PowerToys Advanced Paste 和 CmdPal 都遇到过同样的问题
- `SetForegroundWindow` 是异步的，调用后不能立即检查 `GetForegroundWindow`

---

## 2026-08-25

### 自动更新实现：GitHub Releases + 签名验证

**问题描述**：需要实现应用自动更新功能，让用户能方便地获取新版本。

**解决方案**：
1. **Tauri 插件集成**：使用 `tauri-plugin-updater`，配置 GitHub Releases 端点
2. **签名验证**：生成 ed25519 密钥对（`updater.key` + `updater.key.pub`），私钥存 GitHub Secret，公钥内置应用
3. **CI/CD 工作流**：GitHub Actions 自动构建 → 用私钥签名 → 发布到 Releases
4. **用户端体验**：
   - 设置页「检查更新」按钮
   - 启动时自动检查，有新版本显示横幅提示
   - 下载签名安装包 → 重启完成更新

**关键点**：
- 签名私钥**绝不提交到代码仓库**（已在 .gitignore）
- 端点格式：`https://api.github.com/repos/{owner}/{repo}/releases/latest`
- 公钥需 base64 编码后放入 `tauri.conf.json`

**教训**：
1. 自动更新必须有签名验证，防止中间人攻击
2. CI/CD 流程要确保签名密钥安全（GitHub Secrets）
3. 用户端要有明确的更新提示和手动检查入口

**相关代码**：
- `src-tauri/tauri.conf.json` - updater 配置
- `src-tauri/updater.key` / `updater.key.pub` - 签名密钥
- `.github/workflows/release.yml` - CI/CD 工作流
- `src/modules/settings/` - 设置页更新按钮

---

### 发布 v0.5.0 踩坑：PowerShell 编码损坏 + NSIS glob 不匹配

**问题描述**：执行 `gh release create v0.5.0` 发布后，GitHub Actions 构建失败两次：第一次 Cargo.toml 中文变乱码（`宸ュ叿绠?`），第二次 Release 无安装包（assets 为空）。

**根本原因**：
1. **PowerShell 5.1 编码陷阱**：`Set-Content`、here-string（`@"..."@`）默认用系统 locale 编码（中文 Windows = GBK/CP936），不是 UTF-8。用它改写含中文的 Cargo.toml 后，中文变成乱码，TOML 解析失败。即使加 `-Encoding UTF8` 也会加 BOM（`EF BB BF`），Cargo 同样不认。**整个 PowerShell 管道（变量赋值、字符串拼接、here-string）都是 GBK，`[System.IO.File]::WriteAllText` 的编码参数只控制写出，管道传入的字符串已经是 GBK 了**。
2. **NSIS 产物 glob 不匹配**：workflow 里写 `*.nsis.exe`，但 Tauri 实际产物文件名是 `EasyTool_0.5.0_x64-setup.exe`（`*-setup.exe`），glob 匹配不上 → assets 为空。

**解决方案**：
1. 写含中文的文件**必须用 Node.js**（UTF-8 原生），PowerShell 在中文 Windows 上不可靠
2. NSIS glob 改为 `*-setup.exe`；签名文件 `*.sig` 不变

**教训**：
1. **中文 Windows 上 PowerShell 5.1 不适合写 UTF-8 文件**：here-string、变量赋值、`Set-Content` 全程 GBK，BOM 也不行。改含中文的文件一律用 Node.js / 编辑器
2. **CI 产物文件名要先本地验证**：`npx tauri build` 后检查 `src-tauri/target/release/bundle/nsis/` 下的真实文件名再写 glob
3. **发布前检查 Release assets**：`gh release view v0.5.0` 确认有安装包，空 assets = glob 错误

**相关代码**：
- `.github/workflows/release.yml` - `*-setup.exe` glob
- `src-tauri/Cargo.toml` - 中文 description

---

### Tauri v2 自动更新：createUpdaterArtifacts 必须显式开启

**问题描述**：v0.5.0 发布后检查 Release assets，只有 `.exe` 没有 `.sig` 签名文件。客户端 `checkForUpdate()` 无法验证签名，更新功能完全失效。重试 3 次（换密钥、加密码、重设 Secret）都没有 `.sig`。

**根本原因**：Tauri v2 中 `.sig` 文件的生成**不再默认开启**，必须在 `tauri.conf.json` 的 `bundle` 里显式设置 `"createUpdaterArtifacts": true`。只配了 `plugins.updater.endpoints` 和 `pubkey` 不够——这些是客户端检查更新用的，不影响构建时签名。

**解决方案**：`tauri.conf.json` → `bundle` 加 `"createUpdaterArtifacts": true`。签名密钥用 `tauri signer generate` 生成，密码设为 `easytool`，密钥对存 `src-tauri/updater.key` / `.key.pub`（.gitignore），pubkey 内容放 `plugins.updater.pubkey`，私钥+密码存 GitHub Secrets（`TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`），workflow 两个 env 都要传。

**教训**：
1. **Tauri v2 `createUpdaterArtifacts` 是签名的总开关**：不设为 true，再正确的密钥也不会生成 `.sig`
2. **CI 构建后必须验证 `.sig` 存在**：`gh api repos/.../releases/tags/vX.Y.Z --jq '.assets[].name'` 确认有 `.sig`，否则客户端更新必定失败
3. **密钥密码要同步存 Secret 并传 env**：`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 是独立的 Secret，workflow 里要加 `env` 传给 `npx tauri build`

**相关代码**：
- `src-tauri/tauri.conf.json` → `bundle.createUpdaterArtifacts: true`
- `.github/workflows/release.yml` → `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `src-tauri/updater.key` / `updater.key.pub`（.gitignore）
- `src/lib/api.ts` → `checkForUpdate()`（前端调用）
- `src/App.tsx` → 启动时静默检查 + 横幅提示

---

### CI/CD 发布工作流：自动构建 + 签名 + 发布

**问题描述**：手动构建发布流程繁琐，容易出错，需要自动化。

**解决方案**：
1. **触发条件**：推送 `v*` tag 时自动触发
2. **构建环境**：Windows latest，Node.js 22，Rust stable
3. **构建步骤**：
   - 安装依赖（npm ci）
   - 构建 Tauri 应用（`npm run tauri build`）
   - 用签名私钥签名安装包
   - 上传 artifacts 到 GitHub Release
4. **签名流程**：
   - 私钥从 GitHub Secret 读取
   - 签名后生成 `.sig` 文件
   - 安装包和签名文件一起发布

**关键点**：
- 使用 `tauri-apps/tauri-action` 官方 GitHub Action
- 签名私钥通过环境变量传递，不落盘
- 构建产物自动附带在 Release 中

**教训**：
1. CI/CD 要确保构建环境一致性（固定 Node.js/Rust 版本）
2. 签名密钥管理是安全关键，必须用 Secrets
3. 发布流程要幂等，重复运行不会创建重复 Release

**相关代码**：
- `.github/workflows/release.yml` - CI/CD 工作流
- `package.json` - build 脚本

---

Aliboder

---

## 49. 时长统计模块：SQLite 时间口径必须存储与查询统一（2026-08-25）

**现象**：events 表用 SQLite CURRENT_TIMESTAMP（UTC）存时间，查询却用 date('now','localtime') 对比 → UTC+8 时区下每天 0:00~8:00 的使用记录被归到昨天，当日统计查不到。

**根因**：写入与查询用了两个时区口径。date('2026-08-25 16:00:00')（实为本地 0 点的 UTC 值）永远不等于 date('now','localtime')。

**解决**：时间字符串一律由 Rust chrono::Local::now() 生成本地时间传入，存储/心跳/查询三处同口径；duration 用 julianday(两端同格式) 差值计算，偏移量相消精确。

**教训**：涉及时间的字段，先定死「一个时钟、一个格式」，再写任何 SQL。混用 UTC 存储与本地查询是最常见的隐式 bug。

---

## 50. WinEventHook 回调线程禁止做耗时操作（2026-08-25）

**现象**：timetracker 初版在 on_foreground 回调里同步写 SQLite（upsert + insert），会阻塞系统级窗口切换事件派发。

**正确模式（ActivityWatch 同款）**：回调只做 Win32 API 轻量采集（pid/exe/title）→ mpsc::channel 入队即返回；独立心跳线程 ecv_timeout(15s) 消费——收到消息立即结算+开新会话，超时则心跳 UPDATE 当前会话时长（顺带解决「一直用同一应用直到关机丢整段数据」问题）。

**教训**：系统钩子回调运行在 OS 派发线程，任何阻塞都会拖慢全系统；回调里只允许采集和入队。

---

## 51. Tauri 的 State 不能封装成「返回 MutexGuard」的辅助函数（2026-08-25）

**现象**：n lock(app) -> Result<MutexGuard<T>> { app.state::<T>().lock() } 编译报 E0515（返回引用临时值）。pp.state::<T>() 返回的 State<'_,T> 是临时值，guard 借用它活不过当前表达式。

**解决**：每个命令内联两行：let state = app.state::<Mutex<T>>(); let s = state.lock()...;

**教训**：tauri Manager trait 返回的 State 是借用视图不是句柄，不能跨函数传递其内部引用。

---

## 52. 开关类配置必须作用于「消费者实际读取的标志」（2026-08-25）

**现象**：timetracker「暂停录制」命令改的是 TimetrackerState.recording 字段，但采集循环读的是自己的 static AtomicBool RECORDING → 暂停功能静默失效，无任何报错。

**解决**：删掉 state 字段，atomic 作为唯一真相源，命令层直接调 collector::set_recording()（内部顺带结算当前会话）。

**教训**：同一个布尔语义出现两份存储（state 字段 + static）必然失同步；写开关功能时先问「谁在轮询这个值」，让 setter 直达那个位置。

---

## 53. 跨天会话的时长归属要显式拆账（2026-08-25）

**现象**：23:50 开始使用某应用到次日 00:10，该 20 分钟会话整段归属开始那天（按 date(start_time) 分组），次日凌晨的 10 分钟凭空丢失。

**解决**：心跳与切换结算前先调 oll_cross_day_event()——发现活跃会话起始日早于今天时，在昨日 23:59:59 封账原行，另开一条今日 00:00:00 起的新行（继承 app/title/is_active）。心跳粒度 15s 决定了会话最多跨一天，单次滚动即完备。

**教训**：凡「按日分组统计连续区间」的数据模型，写入端必须处理跨边界切片；只靠查询端 date() 分组会把跨界数据整段算给起点。

---

## 54. 用户可配分类用正则需要「缓存编译」别每次切换都编译；设计里已承诺的表别一直留死配置（2026-08-26）
**现象**：timertracker 的 auto_categorize() 是硬编码关键词数组，用户无法改分类（对比 ActivityWatch 的「用户定义分类规则」）。设计文档 §6.1 里的 category_rules 表和 autoAggregateMinutes 配置实际从未落地——daily_stats 表、aggregator.rs 都不存在，autoAggregateMinutes 是无任何代码消费的幽灵配置。
**解决**：
- 新增 category_rules 表（pattern 正则 / category / priority），categorize() 规则优先、回退内置关键词、再否则 unknown。
- 规则在「窗口切换」（频繁）时被消费，若每条都 Regex::new() 重新编译会浪费。用 static RwLock 缓存编译好的 (Regex, priority, category) 列表，规则增删改命令里 reload_rules() 刷新，采集线程只读缓存。
- 规则变更后调用 reapply_categories() 重跑所有已有 app 的 category，让旧数据立即按新规则归类（否则只在下次采集才生效）。
- 清理幽灵配置：删 autoAggregateMinutes（manifest + config.ts + 默认值）。config.rs 的 merge_manifests 只对「缺失模块」灌默认，老 config.json 里残留键无人读取，无害。
**教训**：①「设计文档写了 ≠ 实现了」，动手前先grep确认设计里的表/命令是否真存在，别对着幻想文档改代码。② 正则这类「廉价但非零开销」的匹配放到高频路径时，一定要缓存编译结果；配置字段若没有消费者，要么实现要么删，别留着误导。③ 用户可编辑的分类/规则，改完要触发「存量数据重算」，否则新规则只对新采集生效、老数据看不出变化。

---

## 55. 模块设置页必须遵守「Card + SettingRow + 自带 p-6」的房屋风格（2026-08-26）
**现象**：timetracker 的设置用了裸 <h4> 小标题 + 手写 flex 行，外层也无 padding，导致和其它模块（剪贴板/quota 的 Card 分组 + 外衬 p-6）观感明显脱节、内容贴死抽屉边缘。
**原因**：共享的 Drawer 内容区是 lex-1 overflow-y-auto，本身不带内边距——每个设置组件必须自己供应 padding；分组用 Card/CardHeader/CardTitle/CardContent，单行设置用 SettingRow（左标题+说明，右控件）。
**解决**：timetracker Settings 改为 space-y-6 p-6 外层 + 每节一个 Card + 每行 SettingRow；分类规则编辑器的「输入框+下拉+添加按钮」改用 Input / Select / Button 组件统一高度。
**教训**：写新模块设置页前先扫一遍现有模块（clipboard / quota / search），照抄它们的骨架（外层 padding + Card 分组 + SettingRow），而不是自创一套；共享容器（如 Drawer）不负责样式间隙时，间隙要由内容组件自己补。

---

## 56. 时间线必须绑定「周期」而非固定单日，否则切 Tab 不切换（2026-08-26）
**现象**：切到本周/本月时，排行/概览/分类占比都跟着更新，唯独下方时间线柱状图纹丝不动，仍是今天那张 24 小时图。
**原因**：时间线数据一直用 	imetracker_get_app_timeline(viewDate) 取单日事件，iewDate 默认今天且与 period 无关。初期选了「单日甘特图 + 全 Tab 历史回看」方案，副作用就是时间线只认日期不认周期。
**解决**：把时间线改成周期感知——今日=24 根（小时）、本周=7 根（天）、本月=当月天数根（天）。Timeline 组件抽象成 granularity: "hour" | "day" 两种分组：hour 用绝对刻度（满格 60min）+ 参考线 + 当前时刻线；day 用归一化刻度（满格=当日最多），柱高=当日活跃时长、按软件堆叠。新增 	imetracker_get_app_timeline_range(start,end) 取整段事件。
**教训**：凡「按周期呈现的时间序列图表」，其数据粒度必须与周期强绑定（小时/天），不要复用单日查询。组件应暴露粒度参数而非写死一种分组；柱状图的刻度：绝对（有物理上限如 24h/60min）用绝对值，否则用「最大值归一化」更直观。另外日期回看只在「今日」有意义——周/月是整段聚合，回看按钮放在全 Tab 会让人觉得时间线坏了。

---

## 57. 心跳不能把「当前会话」封账——update_current_event 只应刷新时长，封账单独 close（2026-08-26）
**现象**：用户持续用电脑一小时，但「今日使用」总时长只剩约 20 分钟。实查 timetracker.db：当天 75 条 0 时长 + 120 条 1~15s 事件，仅 2 条>15s；事件时间跨度约 66 分钟，但 SUM(duration_sec) 只有约 20 分钟——约 46 分钟蒸发。
**根因**：update_current_event 的 SQL 是 UPDATE events SET end_time=?1, duration_sec=..., is_active=?2 WHERE end_time IS NULL。它每次心跳都把 end_time 写死（封账）。于是首次心跳（15s）就把当前会话冻结在 15s；下一次心跳 WHERE end_time IS NULL 匹配不到行 → 静止在同一窗口超过 15s 的时长**不再被记录**，直到下一次切换前台才重新开事件。结果每个前台焦点只记到首个心跳，其余丢弃。而这与注释「即使一直停在同一个应用也持续累计时长」自相矛盾。
**解决**：分开两层——update_current_event 只刷新 duration_sec + is_active（**end_time 保持 NULL**，会话持续开启、时长单调增长）；新增 close_current_event 才写 end_time 封账（切换窗口 / 暂停录制 / 跨天滚动时调用）。init 时顺手结算上次异常退出遗留的 open 会话（end_time 置为 start、时长为 0），避免「应用停机被算成使用」的另一类虚高。
**教训**：①「心跳延长会话」与「封账结束会话」是两种不同语义，绝不能共用一条 SET end_time 的 UPDATE——end_time 一写，WHERE end_time IS NULL 就再也找不到了。② 验证时长统计一定要直接查库对账（SUM vs 时间跨度），不要只看 UI 数字；批量小事件 + 大间隔 = 采集有洞。③ 会话语义：end_time=NULL 表示「进行中」，值只应增大；谁把它写实谁就终结了它。

---

## 58. 心跳要在「活跃状态翻转」时把会话切段，否则挂机突不出来（2026-08-26）
**现象**：上次修复把会话改成「一条持续增长记录（end_time 保持 NULL）」后，is_active 只=该条记录最后一次心跳的值，一段「用5分钟→挂机10分钟→再用5分钟」的会话会被整段算成全活跃或全挂机，中间那 10 分钟挂机丢失。
**解决**：update_current_event 每心跳先读当前进行中会话的 is_active——与本次状态相同就延长（保持开启）；**翻转就封账旧段 + 开新段**（继承同 app/标题、写入新 is_active）。这样每段 is_active 恒定，活跃/挂机按 15s 心跳粒度分段准确，且总时长仍单调连续。
**教训**：①「一段会话的活跃/挂机」要精确，就不能把 is_active 当作整条记录的属性——它属于「片段」。状态一旦翻转就切分。② 心跳既要点点累积时长，也要在状态边界切分；只满足其一都会在另一维度失真（要么冻结要么丢挂机）。③ 单测要用「翻转封账 + 新段状态」断言，别只断言"没冻结"。

---

## 59. 图标/列表「闪现消失」：轮询刷新时 loading 把已有内容整体替换成 spinner（2026-08-26）
**现象**：应用排行图标时不常消失。定时轮询（30s）+ 切换日期/周期时 setLoading(true)，而 AppRanking 是 if (loading) return <Spinner/>、OverviewBar 大数字也 loading ? spinner : ...——刷新瞬间整块内容（含已加载图标）被 spinner 顶掉，闪一下再回来。
**解决**：刷新时「保留旧数据」。只在首载/无数据才显示 spinner：AppRanking 改 if (loading && stats.length === 0)；OverviewBar 有 overview 就照常渲染、否则 loading 才转圈。另给 useFileIcons 加 missing 缓存——图标提取失败（返回 null）的路径也记录下来，避免每次渲染都重新 invoke + 图标闪灰块。
**教训**：① 后台刷新类的 loading 绝不能把已有内容换成空的 spinner——用「保留上一次数据」或顶部细进度条，而不是整页替换。② 图标这类「可能失败」的异步资源，成功和失败都要缓存（失败进 missing 集合），否则失败路径反复触发抖动。
**附带**：应用名带 .exe，采集用 ile_stem() 去扩展名（qq.exe→qq），并在 init 一次性清理存量 app_name 的后缀，保证新老数据一致。

---

## 60. 切换记录出现「A→A」：前台钩子按窗口(HWND)变化切事件，同应用的窗口/焦点变化也把会话切碎（2026-08-26）
**现象**：「使用记录」里出现「A→A」——离开某软件、打开的又是它。查库确认这些 A→A 全是 is_active=1（不是活跃/挂机翻转），而是连续两条同 app 事件。
**根因**：on_foreground 用 WinEventHook 监听前台窗口，**只要有新 HWND 获得前台就切换会话**（switch_session 关旧开新）。同一个应用的不同窗口 / 子窗口 / 焦点闪变（0000 时刻大量 0 时长事件）会被当成多次「切换」，把一段同应用使用切开成多条事件。所以链式显示时出现 A→A。
**解决**：展示层——EventLog 按 app_id 合并连续的同一应用事件为一条（真实的应用切换才有「离开→打开」），合并条目标注「活跃 / 挂机 / 含挂机 X」；这也顺带吸收了活跃-挂机翻转产生的同 app 段。未改采集层（保留窗口级事件，总量/排行不受影响）。
**教训**：①「应用切换」的记录粒度应与「应用」一致，前台钩子按 HWND 触发天然会把同应用的窗口切换切碎——要么采集时按 exe 相同就合并（更干净但改动采集），要么展示时合并。② 合并连续同 app 才能让「切换流水」语义成立；否则窗口变化、活跃/挂机边界都会伪造成一次切换。③ 这种数据先查库确认根因（是活跃翻转还是同app窗口变化）再对症，别想当然。

---

## 61. 从源头消除 A→A：switch_session 先判「是否同应用」，同 exe 不切事件（2026-08-26）
**跟进**：在采集层把 A→A 治本。switch_session 在关旧开新之前，先用 ctive_event_app_path() 读进行中会话的 exe_path：跟新前台 exe 相同 → 直接 return（不切分，同一应用的窗口变化被吞掉，使用持续累计）；不同 → 才 close_current_event + start_event。这样事件只在「真实换应用」时产生，库里不再有同应用的窗口级碎片。
**要点**：① 判同 app 用 exe_path（小写、去后缀前的原始路径比较），不是窗口标题或 hwnd。② 查询进行中会话要 JOIN apps 取 exe_path。③ 新增 ctive_event_app_path 方法 + 单测（无会话 None / 开段返回 exe / 封账 None）。
**验证**：cargo test 55 通过。

---

## 62. 排行榜图标「消失」= 无图标时的占位太淡（20% 透明色块），照抄搜索「应用」Tab 的显式占位（2026-08-26）
**现象**：应用排行图标仍时有时无。查库确认 day/week/month 统计都带 exe_path（无数据 bug），图标机制与搜索共享 useFileIcons + get_file_icon。真正的观感差异是**占位**：排行榜无图标时渲染 ackground-color: 分类色33（20% 透明），几乎看不见，像图标「消失」；搜索「应用」Tab 无图标时渲染显式的 FileQuestion 图标。
**解决**：把 AppRanking / AppDetail 的无图标占位改成可见的 g-muted 方框 + FileQuestion（与搜索一致）。配合已做的「刷新不 blank + 失败路径缓存」，取不到图标或还在加载时都显示清晰的占位，不再闪成透明。
**教训**：①「图标消失」别只查加载逻辑，也要看「没图标时渲染成什么」——过于透明的占位等价于消失。② 参考成熟模块（带图标的搜索应用Tab）的兜底呈现（显式占位图标），比自己造一个几乎不可见的色块可靠。③ 应用列表的图标来源 SHGetFileInfo 对系统/UWP 进程（explorer/searchhost 等）确实可能取不到，占位必须显式可见。

---

## 63. SQL 窗口函数算「消费」时差分为 `prev - cur` 而非 `cur - prev`，且用纯函数交叉验证（2026-08-26）
**现象**：把 quota `apply_deepseek` 里逐条遍历算 `today_spend`/`avg7` 换成 SQL `LAG()` 聚合，单测断言 `today_spend==15` 却返回 `-15`，`avg7` 也变 `-5`。
**根因**：LAG 取到上一行 `prev_balance`，当时写成 `SUM(balance - prev_balance)`（= 本 - 上 = 负的消费量）。筛选条件是 `balance < prev_balance`（确为下降），但求和写反了符号。消费量 = 上一记录 - 本记录。
**解决**：改成 `SUM(prev_balance - balance)`，同时 `date(time/1000,'unixepoch','localtime')` 按时区对日期分桶（与 Rust 的 `chrono::Local` 一致）。
**教训**：① 用窗口函数（LAG）做差分统计，符号以「上一行 - 本行」为准，别被「下降」的直觉带偏写成反向。② 凡是把纯函数逻辑换成 SQL，务必保留原纯函数，并加一个**交叉校验单测**（同一批数据，SQL 结果与纯函数结果逐项比对），这是防语义漂移最省事的护栏。③ PowerShell `Set-Content -Raw` 处理含中文的 UTF-8 文件会破坏编码（整文件报 invalid UTF-8）——改代码用编辑工具，别用 PowerShell 正替换。

---

## 64. 排行榜图标「时有时无」的另一种根因：`file_icon_png` 返回 None 会被前后端双重永久缓存（2026-08-26）
**现象**：#62 已把占位改成可见的 FileQuestion，但某些应用仍是「只有占位、真图标出不来」。查库确认 day/week/month 统计都带 `exe_path`；图标机制（`useFileIcons` + `get_file_icon`）与搜索「应用」Tab 完全一致——真正的差异在**喂进去的路径**：搜索 Tab 喂的是刚扫描的 `.lnk`（稳定），排行榜喂的是前台钩子抓的真实 `exe_path`（脆弱）。
**根因**：`file_icon_png`（内部走 `SHGetFileInfoW`）对两类路径确实会返回 `None`：① `\\?\` 设备路径前缀（库里有历史脏数据清理逻辑 `apps.rs` 就是为它写的）；② 不存在/受限的 exe（卸载/更新后失效、系统/UWP 进程如 searchhost/shellhost）——且**行为不稳定**：实测同一个不存在路径单独跑 `cargo test` 是 `Some`、整批并行跑就成了 `None`。而前端 `useFileIcons` 把返回 null 的路径记进 `missingIcon` 集合**永久缓存**（`missing` 决定不再重试），后端 `ICON_CACHE` 同样缓存 `None` → 只要某路径失败一次，这个应用的真实图标就在本次运行里**永远**出不来了（直到重启应用），排行榜里表现为「时有时无」。
**解决**：让 `file_icon_png` **保证永不返回 None**：① 先用 `strip_prefix(r"\\?\")` 把设备路径转成常规路径；② 两层 `extract_icon`（真实文件 → 通用图标）都失败时再 `or_else(generic_icon_png())`，用 `image` crate 直接生成一个中性「窗口」图标兜底。这样 `get_file_icon` 永远返回一个 base64，前端命中的要么是真图标要么是通用图标，`missingIcon`/`ICON_CACHE` 再也不会把有效路径 pin 成「缺」。
**验证**：新增单测 `stale_path_returns_generic_icon`——对不存在的 exe、`\\?\` 路径、WindowsApps/systemapps/临时目录等真实受限样本都断言「必须 Some（回退成功）」。`cargo test` 57 passed（并行稳定）。
**教训**：① 依赖 `SHGetFileInfoW` 取图标并不可靠（设备路径、失效/受限进程、并行时都可能 null），编写时把「取不到」兜成「一定能返回」即可消除整类「图标消失」；否则前端 null 缓存会把一次失败永久放大成整个会话缺图标。② 排查「图标不显示」按三层看：路径是否有效 → `SHGetFileInfoW` 是否稳定 → 前端失败是否被缓存；搜索「应用」Tab 因喂 `.lnk` 稳定路径而始终正常，正好反衬排行榜的真实 exe 路径更脆弱。

---

## 65. 时长统计分类体系：判定、文案、色值、存量数据四处联动（2026-08-26）
**现象**：原分类只有 6 类（开发/办公/娱乐/社交/系统/其他）且划分粗糙——「娱乐」把游戏/视频/音乐/直播一锅端，「办公」混进了通讯工具（teams/discord/钉钉/飞书），缺「学习/浏览/AI」这类对学生 + AI 编程画像真正有用的维度。
**目标**：用户最终定为 6 类，按用户语义直接落地 `efficiency(效率工具) / resource(资源获取) / media(视听娱乐) / study(学习创意) / system(系统工具) / game(游戏)`。
**解决**：改四处：
1. Rust `auto_categorize`（models.rs）重写关键词判定，匹配顺序 **游戏 → 视听娱乐 → 资源获取 → 学习创意 → 效率工具 → 系统兜底**。顺序即优先级：`qqmusic`/`qqbrowser` 若放到 `qq`(通讯) 之后会被误归效率工具，故视听、资源必须先判；编程助手 `opencode`/`codex`/`cursor` 含子串 "code"，需与 AI 对话类（豆包/秘塔/DeepSeek）区分——前者归效率工具、后者归学习创意。
2. 前端 `types.ts` 的 `CATEGORY_LABELS`（文案）+ `CATEGORY_HEX`（6 组互不冲突色值）。所有消费点（设置分类下拉、AppDetail 改分类、排行徽章、CategoryOverview 占比图）都从 `Object.entries(CATEGORY_LABELS)` 派生，改一处全生效；`categoryColor` 的回退色硬编码为灰，避免删掉 `unknown` 键后 `?? CATEGORY_HEX.unknown` 变 undefined。
3. `setup_from_handle` 启动时调用一次 `db.reapply_categories()`（幂等，只更新 `category_locked=0` 的自动分类项），让旧数据自动重分类，无需用户手动点「重新分类」。
4. 新增 `auto_categorize` 单测（6 类各命中 + QQ 系列消歧 + 编程助手 vs AI 对话 + 未命中兜底 system）。

**教训**：①「枚举 + 着色 + 判定」这类多端联动（Rust 判定分类、TS 管文案/色值、多处 UI 消费），必须让所有 UI 从同一常量派生，而不是各写一份——否则加/改类别时会漏改某处。② 关键词自动分类，**顺序即优先级**：先判更具体/更强特异的类别（如 QQ 品牌下的 qqmusic 先归视听、qq浏览器先归资源，再判通通讯 qq），再判宽泛项；且刻意避免过短子串（x/go/et/line 这类单双字母会大面积误配）。③ 兜底类直接承接所有未命中项（`system` 而非 `unknown`），保证覆盖率；分类体系变更后要用已有的 `reapply_categories`（尊重手动锁定 `category_locked`）让存量数据生效，否则用户看到新旧分类混杂。④ 换掉枚举键后，老的常量引用（如 `CATEGORY_HEX.unknown`）必须同步清理，否则 `??` 回退到 `undefined` 导致样式失效——TS 类型查不出这类「值选错了」的键，要 grep 一遍消费点。

---

## 66. 官网发版：三处版本必同步 + 网页内容易滞后（2026-08-26）
**发版流程**（AI 代发版）：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 三处 `version` 必须同时改（`Cargo.lock` 的根包 `easytool` 也记版本，一并改）；提交 → `git tag vX.Y.Z` → `git push origin master` + `git push origin vX.Y.Z`，GitHub Actions 的 `Build & Release` 自动构建签名发布，**不要手动 build/上传**。`.superpowers/` 是 brainstorming 可视化服务的临时会话状态，须加进 `.gitignore` 防止误提交。
**网页内容滞后教训**：官网曾长期停在 v0.4.5，而软件已到 v0.5.2+。本次更新发现「快速启动 quicklaunch」模块已被彻底移除、其功能并入 search 模块的「应用中心」，但官网 bento/deep-dive/download/screenshots 仍把它当活跃模块展示。删模块时官网要同步清理：bento Card / deep-dive MODULES 项 / real-* 组件 / download WHAT_YOU_GET / hero 副标题模块列表 / footer 模块列表 / quicklaunch 的 mini 与 real 文件。新增模块（如 timetracker）同样要全量补这几处 + `stats-ticker` 统计 + `changelog`，且 hero 标题「唤出整套效率工具」在 `text-7xl` 会分行留孤儿字「具」，需 `whitespace-nowrap` + 调小字号修正。
**验证**：`cargo test` 61 通过、`npx tsc --noEmit` 通过、`website` 内 `npm run build` 通过；用 Playwright 滚动触发 reveal 后截图逐板块核对（`whileInView`/`Reveal` 只有滚动到才显示，满页截图会全空白）。

---

## 67. 存量模块性能优化：弹窗 helper 收敛、.lnk 缓存、可见性轮询、热键按需重注册（2026-08-26）
**动机**：对已有功能做无副作用的性能/资源优化，集中在四块：弹窗窗口与定位逻辑重复、应用中心每次全量 COM 解析 .lnk、主窗口 keep-alive 隐藏后 30s 轮询空跑、任意模块设置保存都会全局重注册热键。
**关键点**：
1. 弹窗统一收敛到 `lib.rs` 的 `ensure_popup_window` / `show_popup_at` / `popup_position_physical`：剪贴板/搜索/表情/时长统计只保留 label/html/尺寸参数；顺带统一恢复 `popup_size` 并过滤 <400x300 脏值。
2. 应用中心新增 `apps.db` 的 `shortcut_cache(path,target,mtime_ms)`：扫描时按 .lnk 的 mtime 命中缓存，只有新增/变更的快捷方式才走 COM 解析；新增 `shortcut_cache_roundtrip` 单测。
3. 时长统计页 30s 轮询改为「当前 Tab 活跃 + document 可见」双门控，keep-alive 隐藏/弹窗失焦即停止；重新可见时立即补一次刷新，避免数据过期。
4. `set_module_config` 只在 patch 含 `hotkey`/`enabled` 时才调用 `reapply_hotkeys`，改尺寸/阈值等不再 unregister/register 一遍全局热键。
5. 分类重算用指纹（内置 `AUTO_CATEGORIZE_VERSION` + category_rules 顺序字段），启动时指纹没变就跳过全量 `reapply_categories`；手动「重新分类」命令仍强制重跑。
**教训**：不要在 Windows + core.autocrlf 的仓库里对全 crate 跑 `cargo fmt`——会把 35 个文件重新排版/换行造成大面积 churn；恢复时用 `git checkout-index --force` 让 Git 按仓库规则重写工作区换行（`git show > file` 会绕过 smudge，Git 仍报 modified），之后只对目标文件用编辑器小补丁。
**验证**：`cargo test` 62 passed（新增 1 个缓存单测）；`npx tsc --noEmit` 通过。

---

## 68. 时长统计应用名 = exe 主名；用「快捷方式名 → 文件版本信息 → exe 主名」三级解析（2026-08-26）
**现象**：时长统计排行里部分名称是 `msedge`/`code`/`echo-client`，而搜索「应用」Tab 显示 `Microsoft Edge`/`Visual Studio Code`/`秘塔回响`。
**根因**：前台钩子只能拿到 `exe_path`，采集器用 `Path::file_stem()` 直接当 `app_name` 入库，且 `upsert_app` 每次前台切换都会覆盖；搜索「应用」Tab 取的是开始菜单 `.lnk` 主名，数据源本来就更友好。
**解决**：新增 `timetracker/display_name.rs` 三级解析器：① 读 search `apps.db` 的 `shortcut_cache`（target → .lnk 主名，复用已建缓存，不重复 COM 解析）；② `GetFileVersionInfoW` + `VerQueryValueW` 读 exe 的 `FileDescription`（覆盖 UWP/便携/无快捷方式程序，如 `windowsterminal.exe → Windows Terminal Host`、`mipccontinuity.exe → 小米互联服务`）；③ 仍失败保持 exe 主名。`apps` 表新增 `display_name` 列，`app_name` 继续存 exe 主名供分类关键词/用户规则匹配，展示查询统一 `COALESCE(NULLIF(display_name,''), app_name)`；采集线程用内存缓存解析新应用，启动时对存量行幂等回填。
**教训**：①「同一个程序的两种展示名」先分清数据源：搜索有 .lnk 名，前台钩子只有 exe——不能直接要求两边一致，要给采集侧补解析层。② 展示名与判定名分离（`display_name` vs `app_name`），避免友好名破坏 `auto_categorize`/正则规则；exe 路径仍参与分类，风险更小。③ Windows 文件版本信息用 `\\VarFileInfo\\Translation` 枚举语言再查 `FileDescription`，比固定 `040904B0` 语言代码兼容性更好。
**验证**：真实 exe 预演 `msedge → Microsoft Edge`、`code → Visual Studio Code`、`echo-client → 秘塔回响`、`idman → Internet Download Manager`；`cargo test` 64 passed（新增 2 个解析单测）；`npx tsc --noEmit` 通过。

---

## 69. 剪贴板粘贴链路残留旧焦点还原死代码，`tauri dev` 报 3 条 dead_code（2026-08-26）
**现象**：`npm run tauri dev` 启动时 rustc 报 `EM_SETSEL` / `restore_selection` / `restore_focus` never used。
**根因**：`paste_item` 早已改成「隐藏 EasyTool 窗口 → 等 100ms 让 Windows 自然把焦点还给原窗口 → 模拟 Ctrl+V」，旧方案里主动还原前台窗口/焦点控件/选中范围的函数和常量没人再调用，import 也只剩它们在用，所以编译器标为 dead code；不是运行时报错。
**解决**：删掉 `restore_selection`、`restore_focus`、`EM_SETSEL`，并移除仅它们使用的 Win32 import（`SetFocus`/`VK_MENU`/`SetForegroundWindow`/`AttachThreadInput`/`GetCurrentThreadId`），模块顶部流程注释同步更新。`record_foreground` 仍被热键调用予以保留，但它记录的焦点控件/选中范围目前只写不读，后续可单独简化。
**验证**：`cargo test` 64 passed；`tauri dev` 的 3 条 dead_code warning 消失（`cargo test` 里另有存量 unused 变量 `dur1`，只出现在测试编译，不进 dev 构建）。

---

## 70. 主窗口内嵌子 WebView（多 webview）直连 AI 对话网页（2026-08-27）
**需求**：EasyAsk 模块页 = 顶栏（provider 标签）+ 容器区覆盖一个子 WebView 加载 chat.deepseek.com 等外部网页，切 AI = navigate，切走模块 = 隐藏。
**坑 1：`WebviewBuilder::build` 在 Windows 同步命令/事件处理器里死锁**（tauri 2.11 文档明确标注）。建窗必须走 `Window::add_child(builder, pos, size)`（内部 `run_on_main_thread` + channel 同步），且所有建窗命令声明为 `async fn`（同步命令跑在主线程会死锁）。
**坑 2：多 webview API 挂在 `unstable` feature 后面**：`tauri::webview::WebviewBuilder` 是私有路径、`tauri::WebviewBuilder` 重导出和 `Window::add_child` 都被 `#[cfg(feature = "unstable")]` 门控。Cargo.toml 需加 `features = ["unstable"]`（官方多 webview 的标准做法，不影响现有行为）。
**坑 3：`get_webview`/`get_window` 在 `impl AppManager`（内部 trait）上，`WebviewWindow` 拿不到**：2.11 起 `WebviewWindow` 不再 Deref 到 `Window`。取子 WebView 的正确做法是 `add_child` 返回的 `Webview` 存进模块自己的 state（`Mutex<Option<Webview>>`），后续命令从 state 取。
**坑 4：子 WebView 不在 DOM 里**——模块页 keep-alive 用 `hidden` class 隐藏容器，子 WebView 是原生层仍会盖在别的模块上面。进入/离开模块页必须调 `easyask_show`/`easyask_hide` 显式控制，模块卸载时也要 hide。
**坑 5：定位换算**：子 WebView 位置相对窗口客户区，主 webview 满窗铺 → 容器 `getBoundingClientRect()` × `devicePixelRatio` 转物理像素即可；ResizeObserver + window resize 防抖重发。
**坑 6：导航幂等**：`last_url` 比对避免重复 navigate 把页面整页重载（切走再切回不丢聊天状态）；「刷新」用 `eval("location.reload()")`。
**教训**：① 先翻 crate 源码确认 API 门控与可见性（cargo check 报 E0603/E0599 后再看是 feature 门控还是私有路径，别猜）。② 远程子 WebView 是外部内容，拿不到 Tauri IPC，天然安全，无需 capabilities。③ 模块页依赖用 provider id 而非 url：设置里改网址不触发导航，点标签（id 变化）才导航，避免输入时半截网址被打开。
**验证**：`cargo test` 69 passed（新增 normalize_url 单测）；`npx tsc --noEmit` 通过。

---

## 71. 子 WebView 抢焦点触发「失焦自动隐藏」，主窗口一进 EasyAsk 就消失（2026-08-27）
**现象**：点击 EasyAsk 模块 → 子 WebView 创建/显示 → 主窗口立刻隐藏；托盘、热键都再也呼不出来。
**根因**：WebView2 子 WebView 是主窗口的子 HWND，创建/显示时会抢焦点；焦点落在子 HWND 上时 `win.is_focused()` 返回 false，主窗口的 `WindowEvent::Focused(false)` → `hide_after_blur_grace` 判定「失焦」→ 隐藏。此后每次呼出子 WebView 又抢焦点 → 再隐藏，形成死循环。
**解决**：`hide_after_blur_grace` 增加判定——`GetForegroundWindow()` 若为主窗口的子窗口（`IsChild(main_hwnd, fg)`，子 WebView 含在内），视为窗口仍聚焦、不隐藏；建窗后 `win.set_focus()` 兜底把焦点交还主窗口。点外部仍正常隐藏（面板行为不变）。
**教训**：① 多 webview 的焦点是独立 HWND，任何「失焦即隐藏/失焦置灰」逻辑都要把子 webview 焦点算作窗口聚焦。② 排查「窗口神秘消失」先找自动隐藏触发条件（`hide_after_blur_grace` / Focused 事件），不要只盯着事件源头。
**验证**：`cargo test` 67 passed；`npx tsc --noEmit` 通过。

---
## 72. 移除 EasyAsk 模块：六处清理清单 + 发版版本号三处同步（2026-08-27）
**背景**：EasyAsk（主窗口内嵌子 WebView 直连 DeepSeek/Kimi/通义/豆包对话网页）在 v0.6.6 后以实验模块加入（2 个本地提交），体验未达预期决定整体移除。工作区删 471 行、改 48 行后收尾，本条目记录清理清单与两个坑。
**移除清单（6 处，缺一处就有残留）**：
1. `src-tauri/modules/<id>/manifest.json`（打包 resources 清单）
2. `src-tauri/src/modules/<id>/` 整个 Rust 目录 + `src-tauri/src/modules/mod.rs` 的 `pub mod <id>;`
3. `src-tauri/src/lib.rs`：setup 初始化块、`generate_handler!` 里的全部命令注册、模块专用热键/事件特判
4. 前端 `src/modules/<id>/` 整套 + `src/App.tsx` 的 `lazy` import、`PAGE_IMPORTS`、页面挂载
5. 该模块独享的 Cargo feature/依赖（EasyAsk 需 tauri `unstable` feature，移除后一并去掉）
6. 文档：AGENTS.md 的模块列表（与代码同步改，防止下个 AI 会话信了过时文档）
**坑 1：移除模块别只删正面代码，为它而生的特判也要清**：EasyAsk 曾迫使 `hide_after_blur_grace` 加 `IsChild(main_hwnd, fg)` 子 WebView 焦点判定；移除后换成更通用的方案——托盘呼出前注入一次 F24 按键获取前台权限 + `MAIN_FOCUSED_SINCE_SHOW` 呼出保护（show 后没真正拿到过焦点的「失焦」不算点外部）+ 150/400/900ms 焦点重试。同问题（托盘点击 set_focus 失败导致误隐藏）不再依赖多 webview 特判。
**坑 2：发版三处版本号必须同一次提交**：收尾时发现 v0.6.6 的 release commit 只改了 `package.json` + `tauri.conf.json`，`src-tauri/Cargo.toml` 漏在 0.6.2——按 AGENTS.md 发版流程，漏一个会导致构建失败或版本不一致，本次一并同步到 0.6.6。回归 lessons 速查 #11。
**教训**：移除模块后 grep `(?i)<id>` 全仓库（含 website/.github/tools）确认零残留；历史 lessons（##70/##71 多 webview 经验）保留不删，它们是已踩的坑记录。
**验证**：`cargo check` / `cargo test` 66 passed（2 项需 Everything 环境的探测测试 ignored）；`npx tsc --noEmit` + `npm run build`（vite MPA）通过；提交前 `git status`/`git diff` 只含相关文件。
