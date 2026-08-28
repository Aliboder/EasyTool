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

/// 剪贴板历史上限：锁定 500 条（不可调），超出自动清理最旧的非固定条目
pub const MAX_ITEMS: u64 = 500;

/// 初始化剪贴板模块：数据库、状态、监听线程（从 AppHandle，用于并行初始化）
pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    db::backup_database(&data_dir);
    // 开库失败（典型：库损坏）→ 隔离损坏文件重建空库，应用照常启动
    let db_path = data_dir.join("clipboard.db");
    let state = match AppState::new(data_dir.clone(), db_path.clone(), MAX_ITEMS) {
        Ok(s) => s,
        Err(e) => {
            log::error!("clipboard db init failed ({e}), quarantining broken db and recreating");
            crate::quarantine_broken_db(&db_path);
            AppState::new(data_dir.clone(), db_path, MAX_ITEMS)
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

/// 把主窗口定位到鼠标附近（呼出时跟随鼠标用）
pub(crate) fn position_at_cursor(win: &tauri::WebviewWindow) {
    if let Ok(hwnd) = win.hwnd() {
        let (x, y) = crate::position_at_cursor_physical(hwnd);
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

/// 供 search 模块联动：把一个文件路径写入剪贴板历史
pub fn record_file_to_history(app: &tauri::AppHandle, path: &str) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let _ = monitor::save_files_batch(&state, app, std::slice::from_ref(&path.to_string()));
}
