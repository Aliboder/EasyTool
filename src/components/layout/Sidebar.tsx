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
    <aside className="flex h-full w-52 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2 border-b px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Gauge className="size-4" />
        </div>
        <span className="text-sm font-semibold">EasyTool</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {modules.map((m) => {
          const Icon = ICONS[m.icon] ?? Clipboard;
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                active === m.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4" />
              {m.name}
            </button>
          );
        })}
      </nav>

      <div className="border-t p-2">
        <button
          onClick={() => onSelect("settings")}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
            active === "settings"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
          )}
        >
          <Settings className="size-4" />
          设置
        </button>
      </div>
    </aside>
  );
}