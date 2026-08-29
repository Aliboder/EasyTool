mod config;
mod migrate;
mod modules;

use config::ConfigState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};

pub const MAIN_WINDOW_LABEL: &str = "main";

/// 极简日志器：输出到 stderr + 日志文件（%APPDATA%/com.aliboder.easytool/easytool.log）。
/// BufWriter 缓冲合并写盘，降低高频日志（热键/心跳/剪贴板）的系统调用与锁竞争；
/// 缓冲超阈值时主动 flush，避免崩溃丢日志过多。
struct SimpleLogger {
    file: std::sync::Mutex<std::io::BufWriter<std::fs::File>>,
    /// 自上次 flush 以来的日志行数（达到阈值主动写盘）
    pending: std::sync::atomic::AtomicU32,
}

static LOGGER: std::sync::OnceLock<SimpleLogger> = std::sync::OnceLock::new();

/// 缓冲行数上限：超过强制写盘（保证高频日志下崩溃丢日志可控）
const LOG_FLUSH_LINES: u32 = 256;

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
            if self.pending.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1 >= LOG_FLUSH_LINES
            {
                self.pending.store(0, std::sync::atomic::Ordering::SeqCst);
                let _ = file.flush();
            }
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
                    file: std::sync::Mutex::new(std::io::BufWriter::new(file)),
                    pending: std::sync::atomic::AtomicU32::new(0),
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
    let clipboard = MenuItem::with_id(app, "clipboard", "打开剪贴板", true, None::<&str>)?;
    let timetracker = MenuItem::with_id(app, "timetracker", "打开时长统计", true, None::<&str>)?;
    let check_update = MenuItem::with_id(app, "check-update", "检查更新", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &clipboard, &timetracker, &check_update, &quit])?;

    let icon = app.default_window_icon().cloned().expect("no window icon");
    let _ = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            // 快速入口：先发导航事件再呼出窗口（前端监听切到对应模块页）
            "clipboard" => {
                let _ = app.emit("tray://nav", serde_json::json!({ "page": "clipboard" }));
                show_main(app);
            }
            "timetracker" => {
                let _ = app.emit("tray://nav", serde_json::json!({ "page": "timetracker" }));
                show_main(app);
            }
            "check-update" => {
                let _ = app.emit("tray://check-update", serde_json::json!({}));
                show_main(app);
            }
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

/// show_main 呼出后主窗口是否真正拿到过焦点。托盘点击不授予前台权限，set_focus
/// 可能失败——没拿到过焦点的「失焦」不是用户点外部，blur-grace 据此不隐藏
static MAIN_FOCUSED_SINCE_SHOW: AtomicBool = AtomicBool::new(false);

fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        // 托盘点击不授予前台权限：先注入一次无害按键（F24），让系统认为本进程刚
        // 收到用户输入，set_focus 才有权限真正拿到焦点（托盘应用的标准做法）
        unsafe {
            use windows::Win32::UI::Input::KeyboardAndMouse::{
                keybd_event, KEYEVENTF_KEYUP, KEYBD_EVENT_FLAGS,
            };
            keybd_event(0x87, 0, KEYBD_EVENT_FLAGS(0), 0); // VK_F24 down
            keybd_event(0x87, 0, KEYEVENTF_KEYUP, 0); // VK_F24 up
        }
        if win.is_focused().unwrap_or(false) {
            MAIN_FOCUSED_SINCE_SHOW.store(true, Ordering::Relaxed);
        } else {
            MAIN_FOCUSED_SINCE_SHOW.store(false, Ordering::Relaxed);
        }
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        // 焦点可能没立即落定（子 WebView 激活抖动）：重试几次，让窗口真正拿到焦点
        let app = app.clone();
        std::thread::spawn(move || {
            for delay in [150u64, 400, 900] {
                std::thread::sleep(std::time::Duration::from_millis(delay));
                let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
                    return;
                };
                if win.is_focused().unwrap_or(false) {
                    return;
                }
                let _ = win.set_focus();
            }
        });
    }
}

