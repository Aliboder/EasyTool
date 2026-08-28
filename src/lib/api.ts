import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";

export interface Manifest {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  description: string;
  default_config: Record<string, unknown>;
}

export interface AppConfig {
  modules: Record<string, Record<string, unknown>>;
  hotkeys: Record<string, string>;
  theme: string;
  migrated: string[];
  main_follow_mouse: boolean;
  module_order: string[];
}

export interface Bootstrap {
  manifests: Manifest[];
  config: AppConfig;
}

// 启动一次性拉取（合并 get_manifests + get_config 两次 IPC）
export const getBootstrap = () => invoke<Bootstrap>("get_bootstrap");
export const getConfig = () => invoke<AppConfig>("get_config");
export const setModuleEnabled = (id: string, enabled: boolean) =>
  invoke<void>("set_module_enabled", { id, enabled });
export const setModuleOrder = (ids: string[]) => invoke<void>("set_module_order", { ids });
export const setTheme = (theme: string) => invoke<void>("set_theme", { theme });
export const setMainHotkey = (hotkey: string) => invoke<void>("set_main_hotkey", { hotkey });
export const saveMainSize = (width: number, height: number) =>
  invoke<void>("save_main_size", { width, height });
export const setMainFollowMouse = (enabled: boolean) =>
  invoke<void>("set_main_follow_mouse", { enabled });

export interface UpdateInfo {
  version: string;
  notes: string | null;
  downloadAndInstall: () => Promise<void>;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  if (update) {
    return {
      version: update.version,
      notes: update.body ?? null,
      downloadAndInstall: () => update.downloadAndInstall(),
    };
  }
  return null;
}