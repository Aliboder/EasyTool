import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Clipboard, Clock, Gauge, Settings, Smile, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHorizontalWheel } from "@/lib/use-horizontal-wheel";

export interface SidebarModule {
  id: string;
  name: string;
  icon: string;
}

const ICONS: Record<string, typeof Clipboard> = {
  clipboard: Clipboard,
  clock: Clock,
  gauge: Gauge,
  smile: Smile,
  search: Search,
  bot: Bot,
};

interface Props {
  modules: SidebarModule[];
  active: string;
  onSelect: (id: string) => void;
}

export function Sidebar({ modules, active, onSelect }: Props) {
  const navRef = useRef<HTMLElement | null>(null);
  const { ref: wheelAttach } = useHorizontalWheel<HTMLElement>();
  // 溢出检测状态：overflow=按钮区宽度超出；atStart/atEnd=是否滚到最左/最右（决定遮罩显示）
  const [overflow, setOverflow] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const updatePos = useCallback(() => {
    const node = navRef.current;
    if (!node) return;
    setAtStart(node.scrollLeft <= 0);
    setAtEnd(node.scrollLeft >= node.scrollWidth - node.clientWidth - 1);
  }, []);

  const measure = useCallback(() => {
    const node = navRef.current;
    if (!node) return;
    setOverflow(node.scrollWidth > node.clientWidth);
    updatePos();
  }, [updatePos]);

  // 模块增减会改变 nav 内容宽度，而 ResizeObserver 只观察元素自身尺寸（不观察内容）
  useEffect(() => {
    measure();
  }, [modules, measure]);

  // 组合 ref：挂滚轮（复用 useHorizontalWheel）+ 溢出测量（ResizeObserver + scroll）
  const navRefCallback = useCallback(
    (node: HTMLElement | null) => {
      navRef.current = node;
      if (!node) return;
      const detachWheel = wheelAttach(node);
      const ro = new ResizeObserver(measure);
      ro.observe(node);
      const onScroll = () => updatePos();
      node.addEventListener("scroll", onScroll, { passive: true });
      measure();
      return () => {
        ro.disconnect();
        node.removeEventListener("scroll", onScroll);
        if (detachWheel) detachWheel();
        navRef.current = null;
      };
    },
    [wheelAttach, measure, updatePos],
  );

  return (
    <aside className="flex h-14 shrink-0 items-center gap-1 border-t bg-sidebar px-3 text-sidebar-foreground">
      <span className="mr-3 shrink-0 text-sm font-semibold">EasyTool</span>

      <div className="relative min-w-0 flex-1">
        <nav
          ref={navRefCallback}
          className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
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

        {/* 溢出提示：按钮区左右两端淡出渐变，暗示还有更多按钮；pointer-events-none 不挡点击 */}
        {overflow && !atStart && (
          <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-sidebar to-transparent" />
        )}
        {overflow && !atEnd && (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-sidebar to-transparent" />
        )}
      </div>

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