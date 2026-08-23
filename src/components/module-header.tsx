import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface HeaderTab {
  id: string;
  label?: string;
  icon?: React.ElementType;
  title?: string;
}

interface SearchConfig {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** 输入框行内右侧的附属内容（加载圈、"共 N 条"等） */
  trailing?: ReactNode;
}

interface ModuleHeaderProps {
  search?: SearchConfig;
  /** 无搜索框模块的第一行左段标题（如额度监控） */
  title?: string;
  meta?: ReactNode;
  /** 第一行最左（弹窗拖拽把手） */
  leading?: ReactNode;
  /** 第一行右端按钮组 */
  actions?: ReactNode;
  tabs?: HeaderTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** 第二行右端次要控件 */
  tabsTrailing?: ReactNode;
}

/**
 * 模块面板头（全项目统一）：第一行 = 搜索框/标题 + 右端按钮组，
 * 第二行 = Tab 栏（可选）。视觉规格与文件搜索模块对齐。
 */
export function ModuleHeader({
  search,
  title,
  meta,
  leading,
  actions,
  tabs,
  activeTab,
  onTabChange,
  tabsTrailing,
}: ModuleHeaderProps) {
  const actionRow = (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>
  );
  return (
    <div className="shrink-0">
      <div className="flex items-center gap-2 border-b p-2">
        {leading}
        {search ? (
          <>
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              onKeyDown={search.onKeyDown}
              ref={search.inputRef}
              placeholder={search.placeholder}
              autoFocus={search.autoFocus}
              autoComplete="off"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {search.trailing}
            {actionRow}
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <h2 className="text-sm font-semibold">{title}</h2>
              {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
            </div>
            {actionRow}
          </>
        )}
      </div>

      {tabs && tabs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
          {/* 行内放不下时自动换行（表情等 Tab 较多的模块），tabsTrailing 始终右对齐 */}
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = t.id === activeTab;
            return (
              <button
                key={t.id}
                title={t.title ?? t.label}
                onClick={() => onTabChange?.(t.id)}
                className={cn(
                  Icon
                    ? "shrink-0 rounded-md p-1.5"
                    : "shrink-0 rounded px-2 py-0.5 text-xs",
                  "transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {Icon ? <Icon className="size-4" /> : t.label}
              </button>
            );
          })}
          {tabsTrailing && (
            <div className="ml-auto flex shrink-0 items-center">{tabsTrailing}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** 面板头标准图标按钮（齿轮/视图切换/刷新等统一用这个） */
export function HeaderButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded p-1.5 transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export interface HeaderSortField {
  id: string;
  label: string;
}

/** 面板头排序控件：字段按钮点击按 fields 顺序循环切换，方向按钮点击升降翻转 */
export function HeaderSort({
  fields,
  value,
  onChange,
  desc,
  onDescToggle,
}: {
  fields: HeaderSortField[];
  value: string;
  onChange: (nextId: string) => void;
  desc: boolean;
  onDescToggle: () => void;
}) {
  const idx = Math.max(
    0,
    fields.findIndex((f) => f.id === value),
  );
  const next = fields[(idx + 1) % fields.length];
  return (
    <div className="flex items-center gap-1 rounded-md border px-1.5 py-0.5">
      <ArrowUpDown className="size-3 text-muted-foreground" />
      <button
        type="button"
        title={`排序依据：${fields[idx].label}（点击切换）`}
        onClick={() => onChange(next.id)}
        className="shrink-0 rounded px-1 text-[11px] leading-5 text-foreground transition-colors hover:bg-accent"
      >
        {fields[idx].label}
      </button>
      <button
        type="button"
        title={desc ? "递减（点击改为递增）" : "递增（点击改为递减）"}
        onClick={onDescToggle}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
      </button>
    </div>
  );
}
