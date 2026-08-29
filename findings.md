# 发现与决策（日程表模块）

## 需求（用户确认版）
- 事件 + 待办合一；事件：标题/开始-结束/全天/地点/备注；待办：标题/可选截止/备注/勾选
- 重复事件（每天/每周勾选多天/每月同日/每月第 N 个星期 X/可选截止）+ 「仅此一次」例外（改/删单次）
- 系统通知提醒：事件提前 N 分钟（默认 10，可选 0/5/30/60）、待办今天截止未完成当日一次；可全局关
- 视图：月/周/日三视图 + 待办清单页（未完成/逾期标红/长期/已完成）
- JSON + ICS 双向导入导出；本地离线
- 交互参考：手机日历（月格/今天高亮/右下 + /提前提醒）、课表软件（周视图时段块/按星期几重复/周末折叠）

## 研究发现（实现要点）
- 现有基建全部可复用：rusqlite/chrono/notification/ModuleHeader/useModuleConfig/Drawer/ContextMenu/右键三件套/poll_loop 模式/camelCase↔snake_case 配置
- 新增依赖仅 `ical`（ICS 解析）；展开函数手写
- 模块接入四步（App.tsx lazy + PAGE_IMPORTS + renderModules + Sidebar ICONS）与坑清单见 `docs/module-guide.md`
- 时间口径：本地时间；SQLite 无内置时区，统一存本地毫秒/本地日 yyyymmdd；统计/分组按本地日
- 提醒去重：reminder_logs(kind, ref_id, instance_date) 唯一键

## 技术决策
| 决策 | 理由 |
|------|------|
| 方案 A：规则存储(RRULE) + 按需展开 | 见 task_plan「已做决策」 |
| ICS 解析用现成 `ical` crate（0.10） | 不重复造轮子；行折叠/分段/字段解析全交它 |
| RRULE 展开用现成 `rrule` crate（0.14，RFC5545 实现） | 不手写日历算法；BYDAY/INTERVAL/UNTIL/第N个星期X 全支持；仅"每月同日钳制到月末"按设计在此补一层（RFC 为跳过） |
| expand 为纯函数（Rust 侧基于 rrule；TS 侧批次 3 同步同批用例） | 前端即时 + 后端一致性 |
| ICS 导入采用**物化展开**（用户需求，先于批次 3） | 课表导入后月视图全学期可见；改单节课不影响其它；规则编辑（批次 3）面向用户新建 |
| overrides 表 edit/delete 变体 | 例外不污染主表 |
| 提醒线程 30s 一跳 + 睡眠补扫 | quota 样板 |
| JSON 导入按 id 去重追加合并 | 简单安全 |

## 遇到的问题
| 问题 | 解决方案 |
|------|---------|
| 自写展开曾用全角逗号夹具导致测试误判 | 字节级调试定位：代码转义完好，是测试期待错误，改半角 |
| rrule crate 的 DateTime 是 chrono 类型、NWeekday 为枚举 | 读 crate 源码确认 API 后适配 |

## 资源
- 设计文档：`docs/superpowers/specs/2026-08-29-calendar-design.md`
- 新增模块指南：`docs/module-guide.md`
- 参照实现：quota（轮询/配置/抽屉）、clipboard（右键菜单/表单）、search（ModuleHeader 参照）、emoji（配置三件套）

## 视觉/浏览器发现
- 采用手机日历 + 课表软件交互参照（用户口述方向），无浏览器调研产出。周视图色块定位细节待实现时按「顶部对齐 + 冲突左右分列」落实。

---
*每执行 2 次查看/浏览器/搜索操作后更新此文件*
*防止视觉信息丢失*