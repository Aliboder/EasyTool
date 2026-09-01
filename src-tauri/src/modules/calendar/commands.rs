//! 日程表命令层：前端 invoke 的入口。
//! 前端传参一律 camelCase（serde rename）；纯配置读写走 useModuleConfig。

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

use super::db::{now_ms, CalendarDb, Event, Todo};

// ---------- DTO ----------

#[derive(Debug, Serialize)]
pub struct EventDto {
    pub id: i64,
    pub title: String,
    pub location: String,
    pub notes: String,
    pub all_day: bool,
    pub start_ms: i64,
    pub end_ms: i64,
    pub rrule: Option<String>,
    /// 该条数据是哪一天的实例（重复事件展开后为实例日期；单次事件为 None）
    pub instance_date: Option<i64>,
    /// 订阅来源（订阅日历事件为 Some(订阅 id)，只读；本地事件为 None）
    pub subscription_id: Option<i64>,
    /// 导入源 id（.ics 导入的事件；手建为 None）
    pub ics_import_id: Option<i64>,
    /// 单条提醒提前量（分钟；NULL=跟随全局）
    pub remind_minutes: Option<i64>,
    /// 事件颜色（hex；NULL=默认色）
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TodoDto {
    pub id: i64,
    pub title: String,
    pub notes: String,
    pub due_date: Option<i64>,
    pub done: bool,
    pub done_at_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct RangePayload {
    pub events: Vec<EventDto>,
    pub todos: Vec<TodoDto>,
}

#[derive(Debug, Deserialize)]
pub struct EventInput {
    pub title: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub all_day: bool,
    pub start_ms: i64,
    pub end_ms: i64,
    #[serde(default)]
    pub rrule: Option<String>,
    /// 单条提醒提前量（分钟；None=跟随全局）。0 = 准时
    #[serde(default)]
    pub remind_minutes: Option<i64>,
    /// 事件颜色（hex；None=默认色）
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TodoInput {
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub due_date: Option<i64>,
}

fn to_todo_dto(t: &Todo) -> TodoDto {
    TodoDto {
        id: t.id,
        title: t.title.clone(),
        notes: t.notes.clone(),
        due_date: t.due_date,
        done: t.done,
        done_at_ms: t.done_at_ms,
    }
}

// ---------- 命令 ----------

/// 一次性拉取窗口内的事件（重复规则当场展开为实例、套用「仅此一次」例外）
/// 与全部待办。
#[tauri::command]
pub fn calendar_get_range(
    db: State<'_, Mutex<CalendarDb>>,
    start_ms: i64,
    end_ms: i64,
) -> Result<RangePayload, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let events = db.events_in_window(start_ms, end_ms)?;
    let mut out: Vec<EventDto> = Vec::new();
    for e in &events {
        if let Some(rule) = &e.rrule {
            let start_dt = super::expand::ts_to_local(e.start_ms);
            let dur = (e.end_ms - e.start_ms).max(0);
            let ovs = db.overrides_for(e.id)?;
            for inst in super::expand::expand_in(start_dt, rule, start_ms, end_ms) {
                let day_key = super::expand::local_day_key(inst);
                let (title, location, notes, all_day, i_start, i_end) =
                    if let Some(ov) = ovs.iter().find(|o| o.instance_date == day_key) {
                        if ov.variant == "delete" {
                            continue;
                        }
                        let s = ov.start_ms.unwrap_or_else(|| super::expand::local_to_ts(inst));
                        (
                            ov.title.clone().unwrap_or_else(|| e.title.clone()),
                            ov.location.clone().unwrap_or_else(|| e.location.clone()),
                            ov.notes.clone().unwrap_or_else(|| e.notes.clone()),
                            ov.all_day.unwrap_or(e.all_day),
                            s,
                            ov.end_ms.unwrap_or(s + dur),
                        )
                    } else {
                        let s = super::expand::local_to_ts(inst);
                        (
                            e.title.clone(),
                            e.location.clone(),
                            e.notes.clone(),
                            e.all_day,
                            s,
                            s + dur,
                        )
                    };
                if i_end < start_ms || i_start > end_ms {
                    continue;
                }
                out.push(EventDto {
                    id: e.id,
                    title,
                    location,
                    notes,
                    all_day,
                    start_ms: i_start,
                    end_ms: i_end,
                    rrule: Some(rule.clone()),
                    instance_date: Some(day_key),
                    subscription_id: None,
                    ics_import_id: e.ics_import_id,
                    remind_minutes: e.remind_minutes,
                    color: e.color.clone(),
                });
            }
        } else if e.end_ms >= start_ms && e.start_ms <= end_ms {
            out.push(EventDto {
                id: e.id,
                title: e.title.clone(),
                location: e.location.clone(),
                notes: e.notes.clone(),
                all_day: e.all_day,
                start_ms: e.start_ms,
                end_ms: e.end_ms,
                rrule: None,
                instance_date: None,
                subscription_id: None,
                ics_import_id: e.ics_import_id,
                remind_minutes: e.remind_minutes,
                color: e.color.clone(),
            });
        }
    }
    // 订阅日历（只读层）混排：id 用独立命名空间避免与本地事件冲突
    for f in db.feed_events_in_window(start_ms, end_ms)? {
        out.push(EventDto {
            id: 1_000_000_000 + f.id,
            title: f.title,
            location: f.location,
            notes: f.notes,
            all_day: f.all_day,
            start_ms: f.start_ms,
            end_ms: f.end_ms,
            rrule: None,
            instance_date: None,
            subscription_id: Some(f.subscription_id),
            ics_import_id: None,
            remind_minutes: None,
            color: None,
        });
    }
    out.sort_by_key(|d| d.start_ms);
    let todos = db.all_todos()?.iter().map(to_todo_dto).collect();
    Ok(RangePayload { events: out, todos })
}

/// 「仅此一次」例外：variant=delete 删该实例；variant=edit 覆盖该实例字段（其余次不受影响）
#[derive(Debug, Deserialize)]
pub struct OverrideInput {
    pub variant: String, // "edit" | "delete"
    #[serde(default)]
    pub input: Option<EventInput>,
}

#[tauri::command]
pub fn calendar_override_event(
    db: State<'_, Mutex<CalendarDb>>,
    event_id: i64,
    instance_date: i64,
    input: OverrideInput,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let base = db.get_event(event_id)?.ok_or("事件不存在")?;
    match input.variant.as_str() {
        "delete" => {
            // 记录该实例的原始时刻（ICS EXDATE 导出需要）
            let rule = base.rrule.clone();
            let original_start = match rule.as_deref() {
                Some(r) => super::expand::expand(super::expand::ts_to_local(base.start_ms), r)
                    .into_iter()
                    .find(|i| super::expand::local_day_key(*i) == instance_date)
                    .map(super::expand::local_to_ts)
                    .unwrap_or(0),
                None => 0,
            };
            db.insert_delete_override(event_id, instance_date, original_start)
        }
        "edit" => {
            let v = input.input.ok_or("缺少编辑内容")?;
            validate_event(&v)?;
            let e = Event {
                id: 0,
                title: v.title.trim().into(),
                location: v.location,
                notes: v.notes,
                all_day: v.all_day,
                start_ms: v.start_ms,
                end_ms: v.end_ms,
                rrule: None,
                remind_minutes: None,
                ics_import_id: None,
                color: None,
                created_ms: base.created_ms,
                updated_ms: now_ms(),
            };
            db.upsert_override(event_id, instance_date, "edit", &Some(e))
        }
        _ => Err("未知操作".into()),
    }
}

fn validate_event(input: &EventInput) -> Result<(), String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("标题不能为空".into());
    }
    if input.end_ms < input.start_ms {
        return Err("结束时间不能早于开始时间".into());
    }
    Ok(())
}

