import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function ContextMenu({
  visible,
  x,
  y,
  onClose,
  children,
  className,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPositionCalculated, setIsPositionCalculated] = useState(false);

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // 延迟添加事件监听，避免立即触发
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [visible, onClose]);

  // ESC 键关闭
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  // 当 visible 或 x, y 变化时，重置位置计算状态
  useEffect(() => {
    if (visible) {
      setIsPositionCalculated(false);
    }
  }, [visible, x, y]);

  // 菜单显示后，使用实际尺寸计算位置
  useEffect(() => {
    if (visible && menuRef.current && !isPositionCalculated) {
      const menuRect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 8;

      let newX = x;
      let newY = y;

      // 右侧超出：菜单显示在鼠标左侧
      if (newX + menuRect.width > viewportWidth - padding) {
        newX = x - menuRect.width;
      }

      // 底部超出：菜单显示在鼠标上方
      if (newY + menuRect.height > viewportHeight - padding) {
        newY = y - menuRect.height;
      }

      // 左侧超出：确保不超出左边界
      if (newX < padding) {
        newX = padding;
      }

      // 顶部超出：确保不超出上边界
      if (newY < padding) {
        newY = padding;
      }

      setPosition({ x: newX, y: newY });
      setIsPositionCalculated(true);
    }
  }, [visible, x, y, isPositionCalculated]);

  // 初始位置：使用鼠标坐标（避免闪现）
  const displayPosition = isPositionCalculated ? position : { x, y };

  if (!visible) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-50 min-w-[180px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        className
      )}
      style={{ left: displayPosition.x, top: displayPosition.y }}
    >
      {children}
    </div>,
    document.body
  );
}