/**
 * 右键菜单智能定位工具
 * 确保菜单完全显示在窗口内，避免被窗口边缘截断
 */

interface MenuPosition {
  x: number;
  y: number;
}

/**
 * 计算菜单的智能定位位置
 * @param mouseX 鼠标X坐标
 * @param mouseY 鼠标Y坐标
 * @param menuWidth 菜单宽度（预估）
 * @param menuHeight 菜单高度（预估）
 * @param padding 距离边界的最小间距
 * @returns 调整后的菜单位置
 */
export function calculateMenuPosition(
  mouseX: number,
  mouseY: number,
  menuWidth: number,
  menuHeight: number,
  padding: number = 8
): MenuPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let x = mouseX;
  let y = mouseY;
  
  // 右侧超出：菜单显示在鼠标左侧
  if (x + menuWidth > viewportWidth - padding) {
    x = mouseX - menuWidth;
  }
  
  // 底部超出：菜单显示在鼠标上方
  if (y + menuHeight > viewportHeight - padding) {
    y = mouseY - menuHeight;
  }
  
  // 左侧超出：确保不超出左边界
  if (x < padding) {
    x = padding;
  }
  
  // 顶部超出：确保不超出上边界
  if (y < padding) {
    y = padding;
  }
  
  return { x, y };
}

/**
 * 预估右键菜单的尺寸
 * @param itemCount 菜单项数量
 * @returns 预估的宽度和高度
 */
export function estimateMenuSize(itemCount: number): { width: number; height: number } {
  // 每个菜单项高度约 32px，加上 padding
  const itemHeight = 32;
  const padding = 8; // 上下 padding
  const width = 180; // 菜单宽度
  
  return {
    width,
    height: itemCount * itemHeight + padding * 2,
  };
}