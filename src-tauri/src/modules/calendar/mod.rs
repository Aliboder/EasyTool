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
    // 订阅日历刷新线程（每 5 分钟检查一次到期订阅）
    let handle2 = app.clone();
    std::thread::spawn(move || subscription_loop(handle2));
    log::info!("calendar module ready");
    Ok(())
}

/// 订阅日历刷新循环：按期（每 5 分钟）检查各订阅是否到期，到期则抓取并整份替换。
/// 失败保留旧数据（只记日志）；webcal:// 由 fetch_feed 归一化为 https。
fn subscription_loop(app: AppHandle) {
    loop {
        let cfg = crate::config::module_cfg(&app, "calendar");
        let module_enabled = cfg.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
        if !module_enabled {
            std::thread::sleep(Duration::from_secs(5));
            continue;
        }
        let now = db::now_ms();
        let due = {
            let db_guard = app.state::<Mutex<CalendarDb>>();
            let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            db.due_subscriptions(now).unwrap_or_default()
        };
        for (id, url) in due {
            match ics::fetch_feed(&url) {
                Ok(parsed) => {
                    let db_guard = app.state::<Mutex<CalendarDb>>();
                    let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                    match db.replace_feed(id, &parsed.items) {
                        Ok(()) => log::info!("subscription {id} refreshed: {} items", parsed.items.len()),
                        Err(e) => log::warn!("subscription {id} store failed: {e}"),
                    }
                }
                Err(e) => log::warn!("subscription {id} fetch failed: {e}"),
            }
        }
        std::thread::sleep(Duration::from_secs(300));
    }
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
        // 睡眠补扫窗口：过去 1 小时（错过的事件仍补一条）→ 未来 24h（覆盖单条更大的提前量；
        // 实际提醒时刻按每条事件自身的提前量判定）
        let window_start = now - 3_600_000;
        let window_end = now + 24 * 3_600_000;

        let mut alerts: Vec<(String, String)> = Vec::new();
        {
            let db_guard = app.state::<Mutex<CalendarDb>>();
            let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);

            if remind_enabled {
                if let Ok(events) = db.events_in_window(window_start, window_end) {
                    for e in &events {
                        // 单条提前量优先（NULL=跟随全局）
                        let lead = e.remind_minutes.unwrap_or(minutes) * 60_000;
                        let max_start = now + lead;
                        if let Some(rule) = &e.rrule {
                            // 重复事件：现场展开实例，落在窗口内的才提醒
                            let start_dt = expand::ts_to_local(e.start_ms);
                            for inst in expand::expand(start_dt, rule) {
                                let s = expand::local_to_ts(inst);
                                if s < window_start || s > max_start {
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
                            if s < window_start || s > max_start {
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