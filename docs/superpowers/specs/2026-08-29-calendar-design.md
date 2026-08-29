# 日程表模块设计（calendar）

- 日期：2026-08-29
- 状态：待审阅（用户审阅通过后进入实施计划）
- 关联文档：`docs/module-guide.md`（新增模块指南）、`AGENTS.md`

## 1. 背景与目标

EasyTool 新增「日程表」模块：**事件 + 待办合一**的本地日历，用户用系统通知到点提醒。参照手机日历（月格、今天高亮、快捷添加、提前提醒）与课表软件（周视图时段块、按星期几重复、休息日折叠）的交互习惯设计。

目标用户：非技术用户（沟通保持通俗），技术选型由 AI 定，用户提意见与验收。

## 2. 需求（用户视角）

- 事件：标题 / 开始-结束时刻 / 全天开关 / 地点 / 备注；**重复**（每天 / 每周勾选多天 / 每月同日 / 每月第 N 个星期 X / 可选截止日期），重复事件支持「仅此一次」例外（改或删单次）
- 待办：标题 / 可选截止日（无日期 = 长期待办）/ 备注 / 完成勾选
- 提醒（系统通知，可全局关）：事件提前 N 分钟（0/5/10/30/60，默认 10）；待办今天截止且未完成 → 当日提醒一次
- 视图：月 / 周 / 日 三级 + 待办清单页（未完成 / 逾期标红 / 已完成 / 长期待办分组）
- 导入导出：JSON 全量备份恢复 + ICS 双向（VEVENT + VTODO 常见子集）
- 本地存储，离线可用，不联网

## 3. 架构选型（方案 A：规则存储 + 按需展开）

**结论**：重复事件在台账里只存一条"规则"（标准 RRULE 子集字符串）；查询某个日期范围时，由纯函数把它"展开"成每一次的日期时间；「仅此一次」例外单独一张表。

**理由**（通俗）：把"每周一三五开例会"当作一条规则而不是 100 条记录——改规则只改一条，所有后续日期自动跟随；展开是轻量计算，个人日历数据量下毫秒级；这条规则恰好与手机日历通用的 ICS 格式同构，导入导出零转换损失。选型对比见附录 A。

## 4. 数据模型

`calendar.db`（SQLite，与现有模块同模式）：

```
events:
  id            INTEGER PK
  title         TEXT NOT NULL
  location      TEXT DEFAULT ''
  notes         TEXT DEFAULT ''
  all_day       INTEGER (0/1)
  start_ms      INTEGER  -- 本地毫秒。全天=该日 00:00；非全天=开始时刻
  end_ms        INTEGER  -- 本地毫秒。全天=该日 23:59:59；非全天=结束时刻
  rrule         TEXT NULL -- 非空=重复（子集见第 5 节）
  created_ms, updated_ms INTEGER

event_overrides:
  id            INTEGER PK
  event_id      INTEGER NOT NULL (FK events.id, ON DELETE CASCADE)
  instance_date INTEGER NOT NULL -- 被例外的那一天（本地日 yyyymmdd）
  variant       TEXT NOT NULL CHECK (variant IN ('edit','delete'))
  title/location/notes/all_day/start_ms/end_ms 可空（edit 时覆盖；delete 忽略）
  UNIQUE (event_id, instance_date)

todos:
  id, title, notes, due_date INTEGER NULL(本地日), done INTEGER, done_at_ms NULL,
  created_ms, updated_ms

reminder_logs:
  id, kind TEXT('event'|'todo'), ref_id INTEGER, instance_date INTEGER NULL,
  sent_ms INTEGER, UNIQUE(kind, ref_id, instance_date)
```

- 时间口径：一律本地时间（`chrono::Local` / JS `Date`）；全天事件按本地日，不受时区影响（沿用项目坑 23 约定）
- 排序：事件按 start_ms、待办按 done + due_date（NULL 最后）

## 5. RRULE 子集与展开

