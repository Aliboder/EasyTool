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
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

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
            "[{}] {}: {}",
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
            "quit" => app.exit(0),
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

/// 统一模式下：热键切换主窗口呼出/隐藏（呼出时记录唤起前窗口供跟手粘贴）
fn toggle_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            if clipboard_enabled(app) {
                modules::clipboard::record_foreground_state(app);
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
        .map(|s| s.0.lock().unwrap().unified_hotkey)
        .unwrap_or(false);
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = win.set_always_on_top(unified);
        let _ = win.set_skip_taskbar(unified);
    }
}

/// 失焦 200ms 后仍未聚焦则隐藏（点外部关闭；边缘缩放等瞬时失焦不误关）
pub(crate) fn hide_after_blur_grace(win: &tauri::Window) {
    let win = win.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        let still_unfocused = win.is_focused().map(|f| !f).unwrap_or(true);
        if still_unfocused {
            let _ = win.hide();
        }
    });
}

/// 弹窗跟随鼠标定位（转发到剪贴板模块的物理坐标实现，供各模块弹窗复用）
pub(crate) fn popup_position_physical(hwnd: windows::Win32::Foundation::HWND) -> (i32, i32) {
    modules::clipboard::popup_position_physical(hwnd)
}

fn clipboard_enabled(app: &tauri::AppHandle) -> bool {
    app.try_state::<ConfigState>()
        .map(|s| {
            s.0.lock()
                .unwrap()
                .modules
                .get("clipboard")
                .and_then(|m| m.get("enabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn quota_enabled(app: &tauri::AppHandle) -> bool {
    app.try_state::<ConfigState>()
        .map(|s| {
            s.0.lock()
                .unwrap()
                .modules
                .get("quota")
                .and_then(|m| m.get("enabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn search_enabled(app: &tauri::AppHandle) -> bool {
    app.try_state::<ConfigState>()
        .map(|s| {
            s.0.lock()
                .unwrap()
                .modules
                .get("search")
                .and_then(|m| m.get("enabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn emoji_enabled(app: &tauri::AppHandle) -> bool {
    app.try_state::<ConfigState>()
        .map(|s| {
            s.0.lock()
                .unwrap()
                .modules
                .get("emoji")
                .and_then(|m| m.get("enabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

struct Hotkeys {
    unified: bool,
    clip_hotkey: String,
    search_hotkey: String,
    emoji_hotkey: String,
    main_hotkey: String,
}

fn read_hotkeys(app: &tauri::AppHandle) -> Hotkeys {
    let state = app.state::<ConfigState>();
    let cfg = state.0.lock().unwrap();
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
    Hotkeys {
        unified: cfg.unified_hotkey,
        clip_hotkey,
        search_hotkey,
        emoji_hotkey,
        main_hotkey: cfg
            .hotkeys
            .get("main")
            .cloned()
            .unwrap_or_else(|| "Ctrl+Shift+E".into()),
    }
}

/// 按统一呼出模式重新注册全局热键：
/// - unified=true：只注册主窗口热键，模块独立热键全部禁用
/// - unified=false：只注册各模块独立热键，主窗口呼出热键失效（改用托盘呼出）
pub fn reapply_hotkeys(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister_all();
    let hk = read_hotkeys(app);
    if hk.unified {
        match app.global_shortcut().register(hk.main_hotkey.as_str()) {
            Ok(_) => log::info!("[unified] main hotkey registered: {}", hk.main_hotkey),
            Err(e) => log::error!("failed to register main hotkey: {e}"),
        }
    } else {
        if clipboard_enabled(app) {
            match app.global_shortcut().register(hk.clip_hotkey.as_str()) {
                Ok(_) => log::info!("clipboard hotkey registered: {}", hk.clip_hotkey),
                Err(e) => log::error!("failed to register clipboard hotkey: {e}"),
            }
        }
        if search_enabled(app) {
            match app.global_shortcut().register(hk.search_hotkey.as_str()) {
                Ok(_) => log::info!("search hotkey registered: {}", hk.search_hotkey),
                Err(e) => log::error!("failed to register search hotkey: {e}"),
            }
        }
        if emoji_enabled(app) {
            match app.global_shortcut().register(hk.emoji_hotkey.as_str()) {
                Ok(_) => log::info!("emoji hotkey registered: {}", hk.emoji_hotkey),
                Err(e) => log::error!("failed to register emoji hotkey: {e}"),
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logger();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let key = shortcut.to_string().to_lowercase();
                    log::info!("global shortcut pressed: {key}");
                    let Some(cfg) = app.try_state::<ConfigState>() else {
                        return;
                    };
                    let (unified, clip_enabled, clip_hotkey, search_enabled, search_hotkey, emoji_enabled, emoji_hotkey, main_hotkey) =
                        {
                            let cfg = cfg.0.lock().unwrap();
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
                            let main_hotkey = cfg
                                .hotkeys
                                .get("main")
                                .cloned()
                                .unwrap_or_else(|| "Ctrl+Shift+E".into());
                            let clip_enabled = cfg
                                .modules
                                .get("clipboard")
                                .and_then(|m| m.get("enabled"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let search_enabled = cfg
                                .modules
                                .get("search")
                                .and_then(|m| m.get("enabled"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let emoji_enabled = cfg
                                .modules
                                .get("emoji")
                                .and_then(|m| m.get("enabled"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            (
                                cfg.unified_hotkey,
                                clip_enabled,
                                clip_hotkey,
                                search_enabled,
                                search_hotkey,
                                emoji_enabled,
                                emoji_hotkey,
                                main_hotkey,
                            )
                        };
                    let clip_match = Shortcut::from_str(&clip_hotkey)
                        .map(|s| s == *shortcut)
                        .unwrap_or(false);
                    let search_match = Shortcut::from_str(&search_hotkey)
                        .map(|s| s == *shortcut)
                        .unwrap_or(false);
                    let emoji_match = Shortcut::from_str(&emoji_hotkey)
                        .map(|s| s == *shortcut)
                        .unwrap_or(false);
                    let main_match = Shortcut::from_str(&main_hotkey)
                        .map(|s| s == *shortcut)
                        .unwrap_or(false);
                    if !unified && clip_enabled && clip_match {
                        log::info!("clipboard hotkey matched, showing popup");
                        modules::clipboard::on_hotkey(app);
                    } else if !unified && search_enabled && search_match {
                        log::info!("search hotkey matched, showing popup");
                        modules::search::on_hotkey(app);
                    } else if !unified && emoji_enabled && emoji_match {
                        log::info!("emoji hotkey matched, showing popup");
                        modules::emoji::on_hotkey(app);
                    } else if main_match {
                        if unified {
                            log::info!("main hotkey toggling main window");
                            toggle_main(app);
                        } else {
                            // 主窗口呼出：先记录唤起前窗口，供剪贴板跟手粘贴
                            if clipboard_enabled(app) {
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
                let app_clone = app.handle().clone();
                Some(std::thread::spawn(move || {
                    modules::clipboard::setup_from_handle(&app_clone)
                }))
            } else {
                None
            };

            let quota_handle = if quota_enabled(app.handle()) {
                let app_clone = app.handle().clone();
                Some(std::thread::spawn(move || {
                    modules::quota::setup_from_handle(&app_clone)
                }))
            } else {
                None
            };

            let search_handle = if search_enabled(app.handle()) {
                let app_clone = app.handle().clone();
                Some(std::thread::spawn(move || {
                    modules::search::setup_from_handle(&app_clone)
                }))
            } else {
                None
            };

            let emoji_handle = if emoji_enabled(app.handle()) {
                let app_clone = app.handle().clone();
                Some(std::thread::spawn(move || {
                    modules::emoji::setup_from_handle(&app_clone)
                }))
            } else {
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

            // 等待搜索模块初始化完成（SDK 后台加载）
            if let Some(handle) = search_handle {
                match handle.join() {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => {
                        log::error!("search module init failed: {e}");
                    }
                    Err(e) => {
                        log::error!("search module thread panicked: {:?}", e);
                    }
                }
            }

            // 等待表情模块初始化完成
            if let Some(handle) = emoji_handle {
                match handle.join() {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => {
                        log::error!("emoji module init failed: {e}");
                    }
                    Err(e) => {
                        log::error!("emoji module thread panicked: {:?}", e);
                    }
                }
            }

            // 全局热键（按统一呼出模式注册）
            reapply_hotkeys(app.handle());
            // 主窗口形态：统一模式下置顶 + 隐藏任务栏
            apply_main_window_mode(app.handle());

            // 恢复主窗口记住的尺寸
            let saved_main_size = {
                let state = app.state::<ConfigState>();
                let c = state.0.lock().unwrap();
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

            build_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_frontend,
            config::get_config,
            config::set_module_enabled,
            config::set_theme,
            config::set_unified_hotkey,
            config::set_main_hotkey,
            config::save_main_size,
            config::set_main_follow_mouse,
            modules::get_manifests,
            modules::clipboard::commands::get_history,
            modules::clipboard::commands::pin_item,
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
            modules::clipboard::commands::save_fixed_pos,
            modules::clipboard::commands::save_popup_size,
            modules::clipboard::commands::save_clipboard_settings,
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
            modules::quota::commands::get_panel_order,
            modules::quota::commands::save_panel_order,
            modules::quota::commands::add_account,
            modules::quota::commands::remove_account,
            modules::quota::commands::rename_account,
            modules::quota::commands::set_account_key,
            modules::quota::commands::test_key,
            modules::quota::commands::get_stats_data,
            modules::quota::commands::get_daily_history,
            modules::search::commands::search,
            modules::search::commands::search_get_status,
            modules::search::commands::search_start_everything,
            modules::search::commands::search_open_file,
            modules::search::commands::search_open_file_location,
            modules::search::commands::search_copy_path,
            modules::search::commands::search_copy_file,
            modules::search::commands::search_save_settings,
            modules::search::commands::search_save_fixed_pos,
            modules::search::commands::search_save_popup_size,
            modules::search::commands::search_set_hotkey,
            modules::emoji::commands::get_emoji_all,
            modules::emoji::commands::get_groups,
            modules::emoji::commands::import_emoji_files,
            modules::emoji::commands::add_emoji_from_clipboard,
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
            modules::emoji::commands::save_emoji_settings,
        ])
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == MAIN_WINDOW_LABEL {
                        let _ = window.hide();
                        api.prevent_close();
                    }
                }
                WindowEvent::Focused(false) => {
                    let label = window.label().to_string();
                    if label == modules::clipboard::POPUP_WINDOW_LABEL
                        || label == modules::search::POPUP_WINDOW_LABEL
                        || label == modules::emoji::POPUP_WINDOW_LABEL
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