#[tauri::command]
pub fn calendar_create_event(
    db: State<'_, Mutex<CalendarDb>>,
    input: EventInput,
) -> Result<i64, String> {
    validate_event(&input)?;
    let now = now_ms();
    let e = Event {
        id: 0,
        title: input.title.trim().into(),
        location: input.location,
        notes: input.notes,
        all_day: input.all_day,
        start_ms: input.start_ms,
        end_ms: input.end_ms,
        rrule: input.rrule.filter(|s| !s.trim().is_empty()),
        remind_minutes: input.remind_minutes.map(|m| m.clamp(0, 4320)),
        color: input.color.filter(|c| !c.trim().is_empty()),
        ics_import_id: None,
        created_ms: now,
        updated_ms: now,
    };
    let db = db.lock().map_err(|e| e.to_string())?;
    db.insert_event(&e)
}

#[tauri::command]
pub fn calendar_update_event(
    db: State<'_, Mutex<CalendarDb>>,
    id: i64,
    input: EventInput,
    sync_same_name: bool,
) -> Result<usize, String> {
    validate_event(&input)?;
    let db = db.lock().map_err(|e| e.to_string())?;
    let mut e = db.get_event(id)?.ok_or("事件不存在")?;
    let old_title = e.title.clone();
    let new_title = input.title.trim().to_string();
    let new_color = input.color.filter(|c| !c.trim().is_empty());
    e.title = new_title.clone();
    e.location = input.location;
    e.notes = input.notes;
    e.all_day = input.all_day;
    e.start_ms = input.start_ms;
    e.end_ms = input.end_ms;
    e.rrule = input.rrule.filter(|s| !s.trim().is_empty());
    e.remind_minutes = input.remind_minutes.map(|m| m.clamp(0, 4320));
    e.color = new_color.clone();
    e.updated_ms = now_ms();
    db.update_event(&e)?;
    // 同名课程同步：只同步标题与颜色，不动时间/地点/规则（改名/换色一次全改）
    let mut synced = 0usize;
    if sync_same_name {
        let peers = db.events_with_title_excluding(&old_title, id)?;
        for mut p in peers {
            p.title = new_title.clone();
            p.color = new_color.clone();
            p.updated_ms = now_ms();
            db.update_event(&p)?;
            synced += 1;
        }
    }
    Ok(synced)
}