/// 保存主窗口尺寸（重启恢复）；忽略 0/极小尺寸（窗口隐藏/最小化时 WebView2 会报 0x0）
fn save_main_window_size(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if let Ok(size) = win.inner_size() {
            // 与 save_main_size 一致：忽略 0/极小尺寸（隐藏/最小化时可能报 0x0）
            if size.width >= 400 && size.height >= 300 {
                let mut saved = serde_json::json!({ "w": size.width, "h": size.height });
                // 同时记住位置：多显示器场景下重启后恢复到原显示器
                if let Ok(pos) = win.outer_position() {
                    if pos.x.abs() < 100_000 && pos.y.abs() < 100_000 {
                        saved["x"] = serde_json::json!(pos.x);
                        saved["y"] = serde_json::json!(pos.y);
                    }
                }
                let cfg = app.state::<ConfigState>();
                let mut cfg = cfg.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                cfg.main_size = Some(saved);
                let _ = config::save_config(app, &cfg);
            }
        }
    }
}

/// 主热键：切换主窗口呼出/隐藏（呼出时可选择跟随鼠标定位）
fn toggle_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
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

/// 主窗口恒按「面板」形态工作：置顶 + 隐藏任务栏图标
pub fn apply_main_window_mode(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = win.set_always_on_top(true);
        let _ = win.set_skip_taskbar(true);
    }
}

/// 失焦 200ms 后仍未聚焦则隐藏（点外部关闭；拖动标题栏/边缘缩放等瞬时失焦不误关）
pub(crate) fn hide_after_blur_grace(win: &tauri::Window) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    let win = win.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(200));
        if win.is_focused().unwrap_or(false) {
            return;
        }
        // 呼出保护：show_main 后主窗口还没真正拿到过焦点（托盘点击不授予前台权限、
        // set_focus 失败）时，焦点在外不是用户点外部，等焦点落定再说
        if win.label() == MAIN_WINDOW_LABEL && !MAIN_FOCUSED_SINCE_SHOW.load(Ordering::Relaxed) {
            continue;
        }
        // 左键仍按住 = 正在拖动窗口标题栏（move loop 中），等松手后再判，避免拖动中误关
        if (unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000) != 0 {
            continue;
        }
        let _ = win.hide();
        return;
    });
}

