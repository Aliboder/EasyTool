mod config;
mod migrate;
mod modules;

use config::ConfigState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
};

pub const MAIN_WINDOW_LABEL: &str = "main";

/// 极简日志器：输出到 stderr + 日志文件（%APPDATA%/com.aliboder.easytool/easytool.log）
struct SimpleLogger {
    file: std::sync::Mutex<std::fs::File>,
}

static LOGGER: std::sync::OnceLock<SimpleLogger> = std::sync::OnceLock::new();

impl log::Log for SimpleLogger {
    fn enabled(&self, _metadata: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        let line = format!(
            "[{}] [{}] {}: {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            record.level(),
            record.module_path().unwrap_or("easytool"),
            record.args()
        );
        eprintln!("{line}");
        if let Ok(mut file) = self.file.lock() {
            use std::io::Write;
            let _ = writeln!(file, "{line}");
        }
    }
    fn flush(&self) {}
}

fn init_logger() {
    let default_path = format!(
        "{}/com.aliboder.easytool/easytool.log",
        std::env::var("APPDATA").unwrap_or_else(|_| ".".into())
    );
    let path = std::path::PathBuf::from(&default_path);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    const LOG_MAX_BYTES: u64 = 1024 * 1024;
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_MAX_BYTES {
            let old = path.with_extension("log.old");
            let _ = std::fs::remove_file(&old);
            let _ = std::fs::rename(&path, &old);
        }
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path);
    match file {
        Ok(file) => {
            if LOGGER
                .set(SimpleLogger {
                    file: std::sync::Mutex::new(file),
                })
                .is_ok()
            {
                let _ = log::set_logger(LOGGER.get().unwrap());
                log::set_max_level(log::LevelFilter::Info);
            }
        }
        Err(e) => eprintln!("[EasyTool] failed to open log file {}: {e}", path.display()),
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let icon = app.default_window_icon().cloned().expect("no window icon");
    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => {
                save_main_window_size(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 保存主窗口当前尺寸（点 X 隐藏到托盘 / 托盘退出时调用，兜底前端防抖保存未触发的场景）
fn save_main_window_size(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if let Ok(size) = win.inner_size() {
            // 与 save_main_size 一致：忽略 0/极小尺寸（隐藏/最小化时可能报 0x0）
            if size.width >= 400 && size.height >= 300 {
                let cfg = app.state::<ConfigState>();
                let mut cfg = cfg.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                cfg.main_size = Some(serde_json::json!({ "w": size.width, "h": size.height }));
                let _ = config::save_config(app, &cfg);
            }
        }
    }
}

/// 统一模式下：热键切换主窗口呼出/隐藏（呼出时记录唤起前窗口供跟手粘贴）
fn toggle_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            if clipboard_enabled(app) {
                modules::clipboard::record_foreground_state(app);
            }
            if emoji_enabled(app) {
                modules::emoji::paste::record_foreground_state(app);
            }
            // 可选手：呼出时跟随鼠标定位
            let follow_mouse = app
                .state::<ConfigState>()
                .0
                .lock()
                .unwrap()
                .main_follow_mouse;
            if follow_mouse {
                modules::clipboard::position_at_cursor(&win);
            }
            show_main(app);
        }
    }
}

/// 统一模式下把主窗口调成"面板"形态：置顶 + 隐藏任务栏图标；关闭模式时还原
pub fn apply_main_window_mode(app: &tauri::AppHandle) {
    let unified = app
        .try_state::<ConfigState>()
        .map(|s| s.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner).unified_hotkey)
        .unwrap_or(false);
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = win.set_always_on_top(unified);
        let _ = win.set_skip_taskbar(unified);
    }
}

/// 失焦 200ms 后仍未聚焦则隐藏（点外部关闭；拖动标题栏/边缘缩放等瞬时失焦不误关）
pub(crate) fn hide_after_blur_grace(win: &tauri::Window) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    let win = win.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(200));
        if win.is_focused().map(|f| f).unwrap_or(false) {
            return;
        }
        // 左键仍按住 = 正在拖动窗口标题栏（move loop 中），等松手后再判，避免拖动中误关
        if (unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000) != 0 {
            continue;
        }
        let _ = win.hide();
        return;
    });
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