#[tauri::command]
pub fn calendar_delete_event(db: State<'_, Mutex<CalendarDb>>, id: i64) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    db.delete_event(id)
}

#[tauri::command]
pub fn calendar_create_todo(
    db: State<'_, Mutex<CalendarDb>>,
    input: TodoInput,
) -> Result<i64, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("标题不能为空".into());
    }
    let now = now_ms();
    let t = Todo {
        id: 0,
        title: title.into(),
        notes: input.notes,
        due_date: input.due_date,
        done: false,
        done_at_ms: None,
        created_ms: now,
        updated_ms: now,
    };
    let db = db.lock().map_err(|e| e.to_string())?;
    db.insert_todo(&t)
}

#[tauri::command]
pub fn calendar_update_todo(
    db: State<'_, Mutex<CalendarDb>>,
    id: i64,
    input: TodoInput,
) -> Result<(), String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("标题不能为空".into());
    }
    let db = db.lock().map_err(|e| e.to_string())?;
    let mut t = db.all_todos()?.into_iter().find(|t| t.id == id).ok_or("待办不存在")?;
    t.title = title.into();
    t.notes = input.notes;
    t.due_date = input.due_date;
    t.updated_ms = now_ms();
    db.update_todo(&t)
}

#[tauri::command]
pub fn calendar_toggle_todo(db: State<'_, Mutex<CalendarDb>>, id: i64, done: bool) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    db.toggle_todo(id, done)
}

#[tauri::command]
pub fn calendar_delete_todo(db: State<'_, Mutex<CalendarDb>>, id: i64) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    db.delete_todo(id)
}

