// 智能 Emoji 渲染：优先系统字体（字符），系统字体不支持（豆腐块）时回退 Twemoji 图片。
// canvas 像素检测「中心是否有字形」，结果按字符缓存（module 级，运行期内一次检测）。
import { useMemo } from "react";

const SUPPORT_CACHE = new Map<string, boolean>();
const BASE = import.meta.env.BASE_URL;

function isSystemSupported(char: string): boolean {
  const cached = SUPPORT_CACHE.get(char);
  if (cached !== undefined) return cached;
  let result = true;
  try {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.clearRect(0, 0, 64, 64);
      ctx.font = '56px "Segoe UI Emoji", "Segoe UI", sans-serif';
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.fillText(char, 32, 34);
      const d = ctx.getImageData(0, 0, 64, 64).data;
      // 统计不透明像素数与彩色像素数：
      //   - 真 emoji（彩色字形/实心单色）：像素多（>1500）或有彩色（>200）
      //   - 不支持的字符降级为字母对/豆腐块：像素少（~500-750）且无彩色
      let opaque = 0;
      let color = 0;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const i = (y * 64 + x) * 4;
          if (d[i + 3] > 128) {
            opaque++;
            const r = d[i];
            const g = d[i + 1];
            const b = d[i + 2];
            if (Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r) > 60) {
              color++;
            }
          }
        }
      }
      result = opaque > 1500 || color > 200;
    }
  } catch {
    result = true; // 检测失败时按支持处理（回退到字符）
  }
  SUPPORT_CACHE.set(char, result);
  return result;
}

export function SmartEmoji({
  char,
  code,
  size = 28,
}: {
  char: string;
  code: string | null;
  size?: number;
}) {
  const supported = useMemo(() => isSystemSupported(char), [char]);
  if (!supported && code) {
    return (
      <img
        src={`${BASE}twemoji/${code}.svg`}
        style={{ width: size, height: size }}
        alt=""
      />
    );
  }
  return <span style={{ fontSize: size, lineHeight: 1 }}>{char}</span>;
}
