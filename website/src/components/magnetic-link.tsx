import { useCallback, useRef } from "react";
import type { ComponentProps } from "react";

export function MagneticLink({ className, children, ...props }: ComponentProps<"a">) {
  const ref = useRef<HTMLAnchorElement>(null);

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) * 0.15;
    const dy = (e.clientY - cy) * 0.15;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  }, []);

  const onLeave = useCallback(() => {
    if (ref.current) ref.current.style.transform = "";
  }, []);

  return (
    <a
      ref={ref}
      className={className}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      {...props}
    >
      {children}
    </a>
  );
}
