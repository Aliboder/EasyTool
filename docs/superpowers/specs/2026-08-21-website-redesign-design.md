# EasyTool 官网重设计（活演示 Bento）

日期：2026-08-21 · 状态：已确认（用户在对话中批准，本文档为存档）

## 背景与目标

旧官网（`website/`，瑞士编辑风多页站）效果不佳。本次原地重建为**单页长滚动**官网，
视觉方向完全重新设计：**每个模块用真实可交互的迷你组件现场演示**（非截图、非假窗口）。

## 设计定位

中文 Windows 效率工具用户的工具产品官网。「现场演示」语言——访客不下载就能感受到产品手感。

## 视觉系统

| 项目 | 决定 |
|---|---|
| 字体 | Space Grotesk（英文标题/数字，@fontsource-variable 自托管）+ 系统中文字栈 |
| 强调色 | 翡翠绿单强调色锁全页；中性色 zinc 系；拒绝 AI 紫/渐变滥用 |
| 圆角规则 | 卡片 16px（rounded-2xl）、按钮/标签 pill，全页统一 |
| 主题 | 明暗双主题：默认跟随系统 + 手动切换（localStorage 记忆） |
| 动效 | motion/react 滚动入场 + 迷你组件微交互；prefers-reduced-motion 全部降级静态 |

设计刻度：VARIANCE 7 / MOTION 6 / DENSITY 4。

## 页面结构（7 节，布局家族互不重复）

1. **Nav** 64px：字标 + 锚点 + 主题切换 + GitHub 图标
2. **Hero**：左大标题 + 下载 CTA（GitHub Releases latest）；右侧活体迷你剪贴板弹窗自动循环「复制→入列」动画
3. **模块 Bento**：4 格不对称网格——剪贴板大格 / 额度小格 / 搜索小格 / 表情宽格；每格内嵌真实迷你组件：
   - 剪贴板：悬停显示操作、点击固定
   - 额度：SVG 折线余额曲线（入场描画动画）
   - 搜索：真输入即时过滤的假数据列表
   - 表情：可点选的表情网格
4. **三卖点**：01/02/03 编辑排版大数字——本地优先 / 模块化架构 / 全局热键驱动
5. **真实界面**：2 个截图槽位（16:9 主窗口 + 4:3 弹窗），带尺寸标注，用户后补真图
6. **版本条**：v0.4.4 · MIT · Windows 10/11 · 数据本地存储
7. **Footer**：GitHub / 作者 Aliboder / 许可

内容红线：版本号、模块名等事实以 PRODUCT.md 为准，不虚构下载量/评价/截图。

## 技术

- 原地重建 `website/src`，保留 Vite/Tailwind v4/TS 骨架
- 删 `react-router-dom`（单页不需要）；增 `@fontsource-variable/space-grotesk`；motion/lucide-react 复用
- `vite.config.ts` base = `/EasyTool/`
- 新增 `.github/workflows/deploy.yml`：push main 自动发布 GitHub Pages
- 验证：`npx tsc --noEmit` + `npm run build` 通过；用户本地 preview 亲自验收

## 实施清单

1. 清理旧代码、更新依赖
2. 主题 tokens + 字体接入
3. Nav / Hero（含 MiniClipboardPopup）
4. Bento 四组件
5. 三卖点 / 截图槽位 / 版本条 / Footer
6. Pages workflow + base 路径
7. 构建验证 → 提交 → 用户验收清单

## 待补素材（用户）

- 真实界面截图 ×2（槽位尺寸见代码标注）
