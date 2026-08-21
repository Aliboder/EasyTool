pub mod commands;
pub mod db;
pub mod types;

use tauri::Manager;
use std::sync::Mutex;
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
};

pub struct QuicklaunchState {
    pub db: db::QuicklaunchDb,
}

/// 初始化快速启动模块
pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("quicklaunch.db");
    let db = db::QuicklaunchDb::open(&db_path)
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    app.manage(Mutex::new(QuicklaunchState { db }));
    log::info!("quicklaunch module ready");
    Ok(())
}

/// 从 AppHandle 初始化（用于并行初始化）
pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("quicklaunch.db");
    let db = db::QuicklaunchDb::open(&db_path)
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    app.manage(Mutex::new(QuicklaunchState { db }));
    log::info!("quicklaunch module ready");
    Ok(())
}

/// 读模块配置对象
pub fn module_config(app: &tauri::AppHandle) -> serde_json::Value {
    app.state::<crate::config::ConfigState>()
        .0
        .lock()
        .unwrap()
        .modules
        .get("quicklaunch")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}))
}

pub const POPUP_WINDOW_LABEL: &str = "quicklaunch_popup";

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

/// 确保弹窗窗口存在（延迟创建：首次呼出时才创建，避免启动闪现）
fn ensure_popup_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window(POPUP_WINDOW_LABEL) {
        return Some(win);
    }
    let win = tauri::WebviewWindowBuilder::new(
        app,
        POPUP_WINDOW_LABEL,
        tauri::WebviewUrl::App("quicklaunch_popup.html".into()),
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
            log::error!("failed to create quicklaunch popup window: {e}");
            None
        }
    }
}

/// 全局热键触发：显示快速启动弹窗
pub fn on_hotkey(app: &tauri::AppHandle) {
    let Some(win) = ensure_popup_window(app) else {
        return;
    };
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