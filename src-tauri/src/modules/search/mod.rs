//! 文件搜索模块：Everything 封装 + 已安装应用中心
//!
//! 依赖：用户需安装 Everything（免费，voidtools.com）。Everything64.dll 随应用打包，
//! 通过窗口消息/共享内存与运行中的 Everything.exe 通信。

pub mod apps;
pub mod commands;
pub mod foreground;
pub mod sdk;

use tauri::Manager;
use std::sync::Mutex;

/// 从 AppHandle 初始化搜索模块（用于并行初始化）
pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    let handle = app.clone();
    std::thread::spawn(move || {
        load_sdk(&handle);
    });
    // 已安装应用中心：频率计数库
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db = apps::AppsDb::open(&data_dir.join("apps.db"))
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    app.manage(Mutex::new(apps::AppsState { db }));
    // 前台使用频率监测（事件钩子）
    let fg = app.clone();
    std::thread::spawn(move || foreground::start(fg));
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

/// 上次尝试加载 SDK 的时间戳（毫秒），用于节流重试
static LAST_SDK_TRY_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// SDK 未就绪时节流重试加载（最小间隔 30s）：启动时被杀毒拦截、资源未就绪等
/// 瞬时故障可自愈，无需重启应用。已加载直接返回；调用方须在后台线程（sdk_lock 可能短暂阻塞）
pub(crate) fn ensure_sdk_loaded(app: &tauri::AppHandle) {
    if sdk::sdk_lock().is_some() {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let last = LAST_SDK_TRY_MS.load(std::sync::atomic::Ordering::Relaxed);
    if now.saturating_sub(last) < 30_000 {
        return;
    }
    LAST_SDK_TRY_MS.store(now, std::sync::atomic::Ordering::Relaxed);
    log::info!("retrying Everything SDK load");
    load_sdk(app);
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

    /// 注册表读取容错：不存在的键返回 None（不 panic、不返回脏值）
    #[test]
    fn reg_value_missing_key_returns_none() {
        unsafe {
            let v = reg_value(
                windows::Win32::System::Registry::HKEY_CURRENT_USER,
                "SOFTWARE\\EasyTool__definitely_missing__",
                Some("value"),
            );
            assert!(v.is_none());
        }
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
