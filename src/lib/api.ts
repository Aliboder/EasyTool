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
  unified_hotkey: boolean;
  main_follow_mouse: boolean;
  module_order: string[];
}

export const getConfig = () => invoke<AppConfig>("get_config");
export const setModuleEnabled = (id: string, enabled: boolean) =>
  invoke<void>("set_module_enabled", { id, enabled });
export const setModuleOrder = (ids: string[]) => invoke<void>("set_module_order", { ids });
export const setTheme = (theme: string) => invoke<void>("set_theme", { theme });
export const setUnifiedHotkey = (enabled: boolean) =>
  invoke<void>("set_unified_hotkey", { enabled });
export const setMainHotkey = (hotkey: string) => invoke<void>("set_main_hotkey", { hotkey });
export const saveMainSize = (width: number, height: number) =>
  invoke<void>("save_main_size", { width, height });
export const setMainFollowMouse = (enabled: boolean) =>
  invoke<void>("set_main_follow_mouse", { enabled });
export const getManifests = () => invoke<Manifest[]>("get_manifests");

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