/// 确保延迟创建的弹窗窗口存在，并恢复记住的尺寸（四模块共用）。
/// 隐藏/最小化时 WebView2 会报 0x0 之类脏值，恢复前按最小尺寸过滤。
pub(crate) fn ensure_popup_window(
    app: &tauri::AppHandle,
    label: &'static str,
    html: &'static str,
    size: (f64, f64),
    cfg_key: &str,
) -> Option<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window(label) {
        return Some(win);
    }
    let win = tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::App(html.into()),
    )
    .decorations(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(size.0, size.1)
    .min_inner_size(400.0, 300.0)
    .resizable(true)
    .always_on_top(true)
    .build();
    match win {
        Ok(win) => {
            let saved_size = app
                .state::<ConfigState>()
                .0
                .lock()
                .unwrap()
                .modules
                .get(cfg_key)
                .and_then(|m| m.get("popup_size"))
                .cloned();
            if let Some(size) = saved_size {
                if let (Some(w), Some(h)) = (
                    size.get("w").and_then(|v| v.as_u64()),
                    size.get("h").and_then(|v| v.as_u64()),
                ) {
                    if w >= 400 && h >= 300 {
                        let _ = win.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
                    }
                }
            }
            Some(win)
        }
        Err(e) => {
            log::error!("failed to create popup window {label}: {e}");
            None
        }
    }
}

