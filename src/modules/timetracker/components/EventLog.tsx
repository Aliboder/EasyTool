import { useMemo } from "react";
import type { Event } from "../types";
import { formatDuration, formatDurationShort } from "../types";
import { Clock, MoveRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  events: Event[];
  /** 该记录是否是今天 */
  isToday?: boolean;
}

/** 取 "HH:MM" */
function hhmm(s: string): string {
  return s.split(" ")[1]?.slice(0, 5) ?? s;
}

interface Group {
  appId: number;
  name: string;
  time: string;
  dur: number;
  idleDur: number;
  /** 该段开始时离开的应用（链式：离开 X → 打开 Y） */
  left: string | null;
}

/**
 * 使用记录：按时间顺序的「切换流水」——每行 = 时间 / 离开的软件 → 打开的软件 / 时长 / 状态。
 * 相邻两条会话是「上一条离开、这一条打开」。
 * 但同应用内部的窗口变化 / 活跃-挂机分割会拆出多条同 app 事件（看似 A→A），
 * 这里按 app 合并成一条，让流水只有真实的应用切换。
 */
export function EventLog({ events, isToday = false }: Props) {
  const groups = useMemo(() => {
    const out: Group[] = [];
    for (const e of events) {
      const g = out[out.length - 1];
      if (g && g.appId === e.app_id) {
        g.dur += e.duration_sec;
        g.idleDur += e.is_active !== 1 ? e.duration_sec : 0;
      } else {
        out.push({
          appId: e.app_id,
          name: e.app_name,
          time: e.start_time,
          dur: e.duration_sec,
          idleDur: e.is_active !== 1 ? e.duration_sec : 0,
          left: out.length > 0 ? out[out.length - 1].name : null,
        });
      }
    }
    return out;
  }, [events]);

  if (groups.length === 0) return null;

  // 最新在最上面：倒序显示，链式「离开 X → 打开 Y」仍指向它开始前的那个应用
  const display = [...groups].reverse();

  return (
    <div className="rounded-lg border bg-secondary/10 p-4">
      <h3 className="mb-3 text-sm font-medium">
        使用记录{isToday ? "" : `（${groups[0].time.slice(0, 10)}）`}
      </h3>
      <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
        {display.map((g) => {
          const activeDur = g.dur - g.idleDur;
          const status = (
            g.idleDur === 0
              ? { label: "活跃", cls: "bg-emerald-500/15 text-emerald-600" }
              : activeDur === 0
                ? { label: "挂机", cls: "bg-muted text-muted-foreground" }
                : { label: `含挂机 ${formatDurationShort(g.idleDur)}`, cls: "bg-amber-500/15 text-amber-600" }
          );
          return (
            <div
              key={`${g.appId}-${g.time}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent/40"
              title={`${g.time} · 时长 ${formatDuration(g.dur)}`}
            >
              <span className="flex w-12 shrink-0 items-center gap-1 tabular-nums text-muted-foreground">
                <Clock className="size-3" />
                {hhmm(g.time)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {g.left ? (
                  <>
                    <span className="text-muted-foreground">{g.left}</span>
                    <MoveRight className="mx-1 inline size-3 text-muted-foreground/70" />
                  </>
                ) : null}
                <span className="font-medium">{g.name}</span>
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatDuration(g.dur)}
              </span>
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", status.cls)}>
                {status.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
