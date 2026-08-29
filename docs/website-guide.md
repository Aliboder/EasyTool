# 官网维护指南

> 供 AI Agent 阅读。软件更新时，根据本文档快速定位并更新官网内容。

## 概览

- **位置**：`website/` 目录（独立 Vite + React 工程）
- **线上**：https://aliboder.github.io/EasyTool/
- **部署**：push 到 master 分支 → GitHub Actions 自动构建发布
- **本地预览**：`cd website && npm run dev`

## 目录结构

```
website/
├── src/
│   ├── main.tsx                     # 入口
│   ├── App.tsx                      # 根组件（板块顺序在此定义）
│   ├── index.css                    # 全局样式 + 滚动条 + 动画
│   └── components/
│       ├── nav.tsx                  # 导航栏（锚点列表在此）
│       ├── hero.tsx                 # 海报 Hero（主视觉；版本号不在 Hero 里）
│       ├── stats-ticker.tsx         # 翻转统计条（数字在此）
│       ├── tech-marquee.tsx         # 技术栈滚动条
│       ├── bento.tsx                # 01 六个模块（迷你组件入口）
│       ├── deep-dive.tsx            # 02 模块深潜（特性清单）
│       ├── workflows.tsx            # 03 场景工作流（替代原快捷键板块）
│       ├── pillars.tsx              # 04 设计哲学（代码片段）
│       ├── local-data.tsx           # 05 数据属于你（对比表）
│       ├── dev-zone.tsx             # 为开发者而建（终端/Logo）
│       ├── screenshots.tsx          # 06 真实界面（7个组件）
│       ├── changelog.tsx            # 07 更新日志
│       ├── faq.tsx                  # 08 常见问题
│       ├── download.tsx             # 09 下载
│       ├── version-bar.tsx          # 底部版本条
│       ├── footer.tsx               # 页脚（含版本号）
│       ├── mini-panel.tsx           # Hero 右侧主面板动效（底部模块栏 6 模块 + 设置）
│       ├── scroll-progress.tsx      # 滚动进度条
│       ├── toast.tsx                # Toast 通知系统
│       ├── reveal.tsx               # 滚动入场动画
│       ├── section-head.tsx         # 章节标题（编号+标题）
│       ├── ripple-link.tsx          # 涟漪按钮
│       ├── magnetic-link.tsx        # 磁吸按钮
│       ├── mouse-spotlight.tsx      # 鼠标聚光灯
│       ├── scramble-text.tsx        # 文字解码效果
│       ├── minis/                   # Bento 迷你组件
│       │   ├── clipboard.tsx        # 剪贴板迷你（交互）
│       │   ├── quota.tsx            # 额度迷你（进度条）
│       │   ├── emoji.tsx            # 表情迷你（分类Tab）
│       │   ├── search.tsx           # 搜索迷你（过滤）
│       │   ├── timetracker.tsx      # 时长统计迷你（排行条）
│       │   ├── calendar.tsx         # 日程表迷你（月格 + 课程色 + 重复规则）
│       │   └── item-icon.tsx        # 共享图标映射
│       └── real-*.tsx               # 真实界面组件（7个，用代码绘制，不是截图）
│           ├── real-timetracker.tsx
│           ├── real-main-window.tsx
│           ├── real-clipboard.tsx
│           ├── real-emoji.tsx
│           ├── real-quota-settings.tsx
│           ├── real-calendar.tsx
│           └── real-app-shell.tsx
├── public/
│   └── screenshots/                 # 截图（备用，当前用代码绘制）
├── index.html                       # HTML 入口（dark class 强制）
├── vite.config.ts                   # base: "./"
└── package.json
```

## 板块编号与顺序

App.tsx 中的组件顺序 = 页面从上到下的顺序。编号在各组件的 `SectionHead` 中定义。

| 编号 | 组件 | 板块名 | 何时需要更新 |
|------|------|--------|-------------|
| — | Hero | 海报 | 版本号变化 |
| — | StatsTicker | 统计条 | 数字变化（表情数/测试数等） |
| — | TechMarquee | 技术栈 | 新增技术依赖 |
| 01 | Bento | 六个模块 | 新增/删除模块 |
| 02 | DeepDive | 模块深潜 | 模块特性变化 |
| 03 | Workflows | 场景工作流 | 模块组合/场景变化 |
| 04 | Pillars | 设计哲学 | 架构变化 |
| 05 | LocalData | 数据属于你 | 存储结构变化 |
| — | DevZone | 为开发者而建 | 测试数/技术栈变化 |
| 06 | Screenshots | 真实界面 | UI 变化需更新组件 |
| 07 | Changelog | 更新日志 | 每次发版 |
| 08 | Faq | 常见问题 | 功能变化/用户反馈 |
| 09 | Download | 下载 | 版本号/包大小/系统要求 |

