pub mod commands;
pub mod collector;
pub mod db;
pub mod models;

use std::sync::Mutex;
use tauri::Manager;

pub const POPUP_WINDOW_LABEL: &str = "timetracker_window";

pub struct TimetrackerState {
    pub db: db::TimetrackerDb,
}

/// 从 AppHandle 初始化（用于并行初始化）
pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;

    let db_path = data_dir.join("timetracker.db");
    // 开库失败隔离重建（与 clipboard 模块同策略），避免损坏库阻塞整个应用启动
    let db = match db::TimetrackerDb::open(&db_path) {
        Ok(db) => db,
        Err(e) => {
            log::error!("timetracker db init failed ({e}), quarantining broken db");
            crate::quarantine_broken_db(&db_path);
            db::TimetrackerDb::open(&db_path)
                .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?
        }
    };
    // 启动即按当前规则重分类既有应用：幂等、只改 category_locked=0 的自动分类项，
    // 内置关键词变更（如分类体系调整）无需用户手动点「重新分类」即可生效
    if let Err(e) = db.reapply_categories() {
        log::error!("timetracker: apply categories on startup failed: {e}");
    }
    app.manage(Mutex::new(TimetrackerState { db }));

    // 应用配置（AFK 阈值等）+ 启动数据采集器（前台钩子 + 心跳线程）
    collector::apply_config(app);
    let handle = app.clone();
    std::thread::spawn(move || collector::start(handle));

    log::info!("timetracker module ready");
    Ok(())
}

/// 确保弹窗窗口存在（延迟创建）
fn ensure_popup_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window(POPUP_WINDOW_LABEL) {
        return Some(win);
    }
    let win = tauri::WebviewWindowBuilder::new(
        app,
        POPUP_WINDOW_LABEL,
        tauri::WebviewUrl::App("timetracker_window.html".into()),
    )
    .decorations(false)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(800.0, 600.0)
    .min_inner_size(400.0, 300.0)
    .resizable(true)
    .always_on_top(true)
    .build();
    match win {
        Ok(win) => {
            // 应用记住的弹窗尺寸（前端 usePopupGeometry 防抖写回 popup_size 键）
            let saved_size = app
                .state::<crate::config::ConfigState>()
                .0
                .lock()
                .unwrap()
                .modules
                .get("timetracker")
                .and_then(|m| m.get("popup_size"))
                .cloned();
            if let Some(size) = saved_size {
                if let (Some(w), Some(h)) = (
                    size.get("w").and_then(|v| v.as_u64()),
                    size.get("h").and_then(|v| v.as_u64()),
                ) {
                    // 过滤脏数据：隐藏/最小化时会存到 0x0 极小值
                    if w >= 400 && h >= 300 {
                        let _ = win.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
                    }
                }
            }
            Some(win)
        }
        Err(e) => {
            log::error!("failed to create timetracker popup window: {e}");
            None
        }
    }
}

/// 全局热键触发：显示弹窗
pub fn on_hotkey(app: &tauri::AppHandle) {
    let Some(win) = ensure_popup_window(app) else {
        return;
    };
    let _ = win.show();
    let _ = win.set_focus();
}
