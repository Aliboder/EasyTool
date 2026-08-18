mod config;
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
    TrayIconBuilder::new()
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

struct Hotkeys {
    unified: bool,
    clip_hotkey: String,
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
    Hotkeys {
        unified: cfg.unified_hotkey,
        clip_hotkey,
        main_hotkey: cfg
            .hotkeys
            .get("main")
            .cloned()
            .unwrap_or_else(|| "Ctrl+Shift+E".into()),
    }
}

/// 按统一呼出模式重新注册全局热键：
/// - unified=true：只注册主窗口热键，模块独立热键全部禁用
/// - unified=false：主窗口热键 + 各模块热键共存
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
        match app.global_shortcut().register(hk.main_hotkey.as_str()) {
            Ok(_) => log::info!("main hotkey registered: {}", hk.main_hotkey),
            Err(e) => log::error!("failed to register main hotkey: {e}"),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logger();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
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
                    let (unified, clip_enabled, clip_hotkey, main_hotkey) = {
                        let cfg = cfg.0.lock().unwrap();
                        let clip_hotkey = cfg
                            .modules
                            .get("clipboard")
                            .and_then(|m| m.get("hotkey"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Ctrl+Shift+V")
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
                        (cfg.unified_hotkey, clip_enabled, clip_hotkey, main_hotkey)
                    };
                    let clip_match = Shortcut::from_str(&clip_hotkey)
                        .map(|s| s == *shortcut)
                        .unwrap_or(false);
                    let main_match = Shortcut::from_str(&main_hotkey)
                        .map(|s| s == *shortcut)
                        .unwrap_or(false);
                    if !unified && clip_enabled && clip_match {
                        log::info!("clipboard hotkey matched, showing popup");
                        modules::clipboard::on_hotkey(app);
                    } else if main_match {
                        // 主窗口呼出：先记录唤起前窗口，供剪贴板跟手粘贴
                        if clipboard_enabled(app) {
                            modules::clipboard::record_foreground_state(app);
                        }
                        show_main(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let mut cfg = config::load_config(app.handle());
            let manifests = modules::load_manifests(app.handle());
            modules::merge_manifests(&mut cfg, &manifests);
            let _ = config::save_config(app.handle(), &cfg);
            app.manage(ConfigState(std::sync::Mutex::new(cfg)));

            // 剪贴板模块
            if clipboard_enabled(app.handle()) {
                modules::clipboard::setup(app)?;
                let popup = tauri::WebviewWindowBuilder::new(
                    app,
                    modules::clipboard::POPUP_WINDOW_LABEL,
                    tauri::WebviewUrl::App("clipboard_popup.html".into()),
                )
                .decorations(false)
                .skip_taskbar(true)
                .inner_size(620.0, 480.0)
                .always_on_top(true)
                .build()?;
                popup.hide()?;
            }

            // 全局热键（按统一呼出模式注册）
            reapply_hotkeys(app.handle());

            build_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::set_module_enabled,
            config::set_theme,
            config::set_unified_hotkey,
            modules::get_manifests,
            modules::clipboard::commands::get_history,
            modules::clipboard::commands::pin_item,
            modules::clipboard::commands::delete_item,
            modules::clipboard::commands::clear_history,
            modules::clipboard::commands::clear_all_history,
            modules::clipboard::commands::paste_item,
            modules::clipboard::commands::copy_item,
            modules::clipboard::commands::open_file_location,
            modules::clipboard::commands::open_file,
            modules::clipboard::commands::set_max_items,
            modules::clipboard::commands::set_hotkey,
            modules::clipboard::commands::get_data_dir,
            modules::clipboard::commands::open_data_dir,
            modules::clipboard::commands::get_stats,
            modules::clipboard::commands::get_thumb,
            modules::clipboard::commands::get_image,
            modules::clipboard::commands::get_file_icon,
            modules::clipboard::commands::get_file_thumb,
            modules::clipboard::commands::get_file_preview,
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
                    if window.label() == modules::clipboard::POPUP_WINDOW_LABEL {
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}