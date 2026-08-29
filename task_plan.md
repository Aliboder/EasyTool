# 任务计划：日程表模块（calendar）

## 目标
完成 EasyTool「日程表」模块：事件 + 待办合一、月/周/日/待办四视图、重复事件（含仅此一次例外）、系统通知提醒、JSON + ICS 双向导入导出；按 5 批交付，每批用户可验收。设计文档：`docs/superpowers/specs/2026-08-29-calendar-design.md`（已确认）。

## 当前阶段
阶段 3 · 批次 1（基础台账 + 月视图）→ in_progress

## 各阶段

### 阶段 1：需求与设计（✅ 已完成）
- [x] 需求澄清（定位/提醒/重复/视图/字段/导入导出，用户逐项确认）
- [x] 方案选型（A 规则存储 + 按需展开，用户确认）
- [x] 设计文档 `docs/superpowers/specs/2026-08-29-calendar-design.md` 用户审阅通过
- **状态：** complete

### 阶段 2：规划（🆕 本次建立）
- [x] 建立 task_plan / findings / progress 三件套
- **状态：** complete

### 阶段 3：实现（分 5 批，每批完整验证后交付验收）
#### 批次 1：基础台账 + 月视图（当前）
- [ ] manifest.json + Sidebar ICON + App.tsx lazy/PAGE_IMPORTS/renderModules 四处接入
- [ ] 后端：calendar.db（events/todos 表）、CRUD 命令、get_range、setup_from_handle、lib.rs 注册
- [ ] 前端：config.ts + Page（月视图 + 右侧抽屉表单 + 右键菜单）+ 月/日切换入场
- [ ] 验证：cargo test / build 零警告 / tsc / vitest / build；手动验收清单
- **状态：** in_progress

#### 批次 2：周/日视图 + 待办体验
- [ ] 周视图时间轴（课表样色块 + 全天区 + 当前时刻线 + 周末折叠设置）
- [ ] 日视图时间轴 + 今日待办区
- [ ] 待办页分组（未完成/逾期/长期/已完成）+ 勾选
- [ ] 验证 + 验收清单
- **状态：** pending

#### 批次 3：重复 + 例外
- [ ] 后端 RRULE 子集 + expand 纯函数（Rust）双单测
- [ ] 前端 TS expand 双实现 + vitest 同批用例
- [ ] event_overrides 表 + 仅此一次交互（右键）
- [ ] 表单加重复区（每天/每周勾选/每月同日/每月第N个星期X/截止）
- [ ] 验证 + 验收清单
- **状态：** pending

#### 批次 4：提醒 + 设置
- [ ] 常驻提醒线程 + reminder_logs 去重 + 睡眠补扫
- [ ] 事件提前 N 分钟 / 待办过期当日一次
- [ ] 设置抽屉（开关/提前量/默认视图/周末折叠）
- [ ] 验证 + 验收清单
- **状态：** pending

#### 批次 5：导入导出收尾
- [ ] JSON 双向（去重合并）
- [ ] ICS 导入（ical crate + 行折叠/转义/坏条目容错）与导出
- [ ] 全量验证 + 完整验收清单 + 发版咨询
- **状态：** pending

### 阶段 4：测试与验证（随批次内执行）
- [ ] 每批 cargo test 全绿、cargo build 零警告、tsc/vitest/build 通过
- [ ] 用户手动验收清单交付
- **状态：** pending

### 阶段 5：交付
- [ ] 全部 5 批验收通过
- [ ] 整理发版（若用户要求）
- **状态：** pending

## 关键问题
1. 周视图周末折叠默认显示（已定：默认显示）→ 已解决
2. ICS 导入遇不支持规则（INTERVAL>1 等）→ 降级单次 + 提示（spec 已定）
3. 全天事件 end_ms 口径（已定：当日 23:59:59）

## 已做决策
| 决策 | 理由 |
|------|------|
| 规则存储(RRULE) + 按需展开（方案 A） | 改一处全跟、ICS 零转换、无膨胀、纯函数双测试 |
| 提醒用常驻轮询线程（quota poll_loop 模式） | 已有成熟样板；30s 一跳成本可忽略 |
| ICS 解析用 `ical` crate、生成手写子集 | 轻依赖；子集可控可测 |
| 展开函数 Rust+TS 双实现同批用例 | 前端即时渲染 + 后端一致性兜底 |
| 例外用独立 overrides 表（edit/delete 双变体） | 不污染主表；删除规则级联干净 |
| 时间一律本地时间、全天按本地日 | 项目坑 23 约定；避免跨日错账 |

## 遇到的错误
| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
| （暂无，实施中记录） | 1 | |

## 备注
- 阶段状态：pending → in_progress → complete；每批结束更新 progress.md
- 实施严格对照 `docs/module-guide.md`（接入四步、坑 1-23、配置三件套）
- 与用户沟通一律通俗易懂（AGENTS.md 约定）；验收清单用启动命令 + 手动验证点