import { invoke } from "@tauri-apps/api/core";

export interface Manifest {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  default_config: Record<string, unknown>;
}

export interface AppConfig {
  modules: Record<string, Record<string, unknown>>;
  hotkeys: Record<string, string>;
  theme: string;
  migrated: string[];
}

export const getConfig = () => invoke<AppConfig>("get_config");
export const setModuleEnabled = (id: string, enabled: boolean) =>
  invoke<void>("set_module_enabled", { id, enabled });
export const setTheme = (theme: string) => invoke<void>("set_theme", { theme });
export const getManifests = () => invoke<Manifest[]>("get_manifests");