import {
  siRust,
  siTauri,
  siReact,
  siTypescript,
  siTailwindcss,
  siVite,
  siSqlite,
} from "simple-icons";

const TECHS = [siRust, siTauri, siReact, siTypescript, siTailwindcss, siVite, siSqlite];

export function TechMarquee() {
  return (
    <div className="relative overflow-hidden border-y border-white/5 bg-zinc-900/40 py-4 backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-zinc-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-zinc-950 to-transparent" />
      <div className="marquee flex w-max gap-10">
        {[...TECHS, ...TECHS, ...TECHS].map((s, i) => (
          <span key={`${s.slug}-${i}`} className="flex items-center gap-2.5 text-sm text-zinc-400 dark:text-zinc-500">
            <svg viewBox="0 0 24 24" className="size-5" fill={s.hex === "000000" ? "#a1a1aa" : `#${s.hex}`}>
              <path d={s.path} />
            </svg>
            {s.title}
          </span>
        ))}
      </div>
    </div>
  );
}