/// 导入 ICS 日程文件：读取 → 解析 → 物化展开 → 写入；按文件名建立导入源（同名=覆盖更新）
#[tauri::command]
pub fn calendar_import_ics(
    db: State<'_, Mutex<CalendarDb>>,
    path: String,
) -> Result<super::ics::ImportReport, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))?;
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "导入文件".into());
    let db = db.lock().map_err(|e| e.to_string())?;
    let parsed = super::ics::parse_ics(&text);
    let import_id = db.replace_ics_import(&name, parsed.items.len())?;
    db.insert_imported(&parsed.items, Some(import_id))?;
    Ok(super::ics::ImportReport {
        events: parsed.events,
        instances: parsed.items.len(),
        expanded: parsed.expanded,
        repeated: parsed.repeated,
        skipped: parsed.skipped,
        unsupported: parsed.unsupported,
    })
}

/// 导入源清单（设置页管理用）
#[derive(Debug, serde::Serialize)]
pub struct IcsImportInfo {
    pub id: i64,
    pub name: String,
    pub imported_at: i64,
    pub count: i64,
}

#[tauri::command]
pub fn calendar_list_ics_imports(
    db: State<'_, Mutex<CalendarDb>>,
) -> Result<Vec<IcsImportInfo>, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    Ok(db
        .list_ics_imports()?
        .into_iter()
        .map(|(id, name, imported_at, count)| IcsImportInfo {
            id,
            name,
            imported_at,
            count,
        })
        .collect())
}

/// 删除整份导入源：该 ICS 导入的全部事件一并清除（其它来源与手建数据不受影响）
#[tauri::command]
pub fn calendar_delete_ics_import(db: State<'_, Mutex<CalendarDb>>, id: i64) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    db.delete_ics_import(id).map(|_| ())
}

// ---------- 数据管理 ----------

#[derive(Debug, serde::Serialize)]
pub struct CalendarStats {
    pub events: i64,
    pub recurring: i64,
    pub todos: i64,
    pub todos_pending: i64,
    pub imports: i64,
}

#[tauri::command]
pub fn calendar_stats(db: State<'_, Mutex<CalendarDb>>) -> Result<CalendarStats, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let (events, recurring, todos, todos_pending, imports) = db.stats()?;
    Ok(CalendarStats {
        events,
        recurring,
        todos,
        todos_pending,
        imports,
    })
}

/// 删除某时刻之前的单次事件（重复规则保留）
#[tauri::command]
pub fn calendar_purge_before(db: State<'_, Mutex<CalendarDb>>, before_ms: i64) -> Result<u32, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    db.purge_single_before(before_ms)
}

/// 清待办：only_done=true 只清已完成的；false 全清
#[tauri::command]
pub fn calendar_clear_todos(db: State<'_, Mutex<CalendarDb>>, only_done: bool) -> Result<u32, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    db.clear_todos(only_done)
}

/// 清空全部数据
#[tauri::command]
pub fn calendar_clear_all(db: State<'_, Mutex<CalendarDb>>) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    db.clear_all()
}

/// 全部事件（数据管理的精细列表用；含重复标记）
#[tauri::command]
pub fn calendar_list_all_events(db: State<'_, Mutex<CalendarDb>>) -> Result<Vec<EventDto>, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    Ok(db
        .all_events()?
        .into_iter()
        .map(|e| EventDto {
            id: e.id,
            title: e.title,
            location: e.location,
            notes: e.notes,
            all_day: e.all_day,
            start_ms: e.start_ms,
            end_ms: e.end_ms,
            rrule: e.rrule,
            instance_date: None,
            subscription_id: None,
            ics_import_id: e.ics_import_id,
            remind_minutes: e.remind_minutes,
            color: e.color,
        })
        .collect())
}

/// 批量删除事件（ids）
#[tauri::command]
pub fn calendar_delete_events(db: State<'_, Mutex<CalendarDb>>, ids: Vec<i64>) -> Result<u32, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    db.delete_events_batch(&ids)
}

// ---------- 订阅日历（只读外部日历源） ----------

#[derive(Debug, Serialize)]
pub struct SubscriptionInfo {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub color: String,
    pub enabled: bool,
    pub refresh_minutes: i64,
    pub last_sync_ms: Option<i64>,
    pub event_count: i64,
}

