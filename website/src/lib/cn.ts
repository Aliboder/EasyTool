/** 极简 className 合并（网站未引入 clsx，避免为此加依赖） */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}