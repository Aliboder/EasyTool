# 底栏模块按钮横向滚动 — 实现计划

**目标**：底栏按钮溢出时滚轮左右平移 + 溢出遮罩提示（规格见 `docs/superpowers/specs/2026-08-27-sidebar-horizontal-scroll-design.md`）
**改动范围**：仅 `src/components/layout/Sidebar.tsx`（约 +40 行）；`useHorizontalWheel` 复用不改；无后端/配置/依赖改动
**估算**：S（2-4 小时），单文件顺序实现，无并行

## 实施步骤

| # | 任务 | 依赖 | Done 标准 |
|---|------|------|-----------|
| 1 | nav 挂滚轮 + 隐藏滚动条：nav 外包 `min-w-0 flex-1 relative` 容器；nav 用组合 ref 复用 `useHorizontalWheel`；加 `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden` | - | `tsc` 通过；窄窗滚轮可平移 |
| 2 | 溢出/位置状态：`ResizeObserver`（窗口缩放）+ `useEffect([modules])`（模块增减）+ `onScroll` → `{overflow, atStart, atEnd}` 三态 | 1 | 三种触发源都更新状态 |
| 3 | 遮罩渲染：容器内左右各一个 `absolute inset-y-0 w-6` 渐变层（`from-sidebar to-transparent`、`pointer-events-none`），`overflow && !atStart` 显示左、`overflow && !atEnd` 显示右 | 2 | 溢出显示、到头单侧消失 |
| 4 | 全量验证：`npx tsc --noEmit`；对照 spec 第 6 节验收清单 6 条人工验收 | 3 | 全部通过 |

## 依赖关系

```
1 (滚轮+滚动条) ──> 2 (状态) ──> 3 (遮罩) ──> 4 (验证)
```

## 风险与对策

| 风险 | 影响 | 概率 | 对策 |
|------|------|------|------|
| `ResizeObserver` 不触发内容宽度变化（模块增减时 nav 自身尺寸不变） | 中 | 确定发生 | `useEffect([modules])` 主动重测，RO 只负责窗口缩放 |
| 组合 ref 与 `useHorizontalWheel` ref 清理链 | 低 | 中 | 手动保存 `wheelRef(node)` 的 cleanup 并在组合 cleanup 中先执行 |
| WebView2 对滚动条隐藏类支持 | 低 | 低 | `scrollbar-width` + `::-webkit-scrollbar` 双写 |

## 明确不做

- 两端箭头按钮、拖拽平移、平滑惯性（YAGNI）
- 改 `useHorizontalWheel`、改主题/全局样式