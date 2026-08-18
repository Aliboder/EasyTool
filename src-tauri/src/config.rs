use std::{collections::HashMap, fs, path::PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AppConfig {
    pub modules: HashMap<String, serde_json::Value>,
    pub hotkeys: HashMap<String, String>,
    pub theme: String,
    pub migrated: Vec<String>,
    /// 统一呼出主窗口模式：开启时只注册主窗口热键，模块独立热键全部禁用
    pub unified_hotkey: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        let mut modules = HashMap::new();
        modules.insert(
            "clipboard".into(),
            serde_json::json!({ "enabled": true, "max_items": 500, "hotkey": "Ctrl+Shift+V" }),
        );
        modules.insert(
            "quota".into(),
            serde_json::json!({ "enabled": true, "refresh_interval_sec": 30, "warn_threshold": 10.0, "hotkey": "" }),
        );
        let mut hotkeys = HashMap::new();
        hotkeys.insert("clipboard".into(), "Ctrl+Shift+V".into());
        hotkeys.insert("main".into(), "Ctrl+Shift+E".into());
        Self { modules, hotkeys, theme: "dark".into(), migrated: vec![], unified_hotkey: true }
    }
}

pub struct ConfigState(pub std::sync::Mutex<AppConfig>);

pub fn config_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("config.json")
}

pub fn load_config(app: &AppHandle) -> AppConfig {
    let path = config_path(app);
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| {
            let _ = fs::copy(&path, path.with_extension("broken.json"));
            AppConfig::default()
        }),
        Err(_) => AppConfig::default(),
    }
}

pub fn save_config(app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
    let path = config_path(app);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_config(state: State<ConfigState>) -> AppConfig {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_module_enabled(
    app: AppHandle,
    state: State<ConfigState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut cfg = state.0.lock().unwrap();
    if let Some(v) = cfg.modules.get_mut(&id) {
        v["enabled"] = serde_json::json!(enabled);
    } else {
        cfg.modules.insert(id, serde_json::json!({ "enabled": enabled }));
    }
    save_config(&app, &cfg)
}

#[tauri::command]
pub fn set_theme(app: AppHandle, state: State<ConfigState>, theme: String) -> Result<(), String> {
    let mut cfg = state.0.lock().unwrap();
    cfg.theme = theme;
    save_config(&app, &cfg)
}

/// 切换统一呼出主窗口模式：改变后重新注册全局热键
#[tauri::command]
pub fn set_unified_hotkey(
    app: AppHandle,
    state: State<ConfigState>,
    enabled: bool,
) -> Result<(), String> {
    {
        let mut cfg = state.0.lock().unwrap();
        cfg.unified_hotkey = enabled;
        save_config(&app, &cfg)?;
    }
    crate::reapply_hotkeys(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_when_missing() {
        let cfg = AppConfig::default();
        assert!(cfg.modules.contains_key("clipboard"));
        assert!(cfg.modules["clipboard"]["enabled"].as_bool().unwrap());
        assert!(cfg.modules.contains_key("quota"));
        assert_eq!(cfg.theme, "dark");
    }

    #[test]
    fn serde_roundtrip() {
        let cfg = AppConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.theme, cfg.theme);
        assert_eq!(back.modules.len(), cfg.modules.len());
    }
}