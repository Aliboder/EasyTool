import type { ReactNode } from "react";

/**
 * 板块标题：左侧翡翠竖线 + 字词眉标 + 大标题 + 副标题。
 * 不使用编号眉标（数字只出现在功能性场景），眉标一律为语义化短词。
 */
export function SectionHead({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-6">
      <div className="min-w-0">
        {eyebrow && (
          <p className="flex items-center gap-2 font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-500 dark:text-emerald-400">
            <span aria-hidden className="h-5 w-[3px] rounded-full bg-emerald-500" />
            {eyebrow}
          </p>
        )}
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-4xl">
          {title}
        </h2>
        {sub && (
          <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            {sub}
          </p>
        )}
      </div>
      {children && (
        <div className="hidden shrink-0 font-mono text-[11px] text-zinc-500 dark:text-zinc-500 md:block">
          {children}
        </div>
      )}
    </div>
  );
}