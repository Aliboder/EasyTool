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
│       ├── hero.tsx                 # 海报 Hero（版本号/masthead）
│       ├── stats-ticker.tsx         # 翻转统计条（数字在此）
│       ├── tech-marquee.tsx         # 技术栈滚动条
│       ├── bento.tsx                # 01 四个模块（迷你组件入口）
│       ├── deep-dive.tsx            # 02 模块深潜（特性清单）
│       ├── hotkeys.tsx              # 03 快捷键（键盘可视化）
│       ├── pillars.tsx              # 04 设计哲学（代码片段）
│       ├── local-data.tsx           # 05 数据属于你（对比表）
│       ├── dev-zone.tsx             # 为开发者而建（终端/Logo）
│       ├── screenshots.tsx          # 06 真实界面（5个组件）
│       ├── changelog.tsx            # 07 更新日志
│       ├── faq.tsx                  # 08 常见问题
│       ├── download.tsx             # 09 下载
│       ├── version-bar.tsx          # 底部版本条
│       ├── footer.tsx               # 页脚
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
│       │   └── item-icon.tsx        # 共享图标映射
│       └── real-*.tsx               # 真实界面组件（5个）
│           ├── real-main-window.tsx
│           ├── real-clipboard-popup.tsx
│           ├── real-emoji-popup.tsx
│           ├── real-quota-settings.tsx
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
| 01 | Bento | 四个模块 | 新增/删除模块 |
| 02 | DeepDive | 模块深潜 | 模块特性变化 |
| 03 | Hotkeys | 快捷键 | 热键变化 |
| 04 | Pillars | 设计哲学 | 架构变化 |
| 05 | LocalData | 数据属于你 | 存储结构变化 |
| — | DevZone | 为开发者而建 | 测试数/技术栈变化 |
| 06 | Screenshots | 真实界面 | UI 变化需更新组件 |
| 07 | Changelog | 更新日志 | 每次发版 |
| 08 | Faq | 常见问题 | 功能变化/用户反馈 |
| 09 | Download | 下载 | 版本号/包大小/系统要求 |

## 常见更新场景

### 场景 1：发新版本

需要改的地方：

```
1. hero.tsx          → masthead 中的版本号 "0.4.4" → "0.5.0"
2. version-bar.tsx   → FACTS 数组中的 "v0.4.4"
3. download.tsx      → "v0.4.4 · 2026-08-20 发布"
4. changelog.tsx     → LOG 数组头部新增版本条目
5. stats-ticker.tsx  → 如有新数字（测试数/表情数等）
```

### 场景 2：新增模块

需要改的地方：

```
1. bento.tsx         → Card 组件新增一个（BENTO 布局需调整 grid）
2. deep-dive.tsx     → MODULES 数组新增一项
3. hotkeys.tsx       → 如有独立热键，HOTKEYS 数组新增
4. nav.tsx           → 如需导航锚点，LINKS 数组新增
5. App.tsx           → 如板块顺序变化
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

需要改的地方：

```
1. hotkeys.tsx       → HOTKEYS 数组更新键名/描述
2. hotkeys.tsx       → Keyboard 组件的 rows 数组（如新增键位）
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

## 文件依赖

新增组件时注意 `package.json` 已有依赖：

```
react, react-dom, motion, lucide-react, simple-icons, @fontsource-variable/space-grotesk
```

不要重复安装已有依赖。如需新依赖，先检查 `package.json`。
