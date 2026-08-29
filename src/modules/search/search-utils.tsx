// 搜索模块纯工具（无 UI 依赖，便于单测）
import type { ReactNode } from "react";

export interface SearchResultDto {
  name: string;
  path: string;
  full_path: string;
  size: number | null;
  modified_ms: number | null;
  is_folder: boolean;
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "avif", "tif", "tiff"];

export function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.includes(ext);
}

export function fmtSize(bytes: number | null): string {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes as number;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

export function fmtTime(ms: number | null): string {
  if (ms == null) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 过滤 Everything 功能前缀，提取用于高亮的关键词 */
export function extractKeywords(query: string): string[] {
  return query
    .replace(/\b(ext|folder|size|path|date|dupe|len|regex|ws|mult|nouni|noext|nopath|nocase|whole|pure|case|diacritics):\S*/gi, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 1);
}

/** 搜索命中高亮（多关键词全部命中） */
export function Highlight({ text, keywords }: { text: string; keywords: string[] }) {
  if (!keywords.length) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let lastIdx = 0;
  for (const kw of keywords) {
    const lkw = kw.toLowerCase();
    let idx = lower.indexOf(lkw, lastIdx);
    while (idx !== -1) {
      if (idx > lastIdx) parts.push(text.slice(lastIdx, idx));
      parts.push(
        <mark key={`${idx}-${kw}`} className="rounded bg-primary/20 text-foreground">
          {text.slice(idx, idx + kw.length)}
        </mark>,
      );
      lastIdx = idx + kw.length;
      idx = lower.indexOf(lkw, lastIdx);
    }
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return <>{parts.length ? parts : text}</>;
}

/** 最近启动的相对时间（今天/昨天/N天前；0 = 未记录 → 空串） */
export function fmtRecent(ms: number): string {
  if (ms <= 0) return "";
  const day = 24 * 3600 * 1000;
  const diff = Date.now() - ms;
  if (diff < day) return "今天";
  if (diff < 2 * day) return "昨天";
  return `${Math.floor(diff / day)}天前`;
}