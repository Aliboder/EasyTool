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
    // 启动按分类指纹判断：规则/内置关键词没变则跳过全量重分类；
    // 变更时重新应用（幂等、只改 category_locked=0 的自动分类项）
    match db.reapply_categories_if_changed() {
        Ok(true) => log::info!("timetracker: rules changed, re-applied categories"),
        Ok(false) => {}
        Err(e) => log::error!("timetracker: apply categories on startup failed: {e}"),
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
    crate::ensure_popup_window(
        app,
        POPUP_WINDOW_LABEL,
        "timetracker_window.html",
        (800.0, 600.0),
        "timetracker",
    )
}

/// 全局热键触发：显示弹窗
pub fn on_hotkey(app: &tauri::AppHandle) {
    let Some(win) = ensure_popup_window(app) else {
        return;
    };
    let _ = win.show();
    let _ = win.set_focus();
}
