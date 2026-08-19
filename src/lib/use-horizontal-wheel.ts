import { useCallback, useRef } from "react";

// 滚轮 → 横向滚动（垂直滚动时把 deltaY 转成 scrollLeft，preventDefault 阻止页面滚动）
export function useHorizontalWheel<T extends HTMLElement>() {
  const nodeRef = useRef<T | null>(null);
  const ref = useCallback((node: T | null) => {
    nodeRef.current = node;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0 && node.scrollWidth > node.clientWidth) {
        node.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
  return { ref, nodeRef };
}
