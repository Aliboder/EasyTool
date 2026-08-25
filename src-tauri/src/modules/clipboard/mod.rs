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

use state::AppState;
use tauri::Manager;
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
};

pub const POPUP_WINDOW_LABEL: &str = "clipboard_popup";

pub fn max_items(app: &tauri::AppHandle) -> u64 {
    crate::config::module_cfg(app, "clipboard")
        .get("max_items")
        .and_then(|v| v.as_u64())
        .unwrap_or(2000)
}

/// 初始化剪贴板模块：数据库、状态、监听线程（从 AppHandle，用于并行初始化）
pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    db::backup_database(&data_dir);
    // 开库失败（典型：库损坏）→ 隔离损坏文件重建空库，应用照常启动
    let db_path = data_dir.join("clipboard.db");
    let state = match AppState::new(data_dir.clone(), db_path.clone(), max_items(app)) {
        Ok(s) => s,
        Err(e) => {
            log::error!("clipboard db init failed ({e}), quarantining broken db and recreating");
            crate::quarantine_broken_db(&db_path);
            AppState::new(data_dir.clone(), db_path, max_items(app))
                .map_err(|e| tauri::Error::Io(std::io::Error::other(e.to_string())))?
        }
    };
    if let Ok(db) = state.db.lock() {
        let _ = db.vacuum_if_large(8 * 1024 * 1024);
    }
    log::info!("clipboard module ready, data dir: {}", data_dir.display());
    app.manage(state);
    monitor::start(app.clone());
    Ok(())
}

/// 把窗口定位到鼠标附近（统一模式主窗口呼出用，与弹窗同口径）
pub(crate) fn position_at_cursor(win: &tauri::WebviewWindow) {
    if let Ok(hwnd) = win.hwnd() {
        let (x, y) = crate::popup_position_physical(hwnd);
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                None,
                x,
                y,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }
}

/// 记录唤起前的窗口上下文（供粘贴回原窗口），由任何窗口唤起入口调用
pub fn record_foreground_state(app: &tauri::AppHandle) {    if let Some(state) = app.try_state::<AppState>() {
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
}

/// 确保弹窗窗口存在（延迟创建：首次呼出时才创建，避免启动闪现）
fn ensure_popup_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    crate::ensure_popup_window(
        app,
        POPUP_WINDOW_LABEL,
        "clipboard_popup.html",
        (620.0, 480.0),
        "clipboard",
    )
}

/// 供 search 模块联动：把一个文件路径写入剪贴板历史
pub fn record_file_to_history(app: &tauri::AppHandle, path: &str) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let _ = monitor::save_files_batch(&state, app, std::slice::from_ref(&path.to_string()));
}

/// 全局热键触发：记录唤起前的窗口上下文（供粘贴回原窗口），随后显示 popup 窗口
pub fn on_hotkey(app: &tauri::AppHandle) {
    record_foreground_state(app);
    let Some(win) = ensure_popup_window(app) else {
        return;
    };
    crate::show_popup_at(app, &win, "clipboard");
}
