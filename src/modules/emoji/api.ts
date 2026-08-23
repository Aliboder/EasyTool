// 表情模块前端数据层：静态 Emoji 列表模块级缓存，动态数据每次拉取合并
import { invoke } from "@tauri-apps/api/core";

export interface StaticEmoji {
  char: string;
  group: string;
  group_zh: string;
  name_en: string;
  keywords_zh: string[];
  code: string | null;
}
export interface CustomEmoji {
  id: number;
  name: string;
  group_id: number | null;
  is_favorite: boolean;
  use_count: number;
  last_used_at: number | null;
  thumb: string | null;
}
export interface GroupDto {
  id: number;
  name: string;
}
export interface Emoji extends StaticEmoji {
  is_favorite: boolean;
  use_count: number;
  last_used_at: number | null;
}
export interface Catalog {
  emoji: Emoji[];
  groups: GroupDto[];
  customs: CustomEmoji[];
}

let staticCache: StaticEmoji[] | null = null;
// 并发合并：focus 风暴/多入口同时加载时共享同一请求，避免重复拉取 + 重复渲染
let inFlight: Promise<Catalog> | null = null;

export function loadCatalog(): Promise<Catalog> {
  if (inFlight) return inFlight;
  inFlight = doLoad().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doLoad(): Promise<Catalog> {
  if (!staticCache) staticCache = await invoke<StaticEmoji[]>("get_emoji_static");
  const dyn = await invoke<{
    usage: Record<string, { is_favorite: boolean; use_count: number; last_used_at: number | null }>;
    groups: GroupDto[];
    customs: CustomEmoji[];
  }>("get_emoji_dynamic");
  const usage = dyn.usage;
  const emoji: Emoji[] = staticCache.map((s) => {
    const u = usage[s.char];
    return {
      ...s,
      is_favorite: u?.is_favorite ?? false,
      use_count: u?.use_count ?? 0,
      last_used_at: u?.last_used_at ?? null,
    };
  });
  return { emoji, groups: dyn.groups, customs: dyn.customs };
}
