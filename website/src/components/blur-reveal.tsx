import { motion, useInView } from "motion/react";
import { useRef } from "react";

interface BlurRevealProps {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "h2" | "h3" | "p" | "span";
}

import type { ReactNode } from "react";

export function BlurReveal({ children, delay = 0, className, as = "div" }: BlurRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });

  const Tag = motion[as] || motion.div;

  return (
    <Tag
      ref={ref}
      className={className}
      initial={{ filter: "blur(8px)", opacity: 0, y: 20 }}
      animate={inView ? { filter: "blur(0px)", opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </Tag>
  );
}
