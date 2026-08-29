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
            for inst in super::expand::expand(start_dt, rule) {
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
            });
        }
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
        "delete" => db.upsert_override(event_id, instance_date, "delete", &None),
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
) -> Result<(), String> {
    validate_event(&input)?;
    let db = db.lock().map_err(|e| e.to_string())?;
    let mut e = db.get_event(id)?.ok_or("事件不存在")?;
    e.title = input.title.trim().into();
    e.location = input.location;
    e.notes = input.notes;
    e.all_day = input.all_day;
    e.start_ms = input.start_ms;
    e.end_ms = input.end_ms;
    e.rrule = input.rrule.filter(|s| !s.trim().is_empty());
    e.updated_ms = now_ms();
    db.update_event(&e)
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

/// 导入 ICS 日程文件：读取 → 解析 → 物化展开 → 写入；返回统计
#[tauri::command]
pub fn calendar_import_ics(
    db: State<'_, Mutex<CalendarDb>>,
    path: String,
) -> Result<super::ics::ImportReport, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))?;
    let db = db.lock().map_err(|e| e.to_string())?;
    super::ics::import_ics_text(&db, &text)
}