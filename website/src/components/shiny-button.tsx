import type { ComponentProps } from "react";

export function ShinyButton({ className, children, ...props }: ComponentProps<"a">) {
  return (
    <a
      className={`group relative overflow-hidden ${className}`}
      {...props}
    >
      {/* shimmer effect */}
      <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      <span className="relative z-10 flex items-center gap-2">{children}</span>
    </a>
  );
}
