import { useCallback, useRef } from "react";
import type { ReactNode } from "react";

export function MouseSpotlight({ children }: { children: ReactNode }) {
  const glowRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = glowRef.current;
    if (!el) return;
    const rect = el.parentElement!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.background = `radial-gradient(circle 350px at ${x}% ${y}%, rgba(16,185,129,0.07), transparent)`;
  }, []);

  const onLeave = useCallback(() => {
    if (glowRef.current) glowRef.current.style.background = "none";
  }, []);

  return (
    <div className="group/spotlight relative" onMouseMove={onMove} onMouseLeave={onLeave}>
      <div ref={glowRef} className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
