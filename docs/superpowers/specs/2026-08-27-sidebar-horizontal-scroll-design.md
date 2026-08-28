# 底栏模块按钮横向滚动设计文档

## 1. 概述

### 1.1 需求背景

窗口宽度较小时（最小宽度 400px），底栏（Sidebar）的 5 个模块按钮放不下，溢出部分被裁剪不可见、无法点击。希望鼠标悬停在底栏上滚动滚轮时，底栏按钮左右平移，露出被挤出的按钮。

### 1.2 目标

- 底栏按钮溢出时，鼠标滚轮（垂直方向）可横向平移按钮区
- 溢出时给出视觉提示（两侧淡出渐变遮罩），且遮罩随滚动位置联动
- 不溢出时不劫持滚轮，不影响其他区域

### 1.3 非目标（YAGNI）

- 不做两端箭头按钮（点击平移）
- 不做按钮压缩/换行方案
- 不改动「EasyTool」标题与「设置」按钮的行为（它们固定在外侧，不会被挤出）

## 2. 现状

### 2.1 底栏结构（`src/components/layout/Sidebar.tsx`）

```
<aside class="flex h-14 ... px-3">
  <span>EasyTool</span>                        ← 固定，shrink-0
  <nav class="flex flex-1 ... overflow-x-auto"> ← 模块按钮区，可横向溢出
    {modules.map(...)}                          ← 5 个模块按钮，shrink-0
  </nav>
  <button>设置</button>                          ← 固定，shrink-0
</aside>
```

- `<nav>` 已有 `overflow-x-auto`：理论上可横向滚动，但鼠标滚轮（垂直 deltaY）不触发横向滚动，Chromium 默认滚动条细且遮挡，体验上等于"按钮被挤出点不到"
- 「设置」按钮在 nav 外固定展示，不受影响；被挤出的是 nav 内的模块按钮

### 2.2 现成工具（`src/lib/use-horizontal-wheel.ts`）

已实现「滚轮 → 横向滚动」：监听 nav 的 `wheel` 事件（`passive: false`），仅在 `scrollWidth > clientWidth`（溢出）时把 `deltaY` 转为 `scrollLeft` 并 `preventDefault`，不溢出时不劫持。**直接复用，无需修改。**

## 3. 方案

### 3.1 交互

- 在 nav 上挂 `useHorizontalWheel` 的 ref：鼠标悬停在模块按钮区滚动滚轮 → 按钮左右平移（滚轮向下 = 内容左移，看右侧按钮，与触摸板/滚动条同向）
- 只在溢出时生效（工具内置判断），不溢出时滚轮事件不 preventDefault，不干扰上方内容区滚动

### 3.2 溢出提示

- `ResizeObserver` 监听 nav：`overflow = scrollWidth > clientWidth`（模块增减、窗口缩放自动更新）
- 遮罩渲染在 aside 内（nav 之后）、`absolute` 定位相对 aside、覆盖 nav 左右两端各一层淡出渐变（`pointer-events-none`），暗示"两边还有按钮"
- **遮罩随滚动位置联动**：
  - `showLeft = overflow && scrollLeft > 0`（没滚到最左才显示左侧遮罩）
  - `showRight = overflow && scrollLeft < scrollWidth - clientWidth - 1`（没滚到最右才显示右侧遮罩，1px 容差）
- 遮罩颜色取底栏背景色（`bg-sidebar`），由近及远渐变到透明，宽度约 24px

### 3.3 滚动条

- 隐藏 nav 的横向滚动条，避免底栏 56px 高度内出现丑滚动条：`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`，用 Tailwind arbitrary 属性内联（`[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`），不加全局样式

### 3.4 状态与性能

- aside 加 `relative`，遮罩 `absolute` 定位相对 aside 覆盖 nav 两端；遮罩非滚动内容、不随按钮平移
- 滚动状态更新用普通 setState（按钮区节点极少，重渲染开销可忽略；不做 rAF 节流等过度优化）
- 遮罩用 `pointer-events-none`，不拦截按钮点击

## 4. 改动文件

| 文件 | 改动 |
|------|------|
| `src/components/layout/Sidebar.tsx` | nav 挂 `useHorizontalWheel` ref；`ResizeObserver` + `scroll` 事件维护 `{overflow, showLeft, showRight}` 状态；渲染左右遮罩；nav 加滚动条隐藏类；aside 加 `relative` |
| `src/lib/use-horizontal-wheel.ts` | 不改（直接复用） |

无后端改动、无配置改动、无新依赖。

## 5. 边界情况

- 窗口缩到最小 400px：5 个模块按钮溢出，滚轮可平移、遮罩显示
- 窗口放大到按钮全部显示：溢出为 false，遮罩不渲染，滚轮不劫持
- 模块启用/禁用、排序变化：ResizeObserver 触发重新检测
- 滚到最左/最右：对应侧遮罩消失，避免"到头了还提示"的误导
- 标题/设置按钮永远可见（现状保持）

## 6. 验收清单（人工验收，前端无测试框架）

1. 启动应用 → 缩小窗口到底栏按钮溢出 → 鼠标悬停底栏滚动滚轮，按钮左右平移
2. 溢出时两侧出现淡出渐变遮罩；滚到最左侧时左遮罩消失、右遮罩仍在；反之亦然
3. 窗口拉大到不溢出 → 遮罩消失、滚轮不产生平移
4. 底栏无横向滚动条
5. 模块按钮仍可正常点击切换
6. `npx tsc --noEmit` 通过