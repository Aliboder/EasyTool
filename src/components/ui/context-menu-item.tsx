import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ContextMenuItemProps {
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
  submenu?: boolean;
  children?: ReactNode;
}

export function ContextMenuItem({
  icon,
  label,
  onClick,
  className,
  submenu,
  children,
}: ContextMenuItemProps) {
  if (submenu && children) {
    return (
      <div className="relative group">
        <button
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
            className
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {icon}
          <span className="flex-1 text-left">{label}</span>
          <span className="text-muted-foreground">▶</span>
        </button>
        <div className="absolute left-full top-0 hidden min-w-[120px] rounded-md border bg-popover p-1 shadow-md group-hover:block">
          {children}
        </div>
      </div>
    );
  }

  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
        className
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}