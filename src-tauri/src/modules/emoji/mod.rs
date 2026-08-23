//! 表情模块：内置 Emoji + 图片表情 + 悬浮面板
pub mod commands;
pub mod data;
pub mod db;
pub mod paste;

use tauri::Manager;
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
};

pub const POPUP_WINDOW_LABEL: &str = "emoji_popup";

pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    // 开库失败（典型：库损坏）→ 隔离损坏文件重建空库，模块降级为无自定义表情
    let db_path = data_dir.join("emojis.db");
    let db = match db::Db::open(&db_path) {
        Ok(db) => db,
        Err(e) => {
            log::error!("emoji db init failed ({e}), quarantining broken db and recreating");
            crate::quarantine_broken_db(&db_path);
            db::Db::open(&db_path).map_err(|e| tauri::Error::Io(std::io::Error::other(e.to_string())))?
        }
    };
    app.manage(db);
    // 预加载内置数据（模块资源目录）
    let dir = crate::modules::modules_dir(app);
    let _ = data::load(&dir);
    log::info!("emoji module ready");
    Ok(())
}

/// 记录唤起前窗口上下文，随后显示悬浮面板
pub fn on_hotkey(app: &tauri::AppHandle) {
    paste::record_foreground_state(app);
    let Some(win) = ensure_popup_window(app) else {
        return;
    };
    if let Ok(hwnd) = win.hwnd() {
        let cfg = crate::config::module_cfg(app, "emoji");
        let follow_mouse = cfg
            .get("follow_mouse")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let (x, y) = if follow_mouse {
            crate::popup_position_physical(hwnd)
        } else {
            cfg.get("fixed_pos")
                .and_then(|p| {
                    Some((
                        p.get("x")?.as_i64()? as i32,
                        p.get("y")?.as_i64()? as i32,
                    ))
                })
                .unwrap_or_else(|| crate::popup_position_physical(hwnd))
        };
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
    let _ = win.show();
    let _ = win.set_focus();
}

fn ensure_popup_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window(POPUP_WINDOW_LABEL) {
        return Some(win);
    }
    let win = tauri::WebviewWindowBuilder::new(
        app,
        POPUP_WINDOW_LABEL,
        tauri::WebviewUrl::App("emoji_popup.html".into()),
    )
    .decorations(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(620.0, 480.0)
    .min_inner_size(400.0, 300.0)
    .resizable(true)
    .always_on_top(true)
    .build();
    match win {
        Ok(win) => Some(win),
        Err(e) => {
            log::error!("failed to create emoji popup window: {e}");
            None
        }
    }
}