/// 按模块配置定位（跟随鼠标 / 固定位置）并显示聚焦弹窗。
pub(crate) fn show_popup_at(
    app: &tauri::AppHandle,
    win: &tauri::WebviewWindow,
    cfg_key: &str,
) {
    if let Ok(hwnd) = win.hwnd() {
        let cfg = config::module_cfg(app, cfg_key);
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

/// 读模块启用开关（统一实现；下方各模块包装名保留以便调用点自解释）
fn module_enabled(app: &tauri::AppHandle, id: &str) -> bool {
    app.try_state::<ConfigState>()
        .map(|s| {
            s.0.lock()
                .unwrap()
                .modules
                .get(id)
                .and_then(|m| m.get("enabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn clipboard_enabled(app: &tauri::AppHandle) -> bool {
    module_enabled(app, "clipboard")
}

fn quota_enabled(app: &tauri::AppHandle) -> bool {
    module_enabled(app, "quota")
}

fn search_enabled(app: &tauri::AppHandle) -> bool {
    module_enabled(app, "search")
}

fn emoji_enabled(app: &tauri::AppHandle) -> bool {
    module_enabled(app, "emoji")
}

fn timetracker_enabled(app: &tauri::AppHandle) -> bool {
    module_enabled(app, "timetracker")
}

struct Hotkeys {
    unified: bool,
    clip_hotkey: String,
    search_hotkey: String,
    emoji_hotkey: String,
    timetracker_hotkey: String,
    main_hotkey: String,
}

/// 已解析热键缓存：避免每次按键回调重复解析字符串 + 持配置锁
#[derive(Clone, Default)]
struct ResolvedHotkeys {
    unified: bool,
    clip_enabled: bool,
    search_enabled: bool,
    emoji_enabled: bool,
    timetracker_enabled: bool,
    clip: Option<Shortcut>,
    search: Option<Shortcut>,
    emoji: Option<Shortcut>,
    timetracker: Option<Shortcut>,
    main: Option<Shortcut>,
    /// 原始字符串（注册接口需要 &str 参数）
    clip_str: Option<String>,
    search_str: Option<String>,
    emoji_str: Option<String>,
    timetracker_str: Option<String>,
    main_str: Option<String>,
}

static RESOLVED_HOTKEYS: OnceLock<Mutex<ResolvedHotkeys>> = OnceLock::new();

/// 重建已解析热键缓存（配置变化时由 reapply_hotkeys 调用）
fn refresh_resolved_hotkeys(app: &tauri::AppHandle) {
    let hk = read_hotkeys(app);
    let resolved = ResolvedHotkeys {
        unified: hk.unified,
        clip_enabled: clipboard_enabled(app),
        search_enabled: search_enabled(app),
        emoji_enabled: emoji_enabled(app),
        timetracker_enabled: timetracker_enabled(app),
        clip: Shortcut::from_str(&hk.clip_hotkey).ok(),
        search: Shortcut::from_str(&hk.search_hotkey).ok(),
        emoji: Shortcut::from_str(&hk.emoji_hotkey).ok(),
        timetracker: Shortcut::from_str(&hk.timetracker_hotkey).ok(),
        main: Shortcut::from_str(&hk.main_hotkey).ok(),
        clip_str: Some(hk.clip_hotkey.clone()),
        search_str: Some(hk.search_hotkey.clone()),
        emoji_str: Some(hk.emoji_hotkey.clone()),
        timetracker_str: Some(hk.timetracker_hotkey.clone()),
        main_str: Some(hk.main_hotkey),
    };
    *RESOLVED_HOTKEYS
        .get_or_init(|| Mutex::new(ResolvedHotkeys::default()))
        .lock()
        .unwrap() = resolved;
}

fn read_resolved_hotkeys() -> ResolvedHotkeys {
    RESOLVED_HOTKEYS
        .get_or_init(|| Mutex::new(ResolvedHotkeys::default()))
        .lock()
        .unwrap()
        .clone()
}

fn read_hotkeys(app: &tauri::AppHandle) -> Hotkeys {
    let state = app.state::<ConfigState>();
    let cfg = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let clip_hotkey = cfg
        .modules
        .get("clipboard")
        .and_then(|m| m.get("hotkey"))
        .and_then(|v| v.as_str())
        .unwrap_or("Ctrl+Shift+V")
        .to_string();
    let search_hotkey = cfg
        .modules
        .get("search")
        .and_then(|m| m.get("hotkey"))
        .and_then(|v| v.as_str())
        .unwrap_or("Ctrl+Shift+F")
        .to_string();
    let emoji_hotkey = cfg
        .modules
        .get("emoji")
        .and_then(|m| m.get("hotkey"))
        .and_then(|v| v.as_str())
        .unwrap_or("Ctrl+Shift+J")
        .to_string();
    let timetracker_hotkey = cfg
        .modules
        .get("timetracker")
        .and_then(|m| m.get("hotkey"))
        .and_then(|v| v.as_str())
        .unwrap_or("Ctrl+Shift+T")
        .to_string();
    Hotkeys {
        unified: cfg.unified_hotkey,
        clip_hotkey,
        search_hotkey,
        emoji_hotkey,
        timetracker_hotkey,
        main_hotkey: cfg
            .hotkeys
            .get("main")
            .cloned()
            .unwrap_or_else(|| "Ctrl+Shift+E".into()),
    }
}

/// 开库失败兜底：把损坏的库文件（含 -wal/-shm）改名隔离留证，让调用方重建空库。
/// 避免库损坏时 expect 直接 panic，导致应用完全无法启动且无托盘可操作
pub(crate) fn quarantine_broken_db(db_path: &std::path::Path) {
    let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    for suffix in ["", "-wal", "-shm"] {
        let p = std::path::PathBuf::from(format!("{}{suffix}", db_path.display()));
        if let (true, Some(name)) = (p.exists(), p.file_name()) {
            let mut new_name = name.to_os_string();
            new_name.push(format!(".broken-{ts}"));
            let _ = std::fs::rename(&p, p.with_file_name(new_name));
        }
    }
}

/// 热键注册失败时的用户可见提示（系统通知；被其他程序占用是最常见原因）。
/// 只写日志的话，统一模式下用户将无法用热键呼出窗口且毫无感知
fn notify_hotkey_failed(app: &tauri::AppHandle, hk: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title("EasyTool 热键注册失败")
        .body(format!("{hk} 可能已被其他程序占用，请到设置中更换"))
        .show();
}

/// 按统一呼出模式重新注册全局热键：
/// - unified=true：只注册主窗口热键，模块独立热键全部禁用
/// - unified=false：只注册各模块独立热键，主窗口呼出热键失效（改用托盘呼出）
pub fn reapply_hotkeys(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister_all();
    // 先刷新缓存，再按缓存注册（保持 handler 匹配与注册一致）
    refresh_resolved_hotkeys(app);
    let resolved = read_resolved_hotkeys();
    if resolved.unified {
        if let Some(hk) = &resolved.main_str {
            match app.global_shortcut().register(hk.as_str()) {
                Ok(_) => log::info!("[unified] main hotkey registered: {hk}"),
                    Err(e) => {
                        log::error!("failed to register main hotkey: {e}");
                        notify_hotkey_failed(app, hk);
                    }
            }
        } else {
            log::warn!("[unified] main hotkey invalid, nothing registered");
        }
    } else {
        if resolved.clip_enabled {
            if let Some(hk) = &resolved.clip_str {
                match app.global_shortcut().register(hk.as_str()) {
                    Ok(_) => log::info!("clipboard hotkey registered: {hk}"),
                    Err(e) => {
                        log::error!("failed to register clipboard hotkey: {e}");
                        notify_hotkey_failed(app, hk);
                    }
                }
            }
        }
        if resolved.search_enabled {
            if let Some(hk) = &resolved.search_str {
                match app.global_shortcut().register(hk.as_str()) {
                    Ok(_) => log::info!("search hotkey registered: {hk}"),
                    Err(e) => {
                        log::error!("failed to register search hotkey: {e}");
                        notify_hotkey_failed(app, hk);
                    }
                }
            }
        }
        if resolved.emoji_enabled {
            if let Some(hk) = &resolved.emoji_str {
                match app.global_shortcut().register(hk.as_str()) {
                    Ok(_) => log::info!("emoji hotkey registered: {hk}"),
                    Err(e) => {
                        log::error!("failed to register emoji hotkey: {e}");
                        notify_hotkey_failed(app, hk);
                    }
                }
            }
        }
        if resolved.timetracker_enabled {
            if let Some(hk) = &resolved.timetracker_str {
                match app.global_shortcut().register(hk.as_str()) {
                    Ok(_) => log::info!("timetracker hotkey registered: {hk}"),
                    Err(e) => {
                        log::error!("failed to register timetracker hotkey: {e}");
                        notify_hotkey_failed(app, hk);
                    }
                }
            }
        }
    }
}

/// 前端 JS 错误上报：写入 easytool.log，方便远程排查渲染问题
#[tauri::command]
fn log_frontend(level: String, msg: String) {
    match level.as_str() {
        "error" => log::error!("[frontend] {msg}"),
        "warn" => log::warn!("[frontend] {msg}"),
        _ => log::info!("[frontend] {msg}"),
    }
}

/// 前端首屏就绪信号：页面加载完成才显示主窗口（配合 visible:false，消除空白期）
#[tauri::command]
fn main_window_ready(app: tauri::AppHandle) {
    log::info!("[frontend] first paint ready, showing main window");
    show_main(&app);
}

/// 启动一次性拉取：模块清单 + 配置（合并原 get_manifests/get_config 两次 IPC）
#[derive(serde::Serialize)]
struct Bootstrap {
    manifests: Vec<modules::Manifest>,
    config: config::AppConfig,
}

#[tauri::command]
fn get_bootstrap(app: tauri::AppHandle) -> Bootstrap {
    let config = app
        .state::<config::ConfigState>()
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    Bootstrap {
        manifests: modules::load_manifests(&app),
        config,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logger();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    log::info!("global shortcut pressed: {shortcut}");
                    let resolved = read_resolved_hotkeys();
                    if !resolved.unified
                        && resolved.clip_enabled
                        && resolved.clip.as_ref().is_some_and(|s| s == shortcut)
                    {
                        log::info!("clipboard hotkey matched, showing popup");
                        modules::clipboard::on_hotkey(app);
                    } else if !resolved.unified
                        && resolved.search_enabled
                        && resolved.search.as_ref().is_some_and(|s| s == shortcut)
                    {
                        log::info!("search hotkey matched, showing popup");
                        modules::search::on_hotkey(app);
                    } else if !resolved.unified
                        && resolved.emoji_enabled
                        && resolved.emoji.as_ref().is_some_and(|s| s == shortcut)
                    {
                        log::info!("emoji hotkey matched, showing popup");
                        modules::emoji::on_hotkey(app);
                    } else if !resolved.unified
                        && resolved.timetracker_enabled
                        && resolved.timetracker.as_ref().is_some_and(|s| s == shortcut)
                    {
                        log::info!("timetracker hotkey matched, showing popup");
                        modules::timetracker::on_hotkey(app);
                    } else if resolved.main.as_ref().is_some_and(|s| s == shortcut) {
                        if resolved.unified {
                            log::info!("main hotkey toggling main window");
                            toggle_main(app);
                        } else {
                            // 主窗口呼出：先记录唤起前窗口，供剪贴板跟手粘贴
                            if resolved.clip_enabled {
                                modules::clipboard::record_foreground_state(app);
                            }
                            show_main(app);
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // 并行加载配置和 manifests
            let app_handle = app.handle().clone();
            let cfg_handle = app_handle.clone();
            let manifests_handle = app_handle.clone();
            
            let cfg_thread = std::thread::spawn(move || {
                config::load_config(&cfg_handle)
            });
            
            let manifests_thread = std::thread::spawn(move || {
                modules::load_manifests(&manifests_handle)
            });
            
            // 等待配置和 manifests 加载完成
            let mut cfg = cfg_thread.join().unwrap_or_else(|e| {
                log::error!("config load thread panicked: {:?}", e);
                config::load_config(app.handle())
            });
            
            let manifests = manifests_thread.join().unwrap_or_else(|e| {
                log::error!("manifests load thread panicked: {:?}", e);
                modules::load_manifests(app.handle())
            });
            
            modules::merge_manifests(&mut cfg, &manifests);
            let _ = config::save_config(app.handle(), &cfg);
            app.manage(ConfigState(std::sync::Mutex::new(cfg)));

            // 旧数据一次性迁移（在模块 setup 之前，避免与剪贴板模块同时打开新库）
            migrate::run_migration(app.handle());

            // 并行初始化模块
            let clipboard_handle = if clipboard_enabled(app.handle()) {
                log::info!("[setup] initializing clipboard module");
                let app_clone = app.handle().clone();
                Some(std::thread::spawn(move || {
                    modules::clipboard::setup_from_handle(&app_clone)
                }))
            } else {
                log::info!("[setup] clipboard module disabled, skipping");
                None
            };

            let quota_handle = if quota_enabled(app.handle()) {
                log::info!("[setup] initializing quota module");
                let app_clone = app.handle().clone();
                Some(std::thread::spawn(move || {
                    modules::quota::setup_from_handle(&app_clone)
                }))
            } else {
                log::info!("[setup] quota module disabled, skipping");
                None
            };

            let search_handle = if search_enabled(app.handle()) {
                log::info!("[setup] initializing search module");
                let app_clone = app.handle().clone();
                Some(std::thread::spawn(move || {
                    modules::search::setup_from_handle(&app_clone)
                }))
            } else {
                log::info!("[setup] search module disabled, skipping");
                None
            };

            let emoji_handle = if emoji_enabled(app.handle()) {
                log::info!("[setup] initializing emoji module");
                let app_clone = app.handle().clone();
                Some(std::thread::spawn(move || {
                    modules::emoji::setup_from_handle(&app_clone)
                }))
            } else {
                log::info!("[setup] emoji module disabled, skipping");
                None
            };

            let timetracker_handle = if timetracker_enabled(app.handle()) {
                log::info!("[setup] initializing timetracker module");
                let app_clone = app.handle().clone();
                Some(std::thread::spawn(move || {
                    modules::timetracker::setup_from_handle(&app_clone)
                }))
            } else {
                log::info!("[setup] timetracker module disabled, skipping");
                None
            };

            // 等待剪贴板模块初始化完成（弹窗窗口延迟到首次呼出时创建，避免启动闪现）
            if let Some(handle) = clipboard_handle {
                match handle.join() {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => {
                        log::error!("clipboard module init failed: {e}");
                    }
                    Err(e) => {
                        log::error!("clipboard module thread panicked: {:?}", e);
                    }
                }
            }

            // 等待额度监控模块初始化完成（延迟加载）
            if let Some(handle) = quota_handle {
                // 额度监控模块延迟 500ms 初始化，让用户先看到主窗口
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    match handle.join() {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => {
                            log::error!("quota module init failed: {e}");
                        }
                        Err(e) => {
                            log::error!("quota module thread panicked: {:?}", e);
                        }
                    }
                });
            }

            // 全局热键（按统一呼出模式注册）
            reapply_hotkeys(app.handle());
            // 主窗口形态：统一模式下置顶 + 隐藏任务栏
            apply_main_window_mode(app.handle());

            // 恢复主窗口记住的尺寸
            let saved_main_size = {
                let state = app.state::<ConfigState>();
                let c = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                c.main_size.clone()
            };
            if let Some(size) = saved_main_size {
                if let (Some(w), Some(h)) = (
                    size.get("w").and_then(|v| v.as_u64()),
                    size.get("h").and_then(|v| v.as_u64()),
                ) {
                    // 校验最小尺寸：0 或小于最小限制的尺寸是脏数据，忽略（用默认尺寸）
                    if w >= 400 && h >= 300 {
                        if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                            let _ = win.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
                        }
                    }
                }
            }
            // 显示时机交给前端：首屏就绪后调 main_window_ready 再显示，
            // 消除「窗口先出现、内容后跟上」的空白期；
            // 8s 兜底：前端异常未发信号时强制显示，避免窗口永不出现
            let fallback_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(8));
                if let Some(win) = fallback_handle.get_webview_window(MAIN_WINDOW_LABEL) {
                    if !win.is_visible().unwrap_or(true) {
                        log::warn!("main_window_ready timeout, force showing main window");
                        let _ = win.show();
                    }
                }
            });

            build_tray(app)?;

            // search/emoji/timetracker 的 join 放后台线程：setup 内任何阻塞都会推迟事件循环启动
            // （即推迟首帧绘制）；二者实际工作在上方 spawn 时已并行开始，
            // 主窗口首屏只依赖剪贴板模块，前端首次访问对应页面时早已就绪
            std::thread::spawn(move || {
                if let Some(handle) = search_handle {
                    match handle.join() {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => log::error!("search module init failed: {e}"),
                        Err(e) => log::error!("search module thread panicked: {:?}", e),
                    }
                }
                if let Some(handle) = emoji_handle {
                    match handle.join() {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => log::error!("emoji module init failed: {e}"),
                        Err(e) => log::error!("emoji module thread panicked: {:?}", e),
                    }
                }
                if let Some(handle) = timetracker_handle {
                    match handle.join() {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => log::error!("timetracker module init failed: {e}"),
                        Err(e) => log::error!("timetracker module thread panicked: {:?}", e),
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_frontend,
            main_window_ready,
            config::get_config,
            config::set_module_enabled,
            config::set_module_config,
            config::set_module_order,
            config::set_theme,
            config::set_unified_hotkey,
            config::set_main_hotkey,
            config::save_main_size,
            config::set_main_follow_mouse,
            get_bootstrap,
            modules::clipboard::commands::get_history,
            modules::clipboard::commands::get_all_history,
            modules::clipboard::commands::pin_item,
            modules::clipboard::commands::set_item_note,
            modules::clipboard::commands::set_pin_order,
            modules::clipboard::commands::delete_item,
            modules::clipboard::commands::clear_history,
            modules::clipboard::commands::clear_all_history,
            modules::clipboard::commands::paste_item,
            modules::clipboard::commands::copy_item,
            modules::clipboard::commands::open_file_location,
            modules::clipboard::commands::open_file,
            modules::clipboard::commands::set_max_items,
            modules::clipboard::commands::set_hotkey,
            modules::clipboard::commands::set_follow_mouse,
            modules::clipboard::commands::get_data_dir,
            modules::clipboard::commands::open_data_dir,
            modules::clipboard::commands::get_stats,
            modules::clipboard::commands::get_thumb,
            modules::clipboard::commands::get_image,
            modules::clipboard::commands::get_image_path,
            modules::clipboard::commands::get_file_icon,
            modules::clipboard::commands::get_file_thumb,
            modules::clipboard::commands::get_file_preview,
            modules::quota::commands::get_status,
            modules::quota::commands::get_settings,
            modules::quota::commands::save_settings,
            modules::quota::commands::add_account,
            modules::quota::commands::remove_account,
            modules::quota::commands::rename_account,
            modules::quota::commands::set_account_key,
            modules::quota::commands::test_key,
            modules::quota::commands::get_stats_data,
            modules::quota::commands::get_daily_history,
            modules::quota::commands::get_go_cycles,
            modules::search::commands::search,
            modules::search::commands::search_get_status,
            modules::search::commands::search_start_everything,
            modules::search::commands::search_open_file,
            modules::search::commands::search_open_file_location,
            modules::search::commands::search_copy_path,
            modules::search::commands::search_copy_file,
            modules::search::commands::search_set_hotkey,
            modules::search::commands::search_scan_apps,
            modules::search::commands::search_open_path,
            modules::emoji::commands::get_emoji_static,
            modules::emoji::commands::get_emoji_dynamic,
            modules::emoji::commands::get_groups,
            modules::emoji::commands::import_emoji_files,
            modules::emoji::commands::add_clipboard_item_as_emoji,
            modules::emoji::commands::delete_custom_emoji,
            modules::emoji::commands::rename_custom_emoji,
            modules::emoji::commands::move_custom_emoji,
            modules::emoji::commands::create_group,
            modules::emoji::commands::rename_group,
            modules::emoji::commands::delete_group,
            modules::emoji::commands::record_use,
            modules::emoji::commands::toggle_favorite,
            modules::emoji::commands::get_emoji_thumb,
            modules::emoji::commands::apply_emoji,
            modules::emoji::commands::copy_custom_emoji,
            modules::timetracker::commands::timetracker_get_today_stats,
            modules::timetracker::commands::timetracker_get_week_stats,
            modules::timetracker::commands::timetracker_get_month_stats,
            modules::timetracker::commands::timetracker_get_day_stats,
            modules::timetracker::commands::timetracker_get_day_overview,
            modules::timetracker::commands::timetracker_get_daily_totals,
            modules::timetracker::commands::timetracker_get_app_timeline,
modules::timetracker::commands::timetracker_get_app_timeline_range,
            modules::timetracker::commands::timetracker_get_app_detail,
            modules::timetracker::commands::timetracker_today_top,
            modules::timetracker::commands::timetracker_set_recording,
            modules::timetracker::commands::timetracker_is_recording,
modules::timetracker::commands::timetracker_set_category,
modules::timetracker::commands::timetracker_delete_event,
modules::timetracker::commands::timetracker_get_category_breakdown,
modules::timetracker::commands::timetracker_list_rules,
modules::timetracker::commands::timetracker_add_rule,
modules::timetracker::commands::timetracker_update_rule,
modules::timetracker::commands::timetracker_delete_rule,
modules::timetracker::commands::timetracker_reapply_rules,
modules::timetracker::commands::timetracker_list_apps,
modules::timetracker::commands::timetracker_reset_app_category,
modules::timetracker::commands::timetracker_get_week_overview,
modules::timetracker::commands::timetracker_get_month_overview,
modules::timetracker::commands::timetracker_get_category_breakdown_range,
        ])
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == MAIN_WINDOW_LABEL {
                        save_main_window_size(window.app_handle());
                        let _ = window.hide();
                        api.prevent_close();
                    }
                }
                WindowEvent::Focused(false) => {
                    let label = window.label().to_string();
                    if label == modules::clipboard::POPUP_WINDOW_LABEL
                        || label == modules::search::POPUP_WINDOW_LABEL
                        || label == modules::emoji::POPUP_WINDOW_LABEL
                        || label == modules::timetracker::POPUP_WINDOW_LABEL
                    {
                        hide_after_blur_grace(window);
                    } else if label == MAIN_WINDOW_LABEL {
                        // 统一模式下点外部即隐藏主窗口（面板行为）
                        let unified = window
                            .app_handle()
                            .state::<ConfigState>()
                            .0
                            .lock()
                            .unwrap()
                            .unified_hotkey;
                        if unified {
                            hide_after_blur_grace(window);
                        }
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
