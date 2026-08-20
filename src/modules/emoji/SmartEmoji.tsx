// 智能 Emoji 渲染：优先系统字体（字符），系统字体不支持（豆腐块）时回退 Twemoji 图片。
// canvas 像素检测，结果持久化到 localStorage（跨启动复用，无需每次重测）。
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "easytool_emoji_supported_v1";

function loadCache(): Map<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return new Map(Object.entries(JSON.parse(raw) as Record<string, boolean>));
    }
  } catch {
    // localStorage 不可用时退化为空缓存
  }
  return new Map();
}

function persistCache() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(SUPPORT_CACHE)));
  } catch {
    // 忽略写入失败（配额/隐私模式）
  }
}

const SUPPORT_CACHE = loadCache();
const BASE = import.meta.env.BASE_URL;

// 诊断统计：缓存命中数 / 实际检测数 / 检测总耗时（写入 easytool.log）
const DIAG = { calls: 0, hits: 0, detections: 0, ms: 0 };

function reportDiag() {
  invoke("log_frontend", {
    level: "info",
    msg: `[diag] emoji smartemoji: calls=${DIAG.calls}, hits=${DIAG.hits}, detections=${DIAG.detections}, detectMs=${DIAG.ms.toFixed(1)}, cacheSize=${SUPPORT_CACHE.size}`,
  }).catch(() => {});
}

function isSystemSupported(char: string): boolean {
  DIAG.calls++;
  const cached = SUPPORT_CACHE.get(char);
  if (cached !== undefined) {
    DIAG.hits++;
    if (DIAG.calls % 240 === 0) reportDiag();
    return cached;
  }
  const t0 = performance.now();
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
  DIAG.detections++;
  DIAG.ms += performance.now() - t0;
  if (DIAG.calls % 240 === 0) reportDiag();
  persistCache();
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
  // 首屏不阻塞：先读缓存，未命中先用字符渲染，挂载后异步检测再更新
  const [supported, setSupported] = useState<boolean>(() => SUPPORT_CACHE.get(char) ?? true);

  useEffect(() => {
    if (SUPPORT_CACHE.has(char)) return;
    let alive = true;
    // 批量渲染时错峰检测：把检测交给浏览器空闲时段，避免首屏逐字符同步 Canvas 卡顿
    const run = () => {
      if (!alive) return;
      const r = isSystemSupported(char);
      setSupported(r);
    };
    const id =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(run)
        : (window.setTimeout(run, 0) as unknown as number);
    return () => {
      alive = false;
      if (typeof requestIdleCallback === "function") cancelIdleCallback(id);
      else window.clearTimeout(id as unknown as number);
    };
  }, [char]);

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
