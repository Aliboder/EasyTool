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
    /// 主窗口尺寸记忆 {w,h}（重启恢复）
    pub main_size: Option<serde_json::Value>,
    /// 统一模式下呼出主窗口时是否跟随鼠标
    pub main_follow_mouse: bool,
    /// 模块显示顺序（底部栏与设置页共用；缺失的模块启动时追加到末尾）
    pub module_order: Vec<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        let mut modules = HashMap::new();
        modules.insert(
            "clipboard".into(),
            serde_json::json!({
                "enabled": true,
                "max_items": 500,
                "hotkey": "Ctrl+Shift+V",
                "follow_mouse": true,
                "record_text": true,
                "record_image": true,
                "record_files": true,
                "min_text_len": 0,
                "cell_size": 80,
                "text_lines": 2,
                "show_timestamps": true
            }),
        );
        modules.insert(
            "quota".into(),
            serde_json::json!({ "enabled": true, "refresh_interval_sec": 30, "warn_threshold": 10.0, "hotkey": "" }),
        );
        let mut hotkeys = HashMap::new();
        hotkeys.insert("clipboard".into(), "Ctrl+Shift+V".into());
        hotkeys.insert("main".into(), "Ctrl+Shift+E".into());
        Self { modules, hotkeys, theme: "dark".into(), migrated: vec![], unified_hotkey: true, main_size: None, main_follow_mouse: false, module_order: vec![] }
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

/// 保存模块显示顺序（底部栏与设置页排序同步依据）
#[tauri::command]
pub fn set_module_order(
    app: AppHandle,
    state: State<ConfigState>,
    ids: Vec<String>,
) -> Result<(), String> {
    let mut cfg = state.0.lock().unwrap();
    cfg.module_order = ids;
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
    crate::apply_main_window_mode(&app);
    Ok(())
}

/// 自定义主窗口全局呼出热键（统一呼出模式下唯一热键），立即生效并持久化
#[tauri::command]
pub fn set_main_hotkey(
    app: AppHandle,
    state: State<ConfigState>,
    hotkey: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    // 先验证新键可用，失败时旧热键仍有效
    app.global_shortcut()
        .register(hotkey.as_str())
        .map_err(|e| format!("快捷键无效或已被其他程序占用：{e}"))?;
    let _ = app.global_shortcut().unregister_all();
    let mut cfg = state.0.lock().unwrap();
    cfg.hotkeys.insert("main".into(), hotkey.clone());
    save_config(&app, &cfg)?;
    drop(cfg);
    crate::reapply_hotkeys(&app);
    log::info!("main hotkey changed to {hotkey}");
    Ok(())
}

/// 保存主窗口尺寸（重启恢复）；忽略 0/极小尺寸（窗口隐藏/最小化时 WebView2 会报 0x0）
#[tauri::command]
pub fn save_main_size(
    app: AppHandle,
    state: State<ConfigState>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    // 与 tauri.conf.json 的 minWidth/minHeight 一致
    if width < 400 || height < 300 {
        return Ok(());
    }
    let mut cfg = state.0.lock().unwrap();
    cfg.main_size = Some(serde_json::json!({ "w": width, "h": height }));
    save_config(&app, &cfg)
}

/// 统一模式下呼出主窗口是否跟随鼠标
#[tauri::command]
pub fn set_main_follow_mouse(
    app: AppHandle,
    state: State<ConfigState>,
    enabled: bool,
) -> Result<(), String> {
    let mut cfg = state.0.lock().unwrap();
    cfg.main_follow_mouse = enabled;
    save_config(&app, &cfg)
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