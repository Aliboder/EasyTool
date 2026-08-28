//! 表情模块：内置 Emoji + 图片表情
pub mod commands;
pub mod data;
pub mod db;
pub mod paste;

use tauri::Manager;

pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    // 开库失败（典型：库损坏）→ 隔离损坏文件重建空库，模块降级为无自定义表情
    let db_path = data_dir.join("emojis.db");
    let db = match db::Db::open(&db_path) {
        Ok(db) => db,
        Err(e) => {
            log::error!("emoji db init failed ({e}), quarantining broken db and recreating");
            crate::quarantine_broken_db(&db_path);
            db::Db::open(&db_path).map_err(|e| tauri::Error::Io(std::io::Error::other(e.to_string())))?
        }
    };
    app.manage(db);
    // 预加载内置数据（模块资源目录）
    let dir = crate::modules::modules_dir(app);
    let _ = data::load(&dir);
    log::info!("emoji module ready");
    Ok(())
}
