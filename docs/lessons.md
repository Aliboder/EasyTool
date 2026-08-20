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