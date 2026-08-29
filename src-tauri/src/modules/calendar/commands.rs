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

fn to_event_dto(e: &Event) -> EventDto {
    EventDto {
        id: e.id,
        title: e.title.clone(),
        location: e.location.clone(),
        notes: e.notes.clone(),
        all_day: e.all_day,
        start_ms: e.start_ms,
        end_ms: e.end_ms,
        rrule: e.rrule.clone(),
    }
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

/// 一次性拉取一个窗口内的事件（重复规则事件本体；实例展开在批次 3 上线前按单次展示）
/// 与全部待办。前端缓存到内存，增删改后局部刷新。
#[tauri::command]
pub fn calendar_get_range(
    db: State<'_, Mutex<CalendarDb>>,
    start_ms: i64,
    end_ms: i64,
) -> Result<RangePayload, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let events = db
        .events_in_window(start_ms, end_ms)?
        .iter()
        .map(to_event_dto)
        .collect();
    let todos = db.all_todos()?.iter().map(to_todo_dto).collect();
    Ok(RangePayload { events, todos })
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