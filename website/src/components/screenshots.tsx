import { ImagePlus } from "lucide-react";
import { Reveal } from "./reveal";

function Slot({
  ratio,
  label,
  size,
  className,
}: {
  ratio: string;
  label: string;
  size: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500 ${ratio} ${className ?? ""}`}
    >
      <ImagePlus className="size-6" />
      <p className="text-sm font-medium">{label}</p>
      <p className="font-display text-xs">{size}</p>
    </div>
  );
}

export function Screenshots() {
  return (
    <section id="screenshots" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
          真实界面
        </h2>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          主窗口与剪贴板弹窗，一睹为快。
        </p>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Reveal>
          {/* TODO: 替换为真实主窗口截图，建议尺寸 1600×1000 */}
          <Slot ratio="aspect-video" label="主窗口截图 · 待补" size="1600 × 1000" />
        </Reveal>
        <Reveal delay={0.08}>
          {/* TODO: 替换为真实剪贴板弹窗截图，建议尺寸 1280×960 */}
          <Slot ratio="aspect-[4/3]" label="剪贴板弹窗截图 · 待补" size="1280 × 960" />
        </Reveal>
      </div>
    </section>
  );
}