/// 计算主窗口跟随鼠标时的位置：横向居中于光标、纵向在光标下方，
/// 全部使用 Win32 物理坐标（与 Tauri 的 DPI 换算无关），
/// 并钳制在光标所在显示器的工作区内，窄屏时防护
pub(crate) fn position_at_cursor_physical(hwnd: windows::Win32::Foundation::HWND) -> (i32, i32) {
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

fn calendar_enabled(app: &tauri::AppHandle) -> bool {
    module_enabled(app, "calendar")
}

struct Hotkeys {
    main_hotkey: String,
}

/// 已解析主热键缓存：避免每次按键回调重复解析字符串 + 持配置锁
#[derive(Clone, Default)]
struct ResolvedHotkeys {
    main: Option<Shortcut>,
    /// 原始字符串（注册接口需要 &str 参数）
    main_str: Option<String>,
}

static RESOLVED_HOTKEYS: OnceLock<Mutex<ResolvedHotkeys>> = OnceLock::new();

/// 重建已解析热键缓存（配置变化时由 reapply_hotkeys 调用）
fn refresh_resolved_hotkeys(app: &tauri::AppHandle) {
    let hk = read_hotkeys(app);
    let resolved = ResolvedHotkeys {
        main: Shortcut::from_str(&hk.main_hotkey).ok(),
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
    Hotkeys {
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

/// 注册主窗口全局呼出热键（唯一热键；被占用时系统通知提示）
pub fn reapply_hotkeys(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister_all();
    // 先刷新缓存，再按缓存注册（保持 handler 匹配与注册一致）
    refresh_resolved_hotkeys(app);
    let resolved = read_resolved_hotkeys();
    if let Some(hk) = &resolved.main_str {
        match app.global_shortcut().register(hk.as_str()) {
            Ok(_) => log::info!("main hotkey registered: {hk}"),
            Err(e) => {
                log::error!("failed to register main hotkey: {e}");
                notify_hotkey_failed(app, hk);
            }
        }
    } else {
        log::warn!("main hotkey invalid, nothing registered");
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
                    if resolved.main.as_ref().is_some_and(|s| s == shortcut) {
                        log::info!("main hotkey toggling main window");
                        toggle_main(app);
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
            // 清理已废弃的配置键（弹窗/模块热键时代的残留），有清理才写盘
            if config::sanitize_legacy_keys(&mut cfg) {
                let _ = config::save_config(app.handle(), &cfg);
            }
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

            let calendar_handle = if calendar_enabled(app.handle()) {
                log::info!("[setup] initializing calendar module");
                let app_clone = app.handle().clone();
                Some(std::thread::spawn(move || {
                    modules::calendar::setup_from_handle(&app_clone)
                }))
            } else {
                log::info!("[setup] calendar module disabled, skipping");
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
                            // 恢复记住的位置（多显示器：回到上次所在显示器）
                            if let (Some(x), Some(y)) = (
                                size.get("x").and_then(|v| v.as_i64()),
                                size.get("y").and_then(|v| v.as_i64()),
                            ) {
                                if x.abs() < 100_000 && y.abs() < 100_000 {
                                    let _ = win.set_position(tauri::PhysicalPosition::new(
                                        x as i32, y as i32,
                                    ));
                                }
                            }
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
                if let Some(handle) = calendar_handle {
                    match handle.join() {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => log::error!("calendar module init failed: {e}"),
                        Err(e) => log::error!("calendar module thread panicked: {:?}", e),
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
            config::set_main_hotkey,
            config::save_main_size,
            config::set_main_follow_mouse,
            config::set_check_update_on_start,
            modules::clipboard::commands::github_latest_release,
            get_bootstrap,
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
            modules::clipboard::commands::get_data_dir,
            modules::clipboard::commands::open_data_dir,
            modules::clipboard::commands::get_stats,
            modules::clipboard::commands::get_thumb,
            modules::clipboard::commands::get_image,
            modules::clipboard::commands::get_image_path,
            modules::clipboard::commands::get_image_size,
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
            modules::quota::commands::get_account_key,
            modules::quota::commands::test_key,
            modules::quota::commands::set_account_custom,
            modules::quota::commands::save_account_order,
            modules::quota::commands::get_stats_data,
            modules::quota::commands::get_daily_history,
            modules::quota::commands::get_go_cycles,
            modules::quota::commands::quota_clear_history,
            modules::search::commands::search,
            modules::search::commands::search_get_status,
            modules::search::commands::search_start_everything,
            modules::search::commands::search_open_file,
            modules::search::commands::search_open_file_location,
            modules::search::commands::search_copy_path,
            modules::search::commands::search_copy_file,
            modules::search::commands::search_scan_apps,
            modules::search::commands::search_open_path,
            modules::search::commands::search_reset_apps,
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
            modules::timetracker::commands::timetracker_set_category,
            modules::timetracker::commands::timetracker_get_category_breakdown,
            modules::timetracker::commands::timetracker_list_rules,
            modules::timetracker::commands::timetracker_add_rule,
            modules::timetracker::commands::timetracker_delete_rule,
modules::timetracker::commands::timetracker_reapply_rules,
modules::timetracker::commands::timetracker_list_apps,
modules::timetracker::commands::timetracker_reset_app_category,
modules::timetracker::commands::timetracker_get_week_overview,
modules::timetracker::commands::timetracker_get_month_overview,
modules::timetracker::commands::timetracker_get_category_breakdown_range,
            modules::timetracker::commands::timetracker_clear_history,
            modules::calendar::commands::calendar_get_range,
            modules::calendar::commands::calendar_create_event,
            modules::calendar::commands::calendar_update_event,
            modules::calendar::commands::calendar_delete_event,
            modules::calendar::commands::calendar_create_todo,
            modules::calendar::commands::calendar_update_todo,
            modules::calendar::commands::calendar_toggle_todo,
            modules::calendar::commands::calendar_delete_todo,
            modules::calendar::commands::calendar_import_ics,
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
                WindowEvent::Focused(true) if window.label() == MAIN_WINDOW_LABEL => {
                    MAIN_FOCUSED_SINCE_SHOW.store(true, Ordering::Relaxed);
                }
                WindowEvent::Focused(false) => {
                    let label = window.label().to_string();
                    if label == MAIN_WINDOW_LABEL {
                        // 主窗口按「面板」工作：点外部即隐藏
                        hide_after_blur_grace(window);
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
