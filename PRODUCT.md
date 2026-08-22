# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Windows 桌面效率工具用户（中文为主）：需要快速粘贴历史、监控 AI API 额度、插入表情、搜索文件的个人用户。开发者本人是典型用户（广东工业大学大一学生，个人工具项目）。

## Product Purpose

EasyTool 是一个 Windows 效率工具箱：剪贴板历史（文本/图片/文件）、AI 额度监控（DeepSeek / OpenCode Go 多账户）、表情面板（1900+ 表情）、Everything 文件秒搜。单应用 + 模块注册表架构，每个功能是独立模块，可启停、排序、扩展。

## Positioning

单应用 + 模块注册表架构的 Windows 效率工具箱：不是互不相干的小工具集合，而是一个可扩展的轻量框架；所有数据本地存储（SQLite WAL），密钥只进系统钥匙串（keyring 每账户独立槽位），不依赖任何第三方服务器。Tauri 2 + Rust + React 19。

## Operating Context

Windows 10/11 x64 桌面环境；托盘驻留 + 全局热键（Ctrl+Shift+E 主面板，独立模式 Ctrl+Shift+V/J/F）；跟随鼠标弹窗、失焦自动隐藏；NSIS 安装包、无需管理员权限。数据目录 %APPDATA%\com.aliboder.easytool。

## Capabilities and Constraints

- 模块：clipboard（WM_CLIPBOARDUPDATE + 500ms 轮询兜底、指纹去重、2s 自写守卫、256px 缩略图、pin_order 固定排序）、quota（后台线程轮询、预警/告警双阈值、5000 条历史、消费突增提醒）、emoji（系统字体优先 + canvas 像素检测 + Twemoji 兜底、SendInput 直输）、search（Everything64.dll 动态加载、全局互斥锁、后台线程查询）
- 技术：Tauri 2 / Rust / React 19 / TS / Tailwind v4 / shadcn / Vite MPA / SQLite WAL / keyring / reqwest / chrono
- 版本：v0.4.4（2026-08-20），MIT 许可，36+ 后端单元测试
- 依赖：搜索模块需要用户安装 Everything（免费，MIT）

## Brand Commitments

- 名称：EasyTool（中文名"效率工具箱"），产品名 EASYTOOL
- GitHub：Aliboder/EasyTool（仓库名待最终确认）
- 界面语言：中文
- 视觉基调约束（用户明确）：拒绝玻璃拟态/渐变/圆角/假窗口截图；用户欣赏瑞士编辑排版风格、杂志感、克制动效

## Evidence on Hand

- 代码仓库：D:\SystemFiles\Documents\Project\EasyTool（git tag v0.4.4）
- 落地页现状：easytool.html（瑞士编辑排版风，已 6 轮迭代，用户认可方向但要求更强视觉/交互）
- 模块细节均来自源码（config.rs、modules/*/mod.rs、SmartEmoji.tsx 等）
- 版本历史来自 git log（v0.4.0 → v0.4.4，2026-08-20）
- 不存在：真实产品截图、用户评价、下载量数据、winget 已发布事实（均不得虚构）

## Product Principles

1. 真实优先：页面上出现的每个功能、配置、版本号都必须能在代码/仓库中验证
2. 本地优先：数据本地、密钥进钥匙串、不依赖第三方服务器
3. 模块化：扩展新功能 = 新增模块目录 + manifest，不动其他模块
4. 性能敏感：弹窗延迟创建、增量渲染、分片检测，启动和交互不卡顿

## Accessibility & Inclusion

中文用户界面；明暗双主题；键盘操作（快捷键呼出、键盘导航结果列表）；需遵守 WCAG 对比度 4.5:1 与 prefers-reduced-motion。