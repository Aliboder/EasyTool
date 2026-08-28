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
    /// 主窗口尺寸记忆 {w,h}（重启恢复）
    pub main_size: Option<serde_json::Value>,
    /// 呼出主窗口时是否跟随鼠标
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
            serde_json::json!({ "enabled": true, "refresh_interval_sec": 30, "warn_threshold": 10.0 }),
        );
        let mut hotkeys = HashMap::new();
        hotkeys.insert("main".into(), "Ctrl+Shift+E".into());
        Self { modules, hotkeys, theme: "dark".into(), migrated: vec![], main_size: None, main_follow_mouse: false, module_order: vec![] }
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
            // 备份名带时间戳：多次损坏互不覆盖，原始数据永远留底
            let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S");
            let backup = path.with_extension(format!("broken-{ts}.json"));
            match fs::copy(&path, &backup) {
                Ok(_) => log::warn!("config.json 解析失败，已备份到 {}", backup.display()),
                Err(e) => log::error!("config.json 解析失败且备份失败: {e}"),
            }
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
    // 内容未变化则跳过写盘（启动时 merge_manifests 的兜底落盘多数是空操作，省一次 IO）
    if fs::read_to_string(&path).map(|existing| existing == json).unwrap_or(false) {
        return Ok(());
    }
    // 原子写：先落临时文件再改名覆盖，写盘中途崩溃不会留下半截 JSON
    // （否则下次启动解析失败 → 静默回退默认配置：热键/账户/开关全丢）
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 清理已废弃的历史配置键（独立弹窗移除后不再读取）：
/// - 模块配置里的 `hotkey` / `follow_mouse` / `popup_size` / `fixed_pos`
/// - `hotkeys` 表中非 `main` 的残留热键（模块独立热键已删除）
/// 幂等：无残留时返回 false（调用方据此跳过写盘）。
pub fn sanitize_legacy_keys(cfg: &mut AppConfig) -> bool {
    let mut changed = false;
    for m in cfg.modules.values_mut() {
        if let Some(obj) = m.as_object_mut() {
            for k in ["hotkey", "follow_mouse", "popup_size", "fixed_pos"] {
                if obj.remove(k).is_some() {
                    changed = true;
                }
            }
        }
    }
    let before = cfg.hotkeys.len();
    cfg.hotkeys.retain(|k, _| k == "main");
    if cfg.hotkeys.len() != before {
        changed = true;
    }
    changed
}

/// 读模块配置对象（缺失返回空对象）
pub fn module_cfg(app: &AppHandle, id: &str) -> serde_json::Value {
    app.state::<ConfigState>()
        .0
        .lock()
        .unwrap()
        .modules
        .get(id)
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}))
}

/// 更新模块配置并落盘：f 内改字段，返回 Err 则中断不写盘。
/// 锁在函数返回时释放——调用方随后 spawn 的后台任务可安全再取锁
pub fn update_module(
    app: &AppHandle,
    id: &str,
    f: impl FnOnce(&mut serde_json::Value) -> Result<(), String>,
) -> Result<(), String> {
    let state = app.state::<ConfigState>();
    let mut cfg = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let v = cfg
        .modules
        .get_mut(id)
        .ok_or_else(|| format!("模块 {id} 未初始化"))?;
    f(v)?;
    save_config(app, &cfg)
}

#[tauri::command]
pub fn get_config(state: State<ConfigState>) -> AppConfig {
    state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
}

#[tauri::command]
pub fn set_module_enabled(
    app: AppHandle,
    state: State<ConfigState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    {
        let mut cfg = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(v) = cfg.modules.get_mut(&id) {
            v["enabled"] = serde_json::json!(enabled);
        } else {
            cfg.modules.insert(id, serde_json::json!({ "enabled": enabled }));
        }
        save_config(&app, &cfg)?;
    }
    Ok(())
}

/// 通用模块配置 patch 保存：写入 modules.<module_id> 的指定键并落盘。
/// 所有模块的设置保存统一走这里（替代各模块独立的 save_xxx_settings 命令）。
/// timetracker 的采集类设置（AFK 阈值、音频豁免等）保存后即时重应用，不必重启。
#[tauri::command]
pub fn set_module_config(
    app: AppHandle,
    state: State<ConfigState>,
    module_id: String,
    patch: serde_json::Value,
) -> Result<(), String> {
    let is_timetracker = module_id == "timetracker";
    {
        let mut cfg = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let m = cfg.modules.entry(module_id).or_default();
        if let Some(obj) = patch.as_object() {
            for (k, v) in obj {
                m[k] = v.clone();
            }
        }
        save_config(&app, &cfg)?;
    }
    if is_timetracker {
        crate::modules::timetracker::reapply_config(&app);
    }
    Ok(())
}

/// 保存模块显示顺序（底部栏与设置页排序同步依据）
#[tauri::command]
pub fn set_module_order(
    app: AppHandle,
    state: State<ConfigState>,
    ids: Vec<String>,
) -> Result<(), String> {
    let mut cfg = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    cfg.module_order = ids;
    save_config(&app, &cfg)
}

#[tauri::command]
pub fn set_theme(app: AppHandle, state: State<ConfigState>, theme: String) -> Result<(), String> {
    let mut cfg = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    cfg.theme = theme;
    save_config(&app, &cfg)
}

/// 自定义主窗口全局呼出热键（唯一热键），立即生效并持久化
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
    let mut cfg = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    cfg.hotkeys.insert("main".into(), hotkey.clone());
    let saved = save_config(&app, &cfg);
    drop(cfg);
    // 落盘失败也必须先恢复热键注册再返回错误，
    // 否则此刻已 unregister_all 且不再 reapply —— 热键静默失效直到重启
    crate::reapply_hotkeys(&app);
    saved?;
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
    let mut cfg = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    cfg.main_size = Some(serde_json::json!({ "w": width, "h": height }));
    save_config(&app, &cfg)
}

/// 呼出主窗口时是否跟随鼠标
#[tauri::command]
pub fn set_main_follow_mouse(
    app: AppHandle,
    state: State<ConfigState>,
    enabled: bool,
) -> Result<(), String> {
    let mut cfg = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
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
