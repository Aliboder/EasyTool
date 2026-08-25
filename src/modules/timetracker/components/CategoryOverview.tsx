import type { CategoryBreakdown } from "../types";
import { CATEGORY_LABELS, categoryColor, formatDurationShort } from "../types";

interface Props {
  data: CategoryBreakdown[];
}

/** 单日分类占比：横向堆叠比例条 + 图例 */
export function CategoryOverview({ data }: Props) {
  const total = data.reduce((s, d) => s + d.total_duration_sec, 0);
  const shown = data.filter((d) => d.total_duration_sec > 0);
  if (shown.length === 0 || total <= 0) return null;

  return (
    <div className="rounded-lg border bg-secondary/10 p-4">
      <h3 className="mb-3 text-sm font-medium">分类占比</h3>

      {/* 堆叠比例条 */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {shown.map((d) => (
          <div
            key={d.category}
            className="h-full transition-all"
            style={{
              width: `${(d.total_duration_sec / total) * 100}%`,
              backgroundColor: categoryColor(d.category),
            }}
          />
        ))}
      </div>

      {/* 图例 */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {shown.map((d) => {
          const pct = Math.round((d.total_duration_sec / total) * 100);
          return (
            <div key={d.category} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: categoryColor(d.category) }}
              />
              <span className="min-w-0 flex-1 truncate">
                {CATEGORY_LABELS[d.category] || "其他"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatDurationShort(d.total_duration_sec)}
              </span>
              <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
