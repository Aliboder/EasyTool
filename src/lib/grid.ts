// 网格统一约定：gap、尺寸公式、键盘跨行步进。
// 各模块的格子网格（search/emoji/clipboard）一律使用本文件，
// 规范详见 docs/module-guide.md「网格实现标准」。

export const GRID_GAP = 8;

// 格子内容尺寸公式：图标占格子一半，文字最小可读
export const gridIconSize = (cell: number) => Math.max(cell * 0.5, 24);
export const gridFontScale = (cell: number) => Math.max(cell * 0.15, 10);
/** 卡片格内边距（与外框留出呼吸感，文件/应用卡片共用） */
export const gridPadding = (cell: number) => cell * 0.1;

/**
 * 实测容器的网格列数（用于键盘 ↑↓ 跨行步进）。
 * 以第一个子元素的实际宽度为格子宽，gap 从 computedStyle 读取。
 */
export function gridColumns(el: HTMLElement, cellSelector?: string): number {
  const cell = cellSelector
    ? el.querySelector<HTMLElement>(cellSelector)
    : (el.firstElementChild as HTMLElement | null);
  if (!cell) return 1;
  const cs = window.getComputedStyle(el);
  const gap = Math.max(0, parseFloat(cs.columnGap) || GRID_GAP);
  const padX =
    (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const innerW = el.clientWidth - padX;
  const total = cell.offsetWidth + gap;
  if (total <= 0) return 1;
  return Math.max(1, Math.floor(innerW / total));
}

/**
 * 键盘 ↑↓ 的目标索引：按列数跨行移动并钳制在 [0, total)。
 * dir 为方向；当前无选中（idx < 0）时向下选第一个、向上选最后一个。
 */
export function gridVerticalTarget(
  idx: number,
  dir: 1 | -1,
  total: number,
  cols: number,
): number {
  if (idx < 0) return dir > 0 ? 0 : total - 1;
  return Math.min(total - 1, Math.max(0, idx + dir * cols));
}
