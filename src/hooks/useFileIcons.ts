import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * 文件图标/缩略图按路径缓存（内部去重并发请求，重复加载同一路径直接跳过）。
 * - icons[path] ：文件关联图标（get_file_icon）
 * - thumbs[path]：图片文件缩略图（get_file_thumb）
 *
 * loadIcon/loadThumb 返回 Promise<void>（已缓存时立即 resolve），
 * 既可散点触发也可收集进 Promise.all 批量等待。
 */
export function useFileIcons() {
  const [icons, setIconsState] = useState<Record<string, string>>({});
  const [thumbs, setThumbsState] = useState<Record<string, string>>({});
  const iconsRef = useRef(icons);
  const thumbsRef = useRef(thumbs);
  const pending = useRef({ icon: new Set<string>(), thumb: new Set<string>() });

  const loadIcon = useCallback((path?: string): Promise<void> => {
    if (!path || iconsRef.current[path] || pending.current.icon.has(path)) return Promise.resolve();
    pending.current.icon.add(path);
    return invoke<string | null>("get_file_icon", { path })
      .then((b) => {
        if (b) {
          iconsRef.current = { ...iconsRef.current, [path]: b };
          setIconsState(iconsRef.current);
        }
      })
      .catch(() => {})
      .finally(() => {
        pending.current.icon.delete(path);
      });
  }, []);

  const loadThumb = useCallback((path?: string): Promise<void> => {
    if (!path || thumbsRef.current[path] || pending.current.thumb.has(path)) return Promise.resolve();
    pending.current.thumb.add(path);
    return invoke<string | null>("get_file_thumb", { path })
      .then((b) => {
        if (b) {
          thumbsRef.current = { ...thumbsRef.current, [path]: b };
          setThumbsState(thumbsRef.current);
        }
      })
      .catch(() => {})
      .finally(() => {
        pending.current.thumb.delete(path);
      });
  }, []);

  return { icons, thumbs, loadIcon, loadThumb };
}
