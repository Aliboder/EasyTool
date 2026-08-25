import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * 鏂囦欢鍥炬爣/缂╃暐鍥炬寜璺緞缂撳瓨锛堝唴閮ㄥ幓閲嶅苟鍙戣姹傦紝閲嶅鍔犺浇鍚屼竴璺緞鐩存帴璺宠繃锛夈€? * - icons[path] 锛氭枃浠跺叧鑱斿浘鏍囷紙get_file_icon锛? * - thumbs[path]锛氬浘鐗囨枃浠剁缉鐣ュ浘锛坓et_file_thumb锛? *
 * loadIcon/loadThumb 杩斿洖 Promise<void>锛堝凡缂撳瓨鏃剁珛鍗?resolve锛夛紝
 * 鏃㈠彲鏁ｇ偣瑙﹀彂涔熷彲鏀堕泦杩?Promise.all 鎵归噺绛夊緟銆? */
export function useFileIcons() {
  const [icons, setIconsState] = useState<Record<string, string>>({});
  const [thumbs, setThumbsState] = useState<Record<string, string>>({});
  const iconsRef = useRef(icons);
  const thumbsRef = useRef(thumbs);
  const pending = useRef({ icon: new Set<string>(), thumb: new Set<string>() });
  // 鎻愬彇澶辫触锛堣繑鍥?null锛夌殑璺緞涔熺紦瀛橈紝閬垮厤姣忔娓叉煋閮介噸鏂拌姹?+ 鍥炬爣闂伆
  const missingIcon = useRef(new Set<string>());
  const missingThumb = useRef(new Set<string>());

  const loadIcon = useCallback((path?: string): Promise<void> => {
    if (
      !path ||
      iconsRef.current[path] ||
      missingIcon.current.has(path) ||
      pending.current.icon.has(path)
    )
      return Promise.resolve();
    pending.current.icon.add(path);
    return invoke<string | null>("get_file_icon", { path })
      .then((b) => {
        if (b) {
          iconsRef.current = { ...iconsRef.current, [path]: b };
          missingIcon.current.delete(path);
          setIconsState(iconsRef.current);
        } else {
          missingIcon.current.add(path);
        }
      })
      .catch(() => { missingIcon.current.add(path); })
      .finally(() => {
        pending.current.icon.delete(path);
      });
  }, []);

  const loadThumb = useCallback((path?: string): Promise<void> => {
    if (
      !path ||
      thumbsRef.current[path] ||
      missingThumb.current.has(path) ||
      pending.current.thumb.has(path)
    )
      return Promise.resolve();
    pending.current.thumb.add(path);
    return invoke<string | null>("get_file_thumb", { path })
      .then((b) => {
        if (b) {
          thumbsRef.current = { ...thumbsRef.current, [path]: b };
          missingThumb.current.delete(path);
          setThumbsState(thumbsRef.current);
        } else {
          missingThumb.current.add(path);
        }
      })
      .catch(() => { missingThumb.current.add(path); })
      .finally(() => {
        pending.current.thumb.delete(path);
      });
  }, []);

  return { icons, thumbs, loadIcon, loadThumb };
}
