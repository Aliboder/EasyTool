// 智能 Emoji 渲染：优先系统字体（字符），系统字体不支持（豆腐块）时回退 Twemoji 图片。
// canvas 像素检测，结果持久化到 localStorage（跨启动复用，无需每次重测）。
// 检测走「共享 canvas + 每帧分片队列」，避免大批量渲染时逐字符同步建 Canvas/写 localStorage 阻塞主线程。
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "easytool_emoji_supported_v1";
// 每帧最多检测的字符数（单字符约 1.5~3ms，24 个 ≈ 40~70ms，片间让出主线程不卡）
const BATCH_PER_FRAME = 24;

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

// 共享 canvas：复用同一个 2D context，避免每次检测新建 canvas/context 的昂贵开销
let sharedCtx: CanvasRenderingContext2D | null = null;
function detectCanvasCtx(): CanvasRenderingContext2D | null {
  if (!sharedCtx) {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    sharedCtx = c.getContext("2d", { willReadFrequently: true });
  }
  return sharedCtx;
}

// 诊断统计：缓存命中数 / 实际检测数 / 检测总耗时（写入 easytool.log）
const DIAG = { calls: 0, hits: 0, detections: 0, ms: 0 };

function reportDiagIfDue() {
  if (DIAG.calls % 240 === 0) {
    invoke("log_frontend", {
      level: "info",
      msg: `[diag] emoji smartemoji: calls=${DIAG.calls}, hits=${DIAG.hits}, detections=${DIAG.detections}, detectMs=${DIAG.ms.toFixed(1)}, cacheSize=${SUPPORT_CACHE.size}`,
    }).catch(() => {});
  }
}

// 防抖持久化：一批检测只写一次 localStorage（避免逐字符 JSON.stringify 全量 Map 同步阻塞）
let persistTimer: number | null = null;
function schedulePersist() {
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    persistCache();
  }, 500);
}

/** 单个字符检测：渲染到共享 canvas 并统计像素。结果写入缓存，返回是否系统字体支持 */
function detect(char: string): boolean {
  DIAG.calls++;
  const t0 = performance.now();
  let result = true;
  const ctx = detectCanvasCtx();
  try {
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
  reportDiagIfDue();
  schedulePersist();
  return result;
}

// 待检测队列 + 每帧分片处理：避免同一帧内连续检测大量字符阻塞主线程
const QUEUE: string[] = [];
const SUBS: Map<string, Set<(r: boolean) => void>> = new Map();
let drainScheduled = false;

function drainQueue() {
  drainScheduled = false;
  let n = 0;
  while (n < BATCH_PER_FRAME && QUEUE.length) {
    const char = QUEUE.shift()!;
    const r = detect(char);
    const set = SUBS.get(char);
    if (set) {
      SUBS.delete(char);
      set.forEach((cb) => cb(r));
    }
    n++;
  }
  if (QUEUE.length) scheduleDrain();
}

function scheduleDrain() {
  if (drainScheduled) return;
  drainScheduled = true;
  requestAnimationFrame(drainQueue);
}

/** 请求检测某字符，完成后回调；返回取消函数（组件卸载时调用） */
function requestDetection(char: string, cb: (r: boolean) => void): () => void {
  const cached = SUPPORT_CACHE.get(char);
  if (cached !== undefined) {
    DIAG.calls++;
    DIAG.hits++;
    reportDiagIfDue();
    cb(cached);
    return () => {};
  }
  let set = SUBS.get(char);
  if (!set) {
    set = new Set();
    SUBS.set(char, set);
    QUEUE.push(char);
    scheduleDrain();
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
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
  // 首屏不阻塞：先读缓存，未命中先用字符渲染，挂载后异步分片检测再更新
  const [supported, setSupported] = useState<boolean>(() => SUPPORT_CACHE.get(char) ?? true);

  useEffect(() => {
    let alive = true;
    const off = requestDetection(char, (r) => {
      if (alive) setSupported(r);
    });
    return () => {
      alive = false;
      off();
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
