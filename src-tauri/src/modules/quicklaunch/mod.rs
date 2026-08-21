pub mod commands;
pub mod db;
pub mod types;

use tauri::Manager;
use std::sync::Mutex;

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