**存储/传输格式**：标准 RRULE 字符串，与 ICS 的 `RRULE` 字段直接映射：
- `FREQ=DAILY`
- `FREQ=WEEKLY[;BYDAY=MO,TU,WE,TH,FR]`（BYDAY 缺省 = 起始日；支持任意多选，含周末，正是课表"重复日勾选"）
- `FREQ=MONTHLY`（每月同日，自动钳制到月底最后一天，如 31 日在 2 月）或 `FREQ=MONTHLY;BYDAY=MO[;BYMONTHDAY=1..5]` 语义（每月第 N 个星期 X）
- `[;UNTIL=YYYYMMDD[THHMMSSZ]]`（可选截止）
- 暂不支持：INTERVAL>1、BYMONTH、负数 BYDAY、COUNT、跨多年窗口外处理（YAGNI；ICS 导入遇不支持规则 → 该事件降级为单次并提示）

**展开函数** `expand(start_ms, rrule, window_start, window_end) -> Vec<Instance>`：
- 纯函数，无 IO；Rust + TS 双实现，双套单测（同一批用例）
- 实例以「本地日」为主键生成；UNTIL（截止）含界判断
- 查询流程：`get_range` = 全表事件 → 展开命中窗口的实例 → 查 overrides（delete 剔除 / edit 覆盖字段）→ 与单次事件合并排序返回

## 6. 提醒机制

- `setup_from_handle` 起常驻线程（复用 quota 的 `poll_loop` 模式：模块禁用时 5s 低频巡检，启用后按节拍扫描；每 30s 一跳）
- **事件**：扫 `[now, now + 提前量]` 内首个实例且 reminder_logs 无记录 → 通知「⏰ N 分钟后有日程：标题」+ 写日志（启动会补查睡眠期间错过的）
- **待办**：due_date == today && 未完成 && 当日无日志 → 通知「📌 今日待办未完成：标题」一次
- 提前量变化立即生效（每次扫描读 config）；全局开关读 config
- 通知复用既有 `tauri_plugin_notification`；托盘无角标需求

## 7. 导入导出

- **JSON**：全量导出 `{events:[], overrides:[], todos:[], exported_at}`；导入按 id 去重跳过已存在（追加合并），成功/跳过条数回报
- **ICS**：解析用 `ical` crate（轻、专注解析），生成手写同子集（避免重依赖）
  - VEVENT：SUMMARY / LOCATION / DESCRIPTION / DTSTART（date 型 = 全天）/ DTEND / RRULE
  - VTODO：SUMMARY / DESCRIPTION / DUE（date 型）/ STATUS(COMPLETED) 
  - 规范化：行折叠（75 octets）、文本转义（`\, \; \n`）；坏条目跳过并计数
- 导入范围：可导入"事件"或"事件+待办"两态；时区处理用本地时区（VTIMEZONE 冲突时按本地）

## 8. 前端页面与交互

单页面模块，`ModuleHeader` 四个页签：**月 / 周 / 日 / 待办**；设置 = 模块内 Drawer（齿轮）。

**月视图**（默认，参手机日历）：7 列星期表头；今天主题色高亮；每格显示事件小条（按开始时间排）+ 待办圆点，溢出 "+N"；点格跳日视图；顶栏左右翻月 + 「今天」按钮；顶部显示年月。

**周视图**（参课表软件）：7 列（周一~周日）+ 纵向时间轴（06:00–24:00，每小时刻度）；事件 = 时间段色块定位（顶部对齐、按冲突左右分列）；全天事件在列首独立区；当前时刻红色指示线 + 右侧剩余时间；周末可折叠（设置项，默认显示）。

**日视图**：纵向时间轴列表，事件为块（含地点/备注），编辑/删除右键；下方「今日待办」区。

**待办页**：分组 = 未完成 / 逾期（红，标"N 天"）/ 长期（无日期）/ 已完成（收起可展开）；点圆圈勾选；右键编辑/删除。

**添加/编辑**（全视图）：右下角悬浮 +（手机 App 惯例）；表单 = 标题 / 开始 / 结束 / 全天开关 / 地点 / 备注 / 重复（不重复 / 每天 / 每周-勾选星期 / 每月同日 / 每月第 N 个星期 X）/ 截止（可空）。事件保存校验：结束不得早于开始。

