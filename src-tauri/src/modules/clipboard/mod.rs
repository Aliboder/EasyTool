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
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
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

/// 计算弹出窗位置：跟随鼠标（横向居中于光标、纵向在光标下方），
/// 全部使用 Win32 物理坐标（与 Tauri 的 DPI 换算无关），
/// 并钳制在光标所在显示器的工作区内，窄屏时防护
pub(crate) fn popup_position_physical(hwnd: windows::Win32::Foundation::HWND) -> (i32, i32) {
    unsafe {
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return (0, 0);
        }
        let win_w = rect.right - rect.left;
        let win_h = rect.bottom - rect.top;

        let mut pt = POINT::default();
        if GetCursorPos(&mut pt).is_err() {
            return (0, 0);
        }
        let monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return (0, 0);
        }
        let work = info.rcWork;
        let x = if work.right - work.left > win_w + 16 {
            (pt.x - win_w / 2).clamp(work.left + 8, work.right - win_w - 8)
        } else {
            work.left + 8
        };
        let y = if work.bottom - work.top > win_h + 16 {
            (pt.y + 16).clamp(work.top + 8, work.bottom - win_h - 8)
        } else {
            work.top + 8
        };
        (x, y)
    }
}

/// 把窗口定位到鼠标附近（统一模式主窗口呼出用，与弹窗同口径）
pub(crate) fn position_at_cursor(win: &tauri::WebviewWindow) {
    if let Ok(hwnd) = win.hwnd() {
        let (x, y) = popup_position_physical(hwnd);
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
    if let Some(win) = app.get_webview_window(POPUP_WINDOW_LABEL) {
        return Some(win);
    }
    let win = tauri::WebviewWindowBuilder::new(
        app,
        POPUP_WINDOW_LABEL,
        tauri::WebviewUrl::App("clipboard_popup.html".into()),
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
        Ok(win) => {
            // 应用记住的弹窗尺寸
            let saved_size = app
                .state::<ConfigState>()
                .0
                .lock()
                .unwrap()
                .modules
                .get("clipboard")
                .and_then(|m| m.get("popup_size"))
                .cloned();
            if let Some(size) = saved_size {
                if let (Some(w), Some(h)) = (
                    size.get("w").and_then(|v| v.as_u64()),
                    size.get("h").and_then(|v| v.as_u64()),
                ) {
                    let _ = win.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
                }
            }
            Some(win)
        }
        Err(e) => {
            log::error!("failed to create clipboard popup window: {e}");
            None
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

/// 全局热键触发：记录唤起前的窗口上下文（供粘贴回原窗口），随后显示 popup 窗口
pub fn on_hotkey(app: &tauri::AppHandle) {
    record_foreground_state(app);
    let Some(win) = ensure_popup_window(app) else {
        return;
    };
    if let Ok(hwnd) = win.hwnd() {
        // 位置模式：跟随鼠标（默认）或记住的固定位置
        let cfg = crate::config::module_cfg(app, "clipboard");
        let follow_mouse = cfg
            .get("follow_mouse")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let (x, y) = if follow_mouse {
            popup_position_physical(hwnd)
        } else {
            cfg.get("fixed_pos")
                .and_then(|p| {
                    Some((
                        p.get("x")?.as_i64()? as i32,
                        p.get("y")?.as_i64()? as i32,
                    ))
                })
                .unwrap_or_else(|| popup_position_physical(hwnd))
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