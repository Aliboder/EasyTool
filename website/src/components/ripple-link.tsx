import { useCallback, useRef, type ComponentProps } from "react";

export function RippleLink({ className, children, ...props }: ComponentProps<"a">) {
  const ref = useRef<HTMLAnchorElement>(null);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      ripple.style.left = `${e.clientX - rect.left}px`;
      ripple.style.top = `${e.clientY - rect.top}px`;
      el.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
      props.onClick?.(e);
    },
    [props.onClick],
  );

  return (
    <a ref={ref} className={`relative overflow-hidden ${className ?? ""}`} onClick={onClick} {...props}>
      {children}
    </a>
  );
}
