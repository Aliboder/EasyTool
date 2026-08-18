pub mod clipboard;
pub mod commands;
pub mod db;
pub mod dedup;
pub mod file_icons;
pub mod models;
pub mod monitor;
pub mod paste;
pub mod state;
pub mod store;

use crate::config::ConfigState;
use state::AppState;
use tauri::Manager;

pub const POPUP_WINDOW_LABEL: &str = "clipboard_popup";

/// 从 config 读剪贴板模块配置对象
pub fn module_config(app: &tauri::AppHandle) -> serde_json::Value {
    app.state::<ConfigState>()
        .0
        .lock()
        .unwrap()
        .modules
        .get("clipboard")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}))
}

pub fn max_items(app: &tauri::AppHandle) -> u64 {
    module_config(app)
        .get("max_items")
        .and_then(|v| v.as_u64())
        .unwrap_or(500)
}

/// 初始化剪贴板模块：数据库、状态、监听线程
pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    db::backup_database(&data_dir);
    let state = AppState::new(data_dir.clone(), data_dir.join("clipboard.db"), max_items(handle))
        .expect("failed to init clipboard state");
    if let Ok(db) = state.db.lock() {
        let _ = db.vacuum_if_large(8 * 1024 * 1024);
    }
    log::info!("clipboard module ready, data dir: {}", data_dir.display());
    app.manage(state);
    monitor::start(handle.clone());
    Ok(())
}

/// 全局热键触发：记录唤起前的窗口上下文（供粘贴回原窗口），随后显示 popup 窗口
pub fn on_hotkey(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        let ctx = paste::record_foreground();
        state
            .prev_foreground
            .store(ctx.hwnd, std::sync::atomic::Ordering::SeqCst);
        state
            .prev_focus
            .store(ctx.focus, std::sync::atomic::Ordering::SeqCst);
        state
            .prev_sel_start
            .store(ctx.sel_start, std::sync::atomic::Ordering::SeqCst);
        state
            .prev_sel_end
            .store(ctx.sel_end, std::sync::atomic::Ordering::SeqCst);
    }
    if let Some(win) = app.get_webview_window(POPUP_WINDOW_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
    }
}