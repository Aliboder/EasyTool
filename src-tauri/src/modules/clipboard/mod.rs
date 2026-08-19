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

/// 计算弹出窗位置：跟随鼠标（横向居中于光标、纵向在光标下方），
/// 全部使用 Win32 物理坐标（与 Tauri 的 DPI 换算无关），
/// 并钳制在光标所在显示器的工作区内，窄屏时防护
fn popup_position_physical(hwnd: windows::Win32::Foundation::HWND) -> (i32, i32) {
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

/// 全局热键触发：记录唤起前的窗口上下文（供粘贴回原窗口），随后显示 popup 窗口
pub fn on_hotkey(app: &tauri::AppHandle) {
    record_foreground_state(app);
    if let Some(win) = app.get_webview_window(POPUP_WINDOW_LABEL) {
        if let Ok(hwnd) = win.hwnd() {
            // 位置模式：跟随鼠标（默认）或记住的固定位置
            let cfg = module_config(app);
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
}