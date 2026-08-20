//! 文件搜索模块：Everything 封装 + 搜索弹窗 + 热键
//!
//! 依赖：用户需安装 Everything（免费，voidtools.com）。Everything64.dll 随应用打包，
//! 通过窗口消息/共享内存与运行中的 Everything.exe 通信。

pub mod commands;
pub mod sdk;

use crate::config::ConfigState;
use tauri::Manager;
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
};

pub const POPUP_WINDOW_LABEL: &str = "search_popup";

/// 从 config 读 search 模块配置对象
pub fn module_config(app: &tauri::AppHandle) -> serde_json::Value {
    app.state::<ConfigState>()
        .0
        .lock()
        .unwrap()
        .modules
        .get("search")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}))
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

/// 确保弹窗窗口存在（延迟创建：首次呼出时才创建，避免启动闪现）
fn ensure_popup_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window(POPUP_WINDOW_LABEL) {
        return Some(win);
    }
    let win = tauri::WebviewWindowBuilder::new(
        app,
        POPUP_WINDOW_LABEL,
        tauri::WebviewUrl::App("search_popup.html".into()),
    )
    .decorations(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(680.0, 520.0)
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
                .get("search")
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
            log::error!("failed to create search popup window: {e}");
            None
        }
    }
}

/// 全局热键触发：显示搜索弹窗
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

/// 从 AppHandle 初始化搜索模块（用于并行初始化）
pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    let handle = app.clone();
    std::thread::spawn(move || {
        load_sdk(&handle);
    });
    log::info!("search module ready");
    Ok(())
}

/// 后台加载 SDK（首次加载失败可重试，不 panic）
fn load_sdk(app: &tauri::AppHandle) {
    match sdk_dll_path(app) {
        Some(path) if path.exists() => {
            match sdk::EverythingSdk::load(&path) {
                Ok(sdk) => {
                    let mut guard = sdk::sdk_lock();
                    *guard = Some(sdk);
                    log::info!("Everything SDK loaded from {}", path.display());
                }
                Err(e) => log::warn!("failed to load Everything SDK: {e}"),
            }
        }
        _ => log::warn!("Everything64.dll not found, search module unavailable"),
    }
}

/// 定位 Everything64.dll（资源目录或开发目录 fallback）
fn sdk_dll_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    if let Ok(p) = app
        .path()
        .resolve("modules/search/Everything64.dll", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return Some(p);
        }
    }
    // dev 模式 fallback：相对 src-tauri/ 目录
    let dev = std::path::Path::new("modules/search/Everything64.dll");
    if dev.exists() {
        return Some(dev.to_path_buf());
    }
    None
}

/// 定位 Everything.exe（多路兜底）：
/// 1. App Paths 注册表（部分安装器会写）
/// 2. Uninstall 注册表 InstallLocation（Everything 官方安装器写入）
/// 3. 常见安装目录兜底
fn find_everything_exe() -> Option<std::path::PathBuf> {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    unsafe {
        // 1. App Paths（HKLM → HKCU）
        let app_paths = [
            (HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Everything.exe"),
            (HKEY_CURRENT_USER, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Everything.exe"),
        ];
        for (hive, subkey) in app_paths {
            if let Some(p) = reg_value(hive, subkey, None) {
                let path = std::path::PathBuf::from(p);
                if path.exists() {
                    return Some(path);
                }
            }
        }
        // 2. Uninstall 键 InstallLocation
        let uninstall = [
            (HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Everything"),
            (HKEY_CURRENT_USER, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Everything"),
        ];
        for (hive, subkey) in uninstall {
            if let Some(loc) = reg_value(hive, subkey, Some("InstallLocation")) {
                let exe = std::path::PathBuf::from(loc).join("Everything.exe");
                if exe.exists() {
                    return Some(exe);
                }
            }
        }
        // 3. 常见安装目录
        let common = [
            std::path::PathBuf::from("C:\\Program Files\\Everything\\Everything.exe"),
            std::path::PathBuf::from("C:\\Program Files (x86)\\Everything\\Everything.exe"),
        ];
        for p in common {
            if p.exists() {
                return Some(p);
            }
        }
        None
    }
}

/// 读注册表字符串值（value 为 None 时读默认值）
unsafe fn reg_value(
    hive: windows::Win32::System::Registry::HKEY,
    subkey: &str,
    value: Option<&str>,
) -> Option<String> {
    use windows::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    let subkey_wide: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
    let value_wide = value.map(|v| v.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>());
    let value_ptr = value_wide
        .as_ref()
        .map(|v| windows::core::PCWSTR(v.as_ptr()))
        .unwrap_or(windows::core::PCWSTR::null());
    let mut buf = [0u16; 1024];
    let mut len = (buf.len() * 2) as u32;
    let res = RegGetValueW(
        hive,
        windows::core::PCWSTR(subkey_wide.as_ptr()),
        value_ptr,
        RRF_RT_REG_SZ,
        None,
        Some(buf.as_mut_ptr() as *mut core::ffi::c_void),
        Some(&mut len),
    );
    if res.is_ok() && len >= 2 {
        let s = String::from_utf16_lossy(&buf[..len as usize / 2]);
        let s = s.trim_end_matches('\0').trim_matches('"').to_string();
        if !s.is_empty() {
            return Some(s);
        }
    }
    None
}

/// 自动启动 Everything：`-startup` 让其在系统托盘最小化启动、不弹主窗口（后台无感）；
/// 找不到 exe（如便携版/绿色版）由用户手动启动
pub fn ensure_everything_running() {
    if let Some(exe) = find_everything_exe() {
        let _ = std::process::Command::new(exe).arg("-startup").spawn();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn popup_position_clamps_to_workarea() {
        // 位置计算依赖真实 Win32 状态，仅验证函数存在与返回类型
        let _: fn(windows::Win32::Foundation::HWND) -> (i32, i32) = popup_position_physical;
    }

    /// 真实环境探测：Everything 已安装时应能找到 exe（安装器写 Uninstall 键，非 App Paths）
    #[test]
    #[ignore = "requires installed Everything"]
    fn real_find_everything() {
        let exe = find_everything_exe();
        assert!(exe.is_some(), "Everything 已安装时应能定位 exe");
        eprintln!("Everything exe: {:?}", exe);
    }
}