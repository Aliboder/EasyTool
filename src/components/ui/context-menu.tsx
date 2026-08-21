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
  const [isReady, setIsReady] = useState(false);

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

  // 当 visible 变化时，重置 ready 状态
  useEffect(() => {
    if (visible) {
      setIsReady(false);
    }
  }, [visible]);

  // 菜单渲染到 DOM 后，计算实际位置并显示
  useEffect(() => {
    if (visible && menuRef.current && !isReady) {
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
      setIsReady(true);
    }
  }, [visible, x, y, isReady]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-50 min-w-[180px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        className
      )}
      style={{
        left: isReady ? position.x : -9999,
        top: isReady ? position.y : -9999,
        visibility: isReady ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body
  );
}