mod config;
mod modules;

use config::ConfigState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const MAIN_WINDOW_LABEL: &str = "main";

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
                    let key = shortcut.to_string();
                    let Some(cfg) = app.try_state::<ConfigState>() else {
                        return;
                    };
                    let (clip_enabled, clip_hotkey, main_hotkey) = {
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
                        (clip_enabled, clip_hotkey, main_hotkey)
                    };
                    if clip_enabled && key == clip_hotkey {
                        modules::clipboard::on_hotkey(app);
                    } else if key == main_hotkey {
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
            }

            // 全局热键
            {
                let (clip_hotkey, main_hotkey) = {
                    let state = app.state::<ConfigState>();
                    let cfg = state.0.lock().unwrap();
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
                    (clip_hotkey, main_hotkey)
                };
                if clipboard_enabled(app.handle()) {
                    let _ = app.global_shortcut().register(clip_hotkey.as_str());
                }
                let _ = app.global_shortcut().register(main_hotkey.as_str());
            }

            build_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::set_module_enabled,
            config::set_theme,
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
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN_WINDOW_LABEL {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}