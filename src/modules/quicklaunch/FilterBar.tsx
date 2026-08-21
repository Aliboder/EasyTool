import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  LayoutList,
  AppWindow,
  File,
  Folder,
  Globe,
  Layers,
  Search,
} from "lucide-react";

export type FilterType = "all" | "app" | "file" | "folder" | "url";

interface FilterBarProps {
  filter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
  search: string;
  onSearchChange: (search: string) => void;
}

const filters: { id: FilterType; label: string; icon: React.ElementType }[] = [
  { id: "all", label: "全部", icon: Layers },
  { id: "app", label: "应用", icon: AppWindow },
  { id: "file", label: "文件", icon: File },
  { id: "folder", label: "文件夹", icon: Folder },
  { id: "url", label: "URL", icon: Globe },
];

export function FilterBar({
  filter,
  onFilterChange,
  viewMode,
  onViewModeChange,
  search,
  onSearchChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-1 items-center gap-2">
      <div className="flex items-center gap-1">
        {filters.map((f) => {
          const Icon = f.icon;
          return (
            <button
              key={f.id}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
                filter === f.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
              onClick={() => onFilterChange(f.id)}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{f.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex-1" />
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="搜索..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-7 w-32 rounded-md border bg-transparent pl-7 pr-2 text-xs outline-none focus:w-48 focus:border-primary transition-all"
        />
      </div>
      <button
        onClick={() => onViewModeChange(viewMode === "grid" ? "list" : "grid")}
        aria-label="切换视图"
        title={viewMode === "grid" ? "切换到列表" : "切换到网格"}
        className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {viewMode === "grid" ? <LayoutList className="size-4" /> : <LayoutGrid className="size-4" />}
      </button>
    </div>
  );
}