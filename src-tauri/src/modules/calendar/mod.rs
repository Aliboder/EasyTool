//! 日程表模块：事件 + 待办合一的本地日历（设计文档 docs/superpowers/specs/2026-08-29-calendar-design.md）。

pub mod commands;
pub mod db;
pub mod expand;
pub mod ics;

use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

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
    // 常驻提醒线程（事件提前提醒 + 待办过期提醒；30 秒一跳，含睡眠补扫）
    let handle = app.clone();
    std::thread::spawn(move || reminder_loop(handle));
    log::info!("calendar module ready");
    Ok(())
}

/// 发送系统通知（复用壳层通知插件）
fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

/// 提醒主循环：与 quota poll_loop 同模式。
/// - 事件：扫 [now-1h, now+提前量] 内的实例（重复现场展开），每条只提醒一次
/// - 待办：截止日 <= 今天且未完成 && 当日未提醒 → 提醒一次
/// 提前量为 0 = 准时提醒；睡眠醒来后自动补扫（过去 1 小时内的实例/今日过期待办）。
fn reminder_loop(app: AppHandle) {
    loop {
        let cfg = crate::config::module_cfg(&app, "calendar");
        let module_enabled = cfg.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
        if !module_enabled {
            std::thread::sleep(Duration::from_secs(5));
            continue;
        }
        let remind_enabled = cfg
            .get("reminder_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let minutes = cfg
            .get("event_remind_minutes")
            .and_then(|v| v.as_f64())
            .unwrap_or(10.0)
            .clamp(0.0, 60.0) as i64;
        let overdue_enabled = cfg
            .get("todo_overdue_remind")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let now = db::now_ms();
        let lead = minutes * 60_000;
        // 睡眠补扫窗口：过去 1 小时（错过的事件仍补一条）→ 未来提前量
        let window_start = now - 3_600_000;
        let window_end = now + lead.max(60_000);

        let mut alerts: Vec<(String, String)> = Vec::new();
        {
            let db_guard = app.state::<Mutex<CalendarDb>>();
            let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);

            if remind_enabled {
                if let Ok(events) = db.events_in_window(window_start, window_end) {
                    for e in &events {
                        if let Some(rule) = &e.rrule {
                            // 重复事件：现场展开实例，落在窗口内的才提醒
                            let start_dt = expand::ts_to_local(e.start_ms);
                            for inst in expand::expand(start_dt, rule) {
                                let s = expand::local_to_ts(inst);
                                if s < window_start || s > window_end {
                                    continue;
                                }
                                let day_key = expand::local_day_key(inst);
                                if db.reminder_sent("event", e.id, Some(day_key)).unwrap_or(true) {
                                    continue;
                                }
                                let _ = db.log_reminder("event", e.id, Some(day_key));
                                let body = if s <= now {
                                    format!("事件已开始：{}", e.title)
                                } else {
                                    format!(
                                        "{} 分钟后开始：{}",
                                        ((s - now) / 60_000).max(1),
                                        e.title
                                    )
                                };
                                alerts.push(("⏰ 日程提醒".into(), body));
                            }
                        } else {
                            let s = e.start_ms;
                            if s < window_start || s > window_end {
                                continue;
                            }
                            let day_key = expand::local_day_key(expand::ts_to_local(s));
                            if db.reminder_sent("event", e.id, Some(day_key)).unwrap_or(true) {
                                continue;
                            }
                            let _ = db.log_reminder("event", e.id, Some(day_key));
                            let body = if s <= now {
                                format!("事件已开始：{}", e.title)
                            } else {
                                format!(
                                    "{} 分钟后开始：{}",
                                    ((s - now) / 60_000).max(1),
                                    e.title
                                )
                            };
                            alerts.push(("⏰ 日程提醒".into(), body));
                        }
                    }
                }
            }

            if overdue_enabled {
                let today = expand::local_day_key(expand::ts_to_local(now));
                if let Ok(todos) = db.todos_pending_due(today) {
                    for t in &todos {
                        if db.reminder_sent("todo", t.id, Some(today)).unwrap_or(true) {
                            continue;
                        }
                        let _ = db.log_reminder("todo", t.id, Some(today));
                        alerts.push(("📌 待办提醒".into(), format!("今日待办未完成：{}", t.title)));
                    }
                }
            }
        }
        for (title, body) in &alerts {
            notify(&app, title, body);
            log::info!("reminder: {title} - {body}");
        }
        drop(alerts);

        std::thread::sleep(Duration::from_secs(30));
    }
}