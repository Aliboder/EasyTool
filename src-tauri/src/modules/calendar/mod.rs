//! 日程表模块：事件 + 待办合一的本地日历（设计文档 docs/superpowers/specs/2026-08-29-calendar-design.md）。

pub mod commands;
pub mod db;
pub mod expand;
pub mod ics;

use std::sync::Mutex;
use tauri::Manager;

use db::CalendarDb;

/// 打开并托管 CalendarDb（幂等：重复调用直接跳过管理）
pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    if app.try_state::<Mutex<CalendarDb>>().is_some() {
        return Ok(());
    }
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db = CalendarDb::open(&data_dir.join("calendar.db"))
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    app.manage(Mutex::new(db));
    log::info!("calendar module ready");
    Ok(())
}