#[tauri::command]
pub fn calendar_add_subscription(
    db: State<'_, Mutex<CalendarDb>>,
    name: String,
    url: String,
    color: String,
    refresh_minutes: i64,
) -> Result<i64, String> {
    let name = name.trim();
    let url = url.trim();
    if name.is_empty() || name.len() > 60 {
        return Err("订阅名称需 1-60 字".into());
    }
    if url.is_empty()
        || !(url.starts_with("http://")
            || url.starts_with("https://")
            || url.starts_with("webcal://"))
    {
        return Err("订阅地址需要以 http(s):// 或 webcal:// 开头".into());
    }
    let color = if color.is_empty() { "#3b82f6" } else { &color };
    let db = db.lock().map_err(|e| e.to_string())?;
    db.add_subscription(name, url, color, refresh_minutes.clamp(0, 10080))
}

#[tauri::command]
pub fn calendar_update_subscription(
    db: State<'_, Mutex<CalendarDb>>,
    id: i64,
    name: String,
    color: String,
    enabled: bool,
    refresh_minutes: i64,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 60 {
        return Err("订阅名称需 1-60 字".into());
    }
    let db = db.lock().map_err(|e| e.to_string())?;
    db.update_subscription(id, name, &color, enabled, refresh_minutes.clamp(0, 10080))
}

#[tauri::command]
pub fn calendar_delete_subscription(db: State<'_, Mutex<CalendarDb>>, id: i64) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    db.delete_subscription(id)
}

#[tauri::command]
pub fn calendar_list_subscriptions(
    db: State<'_, Mutex<CalendarDb>>,
) -> Result<Vec<SubscriptionInfo>, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    Ok(db
        .list_subscriptions()?
        .into_iter()
        .map(
            |(id, name, url, color, enabled, refresh_minutes, last_sync_ms, event_count)| {
                SubscriptionInfo {
                    id,
                    name,
                    url,
                    color,
                    enabled,
                    refresh_minutes,
                    last_sync_ms,
                    event_count,
                }
            },
        )
        .collect())
}

/// 立即刷新某个订阅（后台线程抓取：先取 url，抓取完成后再加锁写回，避免网络阻塞 UI）
#[tauri::command]
pub async fn calendar_refresh_subscription(app: tauri::AppHandle, id: i64) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let url = {
            let db_guard = app.state::<Mutex<CalendarDb>>();
            let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            db.list_subscriptions()?
                .into_iter()
                .find(|s| s.0 == id)
                .map(|s| s.2)
                .ok_or("订阅不存在")?
        };
        // 网络抓取不持锁（最长 20s）
        let parsed = super::ics::fetch_feed(&url)?;
        let count = parsed.items.len();
        // 抓取成功但 0 条事件不写入（避免合法的空日历响应清空已缓存数据）
        if count == 0 {
            return Ok(0);
        }
        {
            let db_guard = app.state::<Mutex<CalendarDb>>();
            let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            db.replace_feed(id, &parsed.items)?;
        }
        Ok(count as i64)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 导出 ICS 到指定路径
#[tauri::command]
pub fn calendar_export_ics(db: State<'_, Mutex<CalendarDb>>, path: String) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let text = super::ics::export_ics_text(&db);
    std::fs::write(&path, text).map_err(|e| format!("写入失败: {e}"))
}

/// 导出 JSON 全量备份
#[tauri::command]
pub fn calendar_export_json(db: State<'_, Mutex<CalendarDb>>, path: String) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let text = super::ics::export_json_text(&db);
    std::fs::write(&path, text).map_err(|e| format!("写入失败: {e}"))
}

/// 导入 JSON 备份（去重合并）
#[tauri::command]
pub fn calendar_import_json(
    db: State<'_, Mutex<CalendarDb>>,
    path: String,
) -> Result<super::ics::JsonImportReport, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))?;
    let db = db.lock().map_err(|e| e.to_string())?;
    super::ics::import_json_text(&db, &text)
}