（注：模块无独立热键，原有「快捷键」板块已改为「场景工作流」。）

## 常见更新场景

### 场景 1：发新版本

需要改的地方：

```
1. version-bar.tsx   → FACTS 数组中的 "v0.9.0"
2. download.tsx      → "v0.9.0 · 2026-08-30 发布"（日期/包大小以 GitHub Releases 实际为准）
3. changelog.tsx     → LOG 数组头部新增版本条目
4. footer.tsx        → "MIT License · v0.9.0"
5. stats-ticker.tsx  → 如有新数字（测试数/模块数等）
```

> 版本号**不在** hero.tsx（Hero 主视觉不含版本）；masthead 上的 "Windows 10/11 · x64" 与版本无关。

### 场景 2：新增模块

需要改的地方：

```
1. bento.tsx         → Card 组件新增一个（BENTO 布局需调整 grid）+ minis/ 新增迷你组件
2. deep-dive.tsx     → MODULES 数组新增一项（icon 用 lucide-react 导入，id 用于图标映射）
3. workflows.tsx     → 如有合适的组合场景，SCENARIOS 数组新增/扩展（原 hotkeys 板块已废弃）
4. nav.tsx           → 如需导航锚点，LINKS 数组新增
5. App.tsx           → 如板块顺序变化
6. screenshots.tsx   → MODULES 数组 + renderComponent + real-*.tsx 新增真实界面组件
7. hero.tsx          → 副标题模块列表（p 标签）
8. mini-panel.tsx    → Hero 右侧主面板底栏 MODULES 数组（与 App 底栏一致）
9. download.tsx      → WHAT_YOU_GET 数组（"安装后你会得到"）
10. pillars.tsx      → 热键代码片段里的模块列表（主面板导航段落）
11. local-data.tsx   → TREE 数组（如新增数据文件）
12. stats-ticker.tsx → 如有新统计数字（模块数等）
13. footer.tsx       → 模块列表
```

### 场景 3：修改模块功能

需要改的地方：

```
1. deep-dive.tsx     → MODULES[i].features 更新特性描述
2. bento.tsx → minis/  → 对应迷你组件更新交互/内容
3. real-*.tsx        → 对应真实界面组件更新 UI
4. faq.tsx           → 如影响用户常见问题
```

### 场景 4：修改热键

（模块已无独立热键，只有主窗口呼出热键一个，见 `src-tauri/src/config.rs`）

需要改的地方：

```
1. pillars.tsx       → 热键代码片段更新键名/说明（如需）
2. faq.tsx           → 如影响用户常见问题
```

### 场景 5：修改存储结构

需要改的地方：

```
1. local-data.tsx    → TREE 数组更新文件列表
2. pillars.tsx       → 代码片段更新
3. faq.tsx           → 如影响迁移/数据问题
```

## 数据来源

网站中的数据必须与软件保持一致。以下是各数据的来源：

| 数据 | 来源 | 位置 |
|------|------|------|
| 版本号 | `package.json` 或 `Cargo.toml` | 根目录 |
| 模块列表 | `src-tauri/modules/*/manifest.json` | 各模块目录 |
| 默认热键 | `src-tauri/src/config.rs` | `hotkeys.insert(...)` |
| 测试数量 | `cargo test` 输出 | `src-tauri/` |
| 表情数量 | `src/modules/emoji/data/emoji.json` | 行数 |
| 技术栈 | `package.json` + `Cargo.toml` | 根目录 |
| 更新日志 | `git log --oneline` | 终端 |
| UI 布局 | `src/modules/*/` | 各模块前端文件 |

## 真实界面组件

`real-*.tsx` 文件是用 React 代码绘制的软件 UI，不是截图。更新时：

1. 读取对应的 `src/modules/*/` 前端代码
2. 提取布局结构、颜色、交互模式
3. 用 Tailwind 在 `real-*.tsx` 中重建
4. 添加简单的点击/hover 交互

## 构建与部署

```bash
# 本地开发
cd website && npm run dev

# 构建验证
npm run build  # tsc + vite build

# 部署（自动）
git add website && git commit -m "feat(website): ..." && git push origin master
# → GitHub Actions 自动构建发布，约 30 秒生效
```

## 注意事项

