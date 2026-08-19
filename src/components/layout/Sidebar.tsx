import { Clipboard, Gauge, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SidebarModule {
  id: string;
  name: string;
  icon: string;
}

const ICONS: Record<string, typeof Clipboard> = {
  clipboard: Clipboard,
  gauge: Gauge,
};

interface Props {
  modules: SidebarModule[];
  active: string;
  onSelect: (id: string) => void;
}

export function Sidebar({ modules, active, onSelect }: Props) {
  return (
    <aside className="flex h-14 shrink-0 items-center gap-1 border-t bg-sidebar px-3 text-sidebar-foreground">
      <span className="mr-3 shrink-0 text-sm font-semibold">EasyTool</span>

      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {modules.map((m) => {
          const Icon = ICONS[m.icon] ?? Clipboard;
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className={cn(
                "flex shrink-0 flex-col items-center gap-0.5 rounded-md px-3 py-1 transition-colors",
                active === m.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="text-[10px] leading-none">{m.name}</span>
            </button>
          );
        })}
      </nav>

      <button
        onClick={() => onSelect("settings")}
        className={cn(
          "flex shrink-0 flex-col items-center gap-0.5 rounded-md px-3 py-1 transition-colors",
          active === "settings"
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        )}
      >
        <Settings className="size-4 shrink-0" />
        <span className="text-[10px] leading-none">设置</span>
      </button>
    </aside>
  );
}
