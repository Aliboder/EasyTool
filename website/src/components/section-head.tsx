import type { ReactNode } from "react";

export function SectionHead({
  no,
  title,
  sub,
  children,
}: {
  no: string;
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-end gap-6">
      <span className="outline-num text-6xl md:text-8xl lg:text-9xl">{no}</span>
      <div className="min-w-0">
        <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
          {title}
        </h2>
        {sub && (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{sub}</p>
        )}
      </div>
      {children && <div className="ml-auto hidden shrink-0 font-display text-xs uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500 md:block">{children}</div>}
    </div>
  );
}