- **暗色模式**：全站强制暗色（index.html `class="dark"`），不要加浅色模式
- **配色**：翡翠绿 `emerald-500` 为唯一强调色，不要引入其他颜色
- **字体**：Space Grotesk（英文/数字）+ 系统中文字栈，通过 `@fontsource-variable/space-grotesk` 自托管
- **图标**：`lucide-react`（项目已有依赖）+ `simple-icons`（技术栈 Logo，内联 SVG）
- **动画**：`motion/react` 库，所有动画需兼容 `prefers-reduced-motion`
- **滚动条**：全局已美化（CSS `!important` + 内联 style），新组件如需滚动容器无需额外处理
- **不要用截图**：真实界面用 React 组件绘制，不用 PNG/JPG

## 易踩坑清单

以下是从实际维护中总结的常见遗漏，**每次更新务必逐项核对**：

### 新增模块时的完整检查清单

新增一个模块时，**不仅**要改 Bento 和 DeepDive，还必须同步以下所有位置：

```
✅ 已改（容易想到的）：
  1. bento.tsx           → 新增 Card + 迷你组件
  2. deep-dive.tsx       → MODULES 数组新增 Tab
  3. minis/              → 新增迷你组件文件
  4. real-*.tsx          → 新增真实界面组件（如需要）
  5. screenshots.tsx     → 引入新真实界面组件

❌ 容易遗漏的：
  6. hero.tsx            → 副标题 p 标签中的模块列表
  7. mini-panel.tsx      → Hero 右侧主面板底栏 MODULES 数组
  8. download.tsx        → WHAT_YOU_GET 数组（"安装后你会得到"）
  9. pillars.tsx         → 热键代码片段里的模块列表
  10. workflows.tsx      → 如需在场景工作流中体现新模块
  11. changelog.tsx      → LOG 数组头部新增版本条目
  12. version-bar.tsx    → FACTS 数组中的版本号
  13. footer.tsx         → 页脚模块列表（含 MIT License · vX.X.X）
  14. stats-ticker.tsx   → 如有新统计数字（模块数等）
  15. nav.tsx            → LINKS 数组（如需导航锚点）
  16. App.tsx            → 板块顺序（如需要）
```

### 版本号更新的完整检查清单

版本号出现在**多个位置**，改漏一个就会不一致：

```
1. version-bar.tsx      → FACTS "vX.X.X"
2. download.tsx         → "vX.X.X · YYYY-MM-DD 发布"
3. changelog.tsx        → LOG 数组头部
4. footer.tsx           → "MIT License · vX.X.X"
5. package.json         → version（软件版本，非官网）
6. Cargo.toml           → version（软件版本，非官网）
7. tauri.conf.json      → version（软件版本，非官网）
```

（hero.tsx 不含版本号，无需改。）

### 删除/重命名模块时的检查清单

```
1. bento.tsx            → 删除 Card + 移除迷你组件导入
2. deep-dive.tsx        → MODULES 数组删除对应项
3. minis/               → 删除迷你组件文件
4. real-*.tsx           → 删除真实界面组件
5. screenshots.tsx      → 移除导入和渲染
6. hero.tsx             → 副标题移除模块名
7. mini-panel.tsx       → 底栏 MODULES 数组移除
8. download.tsx         → WHAT_YOU_GET 移除条目
9. pillars.tsx          → 热键代码片段移除
10. workflows.tsx       → 场景工作流移除引用
11. footer.tsx          → 页脚模块列表移除
```

> **特例：功能并入另一模块**（如 `quicklaunch` 快速启动 → `search` 的应用中心）。不仅要按上面删除 quicklaunch 的全部引用，还要在承接模块（search）的描述中补上该能力（deep-dive 特性、bento desc、download WHAT_YOU_GET），避免"功能凭空消失"。

### 残留文件清理

更新后检查是否有不再使用的文件：

```bash
# 查找未被引用的组件
grep -r "from.*\./old-component" website/src/
# 或检查 tsconfig 的 noUnusedLocals
```

常见残留：
- 旧的样式文件（如 stats-band.tsx 被 stats-ticker.tsx 替代后）
- 旧的工具组件（如 theme-toggle.tsx 在暗色锁定后不再使用）
- 临时测试文件

### 网站与软件版本同步

网站描述的功能必须与**当前代码**一致，不能超前也不能落后：

```bash
# 检查当前模块列表
ls src-tauri/modules/

# 检查当前版本
grep '"version"' package.json

# 检查最近变更
git log --oneline -20
```

## 文件依赖

新增组件时注意 `package.json` 已有依赖：

```
react, react-dom, motion, lucide-react, simple-icons, @fontsource-variable/space-grotesk
```

不要重复安装已有依赖。如需新依赖，先检查 `package.json`。
