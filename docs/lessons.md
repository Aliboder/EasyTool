# EasyTool 教训与经验记录

本文件记录开发过程中遇到的问题、解决方案和经验教训。每次修复 bug 或解决技术问题后，应将经验记录于此。

---

## 2026-08-19

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

<!-- 新增教训请添加到上方，格式如下：
## YYYY-MM-DD

### 教训标题

**问题描述**：...

**根本原因**：...

**解决方案**：...

**教训**：...

**相关代码**：...
-->