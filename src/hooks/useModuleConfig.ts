import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// camelCase <-> snake_case 键名转换：
// 前端 state 统一 camelCase，config.json 存储键统一 snake_case，
// 转换收敛在此处，杜绝「写入键名与读取键名不一致」类 bug
function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function keysToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[snakeToCamel(k)] = v;
  }
  return out;
}

/**
 * 模块配置统一 Hook。
 *
 * - cfg：当前配置（camelCase 字段，缺失字段回落 defaults）
 * - update(patch)：立即更新 state 并落盘（camelCase patch 自动转 snake_case 存储）
 * - reload()：从 config.json 重读（窗口 focus 时自动调用，防抖 150ms）
 *
 * 主窗口与独立弹窗共用同一 moduleId 即可自动保持配置同步。
 */
export function useModuleConfig<T extends object>(moduleId: string, defaults: T) {
  const [cfg, setCfg] = useState<T>(defaults);
  // 落盘防抖：拖动滑块等高频 update 只合并为最后一次写盘
  const pendingRef = useRef<Record<string, unknown>>({});
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (Object.keys(pendingRef.current).length === 0) return;
    const patch = pendingRef.current;
    pendingRef.current = {};
    invoke("set_module_config", { moduleId, patch }).catch((e) =>
      console.error(`[${moduleId}] save config failed:`, e),
    );
  }, [moduleId]);

  const reload = useCallback(async () => {
    try {
      const config = await invoke<{ modules?: Record<string, Record<string, unknown>> }>("get_config");
      const m = config?.modules?.[moduleId];
      if (m && typeof m === "object") {
        setCfg({ ...defaults, ...keysToCamel(m as Record<string, unknown>) } as T);
      }
    } catch (e) {
      console.error(`[${moduleId}] load config failed:`, e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  const update = useCallback(
    (patch: Partial<T>) => {
      // state 同步更新：界面实时跟手（滑块边拉边生效）
      setCfg((prev) => ({ ...prev, ...patch }));
      // 磁盘写入防抖合并：高频调用只保留最新值
      for (const [k, v] of Object.entries(patch)) {
        pendingRef.current[camelToSnake(k)] = v;
      }
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(flush, 400);
    },
    [moduleId, flush],
  );

  // 挂载时读取一次；卸载时把未落盘的补写掉
  useEffect(() => {
    reload();
    return () => flush();
  }, [reload, flush]);

  // 窗口聚焦时重读（防抖）：主窗改了设置、弹窗聚焦后立即拿到新值
  useEffect(() => {
    let timer: number | null = null;
    const onFocus = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => reload(), 150);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer) window.clearTimeout(timer);
    };
  }, [reload]);

  return { cfg, update, reload };
}