**例外实例**：右键重复事件 →「仅此一次」→ 改(弹同款表单，落 overrides edit) / 删（overrides delete）。规则事件本身右键编辑只改规则（已存在例外不丢失）；删除规则 = 连带例外级联删。

**设置抽屉**：提醒开关 / 提前分钟（5/10/30/60）/ 待办过期提醒开关 / 默认视图（月/周/日）/ 周末折叠（周视图）。

**提醒样式**：系统通知标题「⏰ 日程提醒」/「📌 待办提醒」，正文见第 6 节。

## 9. 边界与容错

- 结束早于开始：保存拦截
- 每月 31 日重复遇不足 31 天的月份：钳制到该月最后一天（展开函数内，含单测）
- 电脑睡眠/改时钟：醒后补扫，reminder_logs 去重保证不重发
- 删除重复规则：级联删例外；「仅此一次」依赖规则存在
- 导入坏文件：逐条容错，回报成功/跳过条数，不崩溃
- 大窗口展开性能：毫秒级（展开为内存计算）；月/年切换即时

## 10. 测试计划

- 后端单测（`cargo test`，目标 +30 左右）：
  - expand：DAILY / WEEKLY 多选 / MONTHLY 同日+月底钳制 / MONTHLY 第 N 个星期 X / UNTIL 截止 / 跨年
  - overrides：edit 覆盖、delete 剔除、规则变更后例外保留
  - 提醒去重（reminder_logs 唯一键）；导入解析（ICS 转义/行折叠/坏条目）
  - db 增删改查 + 级联
- 前端单测（vitest）：pricing 式纯函数双实现——展开、日期工具（本地日键、月底钳制、周起始）
- 端到端：人工验收清单（分 5 批，见第 11 节）
- 质量门：`cargo build` 零警告、`cargo test` 全绿、`tsc` / `vitest` / `npm run build` 通过

## 11. 里程碑（5 批，每批可验收）

1. **基础台账 + 月视图**：db、事件/待办 CRUD 命令、月视图渲染、添加/编辑表单、右键删除
2. **周/日视图 + 待办体验**：周时间轴、日时间轴、待办页分组勾选、今天高亮/跳转
3. **重复 + 例外**：RRULE 子集 + 双端展开 + overrides、「仅此一次」交互、ICS 导入解析（复用解析器）
4. **提醒 + 设置**：提醒线程、reminder_logs、设置抽屉、周末折叠
5. **导入导出收尾**：JSON 双向、ICS 导出（含待办）、完成验收

## 附录 A：选型对比（内部参考，用户沟通用通俗版）

| 方案 | 机制 | 优点 | 缺点 |
|---|---|---|---|
| A 规则存储+按需展开（选定） | 存一条规则，查询时现算每次 | 改一处全跟、ICS 零转换、无膨胀、展开纯函数可测 | 要自写展开（子集可控） |
| B 物化展开 | 存好每一实例 | 查询最简 | 改规则要重建、膨胀、ICS 反向聚合麻烦 |
| C 规则+按月缓存 | A 加缓存 | 大窗快 | 多一套一致性逻辑，个人数据量无必要 |

## 附录 B：实施偏差记录（2026-08-30 更新）

1. **ICS 导入提前落地**（用户提供真实课表文件，需求优先级提升）：解析用现成 `ical` crate 0.10、展开用现成 `rrule` crate 0.14（纯 Rust RFC 5545 实现），**不再手写日历算法**（原第 5 节"展开函数自写"改为"字段薄解析 + rrule crate 运算"；"每月同日钳制到月末"作为唯一本地化微调叠加在 crate 结果上，RFC 原语义为跳过）。
2. **导入物化策略**（原第 7 节"保留规则"调整）：导入时把重复规则**当场展开成逐节实例**写入（课表导入后月视图全学期可见、改单节课不影响其它节）；批次 3 的"规则改一处全跟"能力面向用户新建的重复事件保留。真实课表验证：30 门课 → 207 条实例、0 跳过、0 不支持。
3. 依赖变更：新增 ical 0.10 + rrule 0.14；测试基线 109（另有真实文件 ignored 校验测试）。