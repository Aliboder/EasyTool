# 进度日志（日程表模块）

## 会话：2026-08-29

### 阶段 1：需求与设计
- **状态：** complete
- 执行的操作：
  - 澄清需求 7 轮（定位=事件+待办合一 / 提醒=事件提前+待办过期 / 重复=全量+例外 / 视图=月+周+日 / 事件字段=基础+地点+备注 / 待办字段=基础+可无截止+备注 / 导入导出=JSON+ICS 都支持）
  - 方案选型：A 规则存储 + 按需展开（用户确认）
  - 分三节设计并逐节确认；写设计文档并提交（77dfd06）
- 创建/修改的文件：
  - `docs/superpowers/specs/2026-08-29-calendar-design.md`
  - `AGENTS.md`（沟通通俗化 + 技术选型由 AI 决定）

### 阶段 2：规划
- **状态：** complete
- 执行的操作：
  - 建立三件套规划文件
- 创建/修改的文件：
  - `task_plan.md` / `findings.md` / `progress.md`

### 阶段 3 · 批次 1：基础台账 + 月视图
- **状态：** complete（待用户手动验收）
- 执行的操作：
  - manifest、后端 db（events/todos/overrides/reminder_logs 全表）、8 条命令、lib.rs 注册、App.tsx 四处接入、Sidebar 图标
  - 月视图（周一起始、今天高亮、选中圈出、事件胶囊/待办点）、当天面板、事件/待办表单抽屉、右键菜单
  - 修正：upsert 先查后插（delete 变体撞 UNIQUE）、窗口命中语义（重叠）、批次 3/4 预留代码 allow(dead_code)
- 创建/修改的文件：
  - `src-tauri/modules/calendar/manifest.json`
  - `src-tauri/src/modules/calendar/{mod,db,commands}.rs`、`src-tauri/src/modules/mod.rs`、`src-tauri/src/lib.rs`
  - `src/modules/calendar/{config.ts,utils.ts,utils.test.ts,Page.tsx}`
  - `src/App.tsx`、`src/components/layout/Sidebar.tsx`

### 阶段 3 · 批次 2：周/日视图 + 待办体验
- **状态：** complete（待用户手动验收）
- 执行的操作：
  - 四 Tab（月/周/日/待办）；配置接管默认视图与周末折叠
  - 周视图：课表样 7 列时间轴（周一起始、全天条带、重叠自动分列、今天红时刻线、周末可折叠）
  - 日视图：单列时间轴 + 当日待办 + 添加入口；月视图点日期跳日视图
  - 待办页：未完成/已逾期/长期/已完成分组，逾期标红，已完成可折叠
  - 时间轴布局 layoutDay 纯函数 + vitest（重叠分列/窗口钳制/全天排除）
- 创建/修改的文件：
  - `src/modules/calendar/{types.ts,views.tsx,Page.tsx,utils.ts,utils.test.ts}`

### 阶段 7：订阅日历（外部日历账号，✅ 已完成，待验收）
- 订阅源管理（名称/URL/颜色/启用/刷新间隔 0-1440min/同步时间/条数），新增可自动首抓、行内编辑、立即刷新、删除（二级确认）
- 后台每 5 分钟检查到期订阅并整份替换（webcal:// 归一化 https；失败保留旧数据）
- get_range 混排订阅事件（只读）：视图按订阅色着色，点击弹详情、右键无编辑菜单
- 后端：subscriptions/feed_events 表 + 7 命令 + 订阅生命周期测试；cargo 114 全绿/零警告、vitest 42、tsc/build 通过
- 视图顺序 日/周/月、默认开日视图（config+manifest 默认值改 day）
- 周视图左侧 0–24 小时刻度轴（日视图也 0 点起）；事件卡片重设计（主题色左边条+时间/地点行+紧凑态）
- ICS 导入升级为「导入源」管理：数据库加 ics_imports 表 + events.ics_import_id 列（增量迁移幂等）；同名重复导入=覆盖更新；设置抽屉「已导入的日历文件」列表可整份删除（连带事件）
- 顶栏左右按钮按视图显示 上一天/下周/下月 等语义
- 验证：cargo 112 全绿、check 零警告；vitest 41；tsc/build 通过
- **状态：** complete（待用户手动验收）
- 执行的操作：
  - JSON 全量备份导出/导入（事件+例外+待办；按标题+开始时刻/标题去重合并，例外经 id 映射接回）
  - ICS 导出（VEVENT：规则+EXDATE 删除型例外、编辑型例外独立 VEVENT；VTODO 含 DUE/STATUS）
  - 前端：导入支持 .ics/.json 自动识别；顶栏「导出」菜单（ICS/JSON）+ 保存对话框
- 创建/修改的文件：`src-tauri/src/modules/calendar/{commands.rs,db.rs,ics.rs}`、`src-tauri/src/lib.rs`、`src/modules/calendar/Page.tsx`
- 验证：cargo 110 全绿、check 零警告、vitest 41、tsc/build 通过
- 执行的操作：
  - 常驻提醒线程（30s 一跳，quota poll_loop 同模式）：事件提前 N 分钟系统通知、待办当日过期一次
  - 睡眠补扫：醒来补查过去 1 小时错过的实例；同一条只提醒一次（reminder_logs 唯一键）
  - 设置项（提前量/开关/周末/默认视图）批次 3 已做，此处线程读同一批配置
- 创建/修改的文件：`src-tauri/src/modules/calendar/{mod.rs,db.rs}`
- 验证：cargo 109 全绿、cargo check 零警告（dev 实例占用 exe 无法链接，属环境限制）
- 执行的操作：
  - 后端：get_range 对重复事件**现场展开实例**并套用例外（delete 剔除 / edit 覆盖）；新增 calendar_override_event 命令；EventDto 增 instance_date
  - 前端：事件表单加「重复」区（每天/每周勾选星期/每月同日/每月第N个星期几 + 可选截止日），重复实例右键四项（编辑此一次/编辑规则/删此一次/删全部）
  - 设置抽屉：事件提前量、待办过期提醒、默认视图、周末显示
  - rrule ←→ 表单纯函数 parseRrule/buildRrule + vitest（往返一致）
- 创建/修改的文件：
  - `src-tauri/src/modules/calendar/{commands.rs,expand.rs}`、`src-tauri/src/lib.rs`
  - `src/modules/calendar/{types.ts,utils.ts,utils.test.ts,Settings.tsx,Page.tsx}`

## 测试结果
| 测试 | 输入 | 预期结果 | 实际结果 | 状态 |
|------|------|---------|---------|------|
| cargo test（后端展开/例外改动回归） | 全量 | 全绿 | 109 passed / 0 failed / 3 ignored | ✅ |
| vitest（含 parseRrule/buildRrule 往返） | 全量 | 全绿 | 41 passed（6 文件） | ✅ |
| tsc / npm run build / cargo build 警告 | 全量 | 无错/零警告 | 通过 | ✅ |

## 错误日志
| 时间戳 | 错误 | 尝试次数 | 解决方案 |
|--------|------|---------|---------|
| | | 1 | |

## 五问重启检查
| 问题 | 答案 |
|------|------|
| 我在哪里？ | 阶段 3 · 批次 1（基础台账 + 月视图） |
| 我要去哪里？ | 批次 2-5：周/日/待办视图 → 重复+例外 → 提醒+设置 → 导入导出 |
| 目标是什么？ | 完成日程表模块，5 批交付验收 |
| 我学到了什么？ | 见 findings.md |
| 我做了什么？ | 需求/设计/规划已全部落盘并提交 |

---
*每个阶段完成后或遇到错误时更新此文件*