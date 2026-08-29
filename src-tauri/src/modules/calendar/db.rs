//! 日程表 SQLite 存储：事件 / 重复例外 / 待办 / 提醒日志。
//! 时间口径：一律本地时间（chrono::Local 生成毫秒；全天事件按本地日 yyyymmdd）。
//! 连接用 Mutex 串行化（rusqlite::Connection 非 Sync），与其它模块同一模式。

use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub type DbResult<T> = Result<T, String>;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 本地日键（yyyyMMdd 整数，全天/重复实例/提醒去重共用）
#[allow(dead_code)] // 批次 3+（重复/提醒）上线时启用
pub fn local_day_key(ms: i64) -> i64 {
    use chrono::{Datelike, TimeZone};
    let dt = chrono::Local
        .timestamp_millis_opt(ms)
        .earliest()
        .unwrap_or_else(|| chrono::Local.timestamp_opt(0, 0).earliest().unwrap());
    let y = dt.year() as i64;
    let m = dt.month() as i64;
    let d = dt.day() as i64;
    y * 10000 + m * 100 + d
}

#[derive(Debug, Clone)]
pub struct Event {
    pub id: i64,
    pub title: String,
    pub location: String,
    pub notes: String,
    pub all_day: bool,
    pub start_ms: i64,
    pub end_ms: i64,
    pub rrule: Option<String>,
    pub created_ms: i64,
    pub updated_ms: i64,
}

#[derive(Debug, Clone)]
#[allow(dead_code)] // 字段在批次 3（重复+例外）上线时启用
pub struct EventOverride {
    pub id: i64,
    pub event_id: i64,
    pub instance_date: i64,
    pub variant: String, // "edit" | "delete"
    pub title: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub all_day: Option<bool>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct Todo {
    pub id: i64,
    pub title: String,
    pub notes: String,
    pub due_date: Option<i64>, // 本地日 yyyymmdd；NULL=长期待办
    pub done: bool,
    pub done_at_ms: Option<i64>,
    pub created_ms: i64,
    pub updated_ms: i64,
}

pub struct CalendarDb {
    pub conn: Connection,
}

impl CalendarDb {
    pub fn open(path: &Path) -> DbResult<Self> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let db = CalendarDb { conn };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> DbResult<()> {
        self.conn
            .execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    location TEXT NOT NULL DEFAULT '',
                    notes TEXT NOT NULL DEFAULT '',
                    all_day INTEGER NOT NULL DEFAULT 0,
                    start_ms INTEGER NOT NULL,
                    end_ms INTEGER NOT NULL,
                    rrule TEXT,
                    created_ms INTEGER NOT NULL,
                    updated_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_ms);

                CREATE TABLE IF NOT EXISTS event_overrides (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                    instance_date INTEGER NOT NULL,
                    variant TEXT NOT NULL CHECK (variant IN ('edit','delete')),
                    title TEXT, location TEXT, notes TEXT,
                    all_day INTEGER, start_ms INTEGER, end_ms INTEGER,
                    UNIQUE (event_id, instance_date)
                );
                CREATE INDEX IF NOT EXISTS idx_overrides_event ON event_overrides(event_id);

                CREATE TABLE IF NOT EXISTS todos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    due_date INTEGER,
                    done INTEGER NOT NULL DEFAULT 0,
                    done_at_ms INTEGER,
                    created_ms INTEGER NOT NULL,
                    updated_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(done, due_date);

                CREATE TABLE IF NOT EXISTS reminder_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kind TEXT NOT NULL CHECK (kind IN ('event','todo')),
                    ref_id INTEGER NOT NULL,
                    instance_date INTEGER,
                    sent_ms INTEGER NOT NULL,
                    UNIQUE (kind, ref_id, instance_date)
                );",
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ---------- 事件 ----------

    pub fn insert_event(&self, e: &Event) -> DbResult<i64> {
        self.conn
            .execute(
                "INSERT INTO events (title, location, notes, all_day, start_ms, end_ms, rrule, created_ms, updated_ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    e.title,
                    e.location,
                    e.notes,
                    e.all_day as i32,
                    e.start_ms,
                    e.end_ms,
                    e.rrule,
                    e.created_ms,
                    e.updated_ms
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_event(&self, e: &Event) -> DbResult<()> {
        self.conn
            .execute(
                "UPDATE events SET title=?1, location=?2, notes=?3, all_day=?4, start_ms=?5, end_ms=?6, rrule=?7, updated_ms=?8 WHERE id=?9",
                params![
                    e.title,
                    e.location,
                    e.notes,
                    e.all_day as i32,
                    e.start_ms,
                    e.end_ms,
                    e.rrule,
                    e.updated_ms,
                    e.id
                ],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn delete_event(&self, id: i64) -> DbResult<()> {
        self.conn
            .execute("DELETE FROM events WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// 窗口内的事件（含重复规则事件本体；实例展开在命令层完成）
    pub fn events_in_window(&self, start_ms: i64, end_ms: i64) -> DbResult<Vec<Event>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, location, notes, all_day, start_ms, end_ms, rrule, created_ms, updated_ms
                 FROM events WHERE (rrule IS NULL AND start_ms <= ?2 AND end_ms >= ?1)
                               OR (rrule IS NOT NULL AND start_ms <= ?2)
                 ORDER BY start_ms ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![start_ms, end_ms], row_to_event)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_event(&self, id: i64) -> DbResult<Option<Event>> {
        self.conn
            .query_row(
                "SELECT id, title, location, notes, all_day, start_ms, end_ms, rrule, created_ms, updated_ms
                 FROM events WHERE id = ?1",
                params![id],
                row_to_event,
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    #[allow(dead_code)] // 批次 3（重复+例外）上线时启用
    pub fn overrides_for(&self, event_id: i64) -> DbResult<Vec<EventOverride>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, event_id, instance_date, variant, title, location, notes, all_day, start_ms, end_ms
                 FROM event_overrides WHERE event_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![event_id], |r| {
                Ok(EventOverride {
                    id: r.get(0)?,
                    event_id: r.get(1)?,
                    instance_date: r.get(2)?,
                    variant: r.get(3)?,
                    title: r.get(4)?,
                    location: r.get(5)?,
                    notes: r.get(6)?,
                    all_day: r.get(7).map(|v: i32| v != 0).ok(),
                    start_ms: r.get(8)?,
                    end_ms: r.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// upsert 单次例外（批次 3 用；表已建好避免迁移）
    #[allow(dead_code)] // 批次 3（重复+例外）上线时启用
    pub fn upsert_override(
        &self,
        event_id: i64,
        instance_date: i64,
        variant: &str,
        o: &Option<Event>,
    ) -> DbResult<()> {
        // 先查已有行（不区分变体：edit/delete 都可能是对同一实例的第二次操作）
        let last_id: i64 = self
            .conn
            .query_row(
                "SELECT id FROM event_overrides WHERE event_id=?1 AND instance_date=?2",
                params![event_id, instance_date],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(0);
        let (title, location, notes, all_day, start_ms, end_ms) = match o {
            Some(e) => (
                Some(e.title.clone()),
                Some(e.location.clone()),
                Some(e.notes.clone()),
                Some(e.all_day as i32),
                Some(e.start_ms),
                Some(e.end_ms),
            ),
            None => (None, None, None, None, None, None),
        };
        if last_id > 0 {
            self.conn
                .execute(
                    "UPDATE event_overrides SET variant=?1, title=?2, location=?3, notes=?4, all_day=?5, start_ms=?6, end_ms=?7
                     WHERE id=?8",
                    params![variant, title, location, notes, all_day, start_ms, end_ms, last_id],
                )
                .map(|_| ())
                .map_err(|e| e.to_string())?;
        } else {
            self.conn
                .execute(
                    "INSERT INTO event_overrides (event_id, instance_date, variant, title, location, notes, all_day, start_ms, end_ms)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![
                        event_id,
                        instance_date,
                        variant,
                        title,
                        location,
                        notes,
                        all_day,
                        start_ms,
                        end_ms
                    ],
                )
                .map(|_| ())
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    // ---------- 待办 ----------

    pub fn insert_todo(&self, t: &Todo) -> DbResult<i64> {
        self.conn
            .execute(
                "INSERT INTO todos (title, notes, due_date, done, done_at_ms, created_ms, updated_ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    t.title,
                    t.notes,
                    t.due_date,
                    t.done as i32,
                    t.done_at_ms,
                    t.created_ms,
                    t.updated_ms
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_todo(&self, t: &Todo) -> DbResult<()> {
        self.conn
            .execute(
                "UPDATE todos SET title=?1, notes=?2, due_date=?3, done=?4, done_at_ms=?5, updated_ms=?6 WHERE id=?7",
                params![t.title, t.notes, t.due_date, t.done as i32, t.done_at_ms, t.updated_ms, t.id],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn toggle_todo(&self, id: i64, done: bool) -> DbResult<()> {
        let done_at = if done { Some(now_ms()) } else { None };
        self.conn
            .execute(
                "UPDATE todos SET done=?1, done_at_ms=?2, updated_ms=?3 WHERE id=?4",
                params![done as i32, done_at, now_ms(), id],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn delete_todo(&self, id: i64) -> DbResult<()> {
        self.conn
            .execute("DELETE FROM todos WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn all_todos(&self) -> DbResult<Vec<Todo>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, notes, due_date, done, done_at_ms, created_ms, updated_ms
                 FROM todos ORDER BY done ASC, due_date ASC, id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], row_to_todo)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    // ---------- 提醒日志（批次 4 用） ----------

    #[allow(dead_code)] // 批次 4（提醒）上线时启用
    pub fn reminder_sent(&self, kind: &str, ref_id: i64, instance_date: Option<i64>) -> DbResult<bool> {
        let n: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM reminder_logs WHERE kind=?1 AND ref_id=?2 AND instance_date IS ?3",
                params![kind, ref_id, instance_date],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    #[allow(dead_code)] // 批次 4（提醒）上线时启用
    pub fn log_reminder(&self, kind: &str, ref_id: i64, instance_date: Option<i64>) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO reminder_logs (kind, ref_id, instance_date, sent_ms) VALUES (?1,?2,?3,?4)",
                params![kind, ref_id, instance_date, now_ms()],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

fn row_to_event(r: &rusqlite::Row<'_>) -> rusqlite::Result<Event> {
    Ok(Event {
        id: r.get(0)?,
        title: r.get(1)?,
        location: r.get(2)?,
        notes: r.get(3)?,
        all_day: r.get::<_, i32>(4)? != 0,
        start_ms: r.get(5)?,
        end_ms: r.get(6)?,
        rrule: r.get(7)?,
        created_ms: r.get(8)?,
        updated_ms: r.get(9)?,
    })
}

fn row_to_todo(r: &rusqlite::Row<'_>) -> rusqlite::Result<Todo> {
    Ok(Todo {
        id: r.get(0)?,
        title: r.get(1)?,
        notes: r.get(2)?,
        due_date: r.get(3)?,
        done: r.get::<_, i32>(4)? != 0,
        done_at_ms: r.get(5)?,
        created_ms: r.get(6)?,
        updated_ms: r.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> CalendarDb {
        CalendarDb::open(Path::new(":memory:")).unwrap()
    }

    fn ev(title: &str, start_ms: i64, end_ms: i64) -> Event {
        Event {
            id: 0,
            title: title.into(),
            location: String::new(),
            notes: String::new(),
            all_day: false,
            start_ms,
            end_ms,
            rrule: None,
            created_ms: 0,
            updated_ms: 0,
        }
    }

    #[test]
    fn event_crud_and_window() {
        let db = mem();
        let id = db.insert_event(&ev("晨会", 10, 30)).unwrap();
        assert!(db.get_event(id).unwrap().is_some());
        // 窗口命中：与事件有交集 start<=end && end>=start（跨天/跨月事件也可见）
        assert_eq!(db.events_in_window(5, 15).unwrap().len(), 1);
        assert_eq!(db.events_in_window(11, 12).unwrap().len(), 1); // 10-30 与 11-12 重叠
        assert_eq!(db.events_in_window(40, 50).unwrap().len(), 0);
        // 更新
        let mut e = db.get_event(id).unwrap().unwrap();
        e.title = "周会".into();
        db.update_event(&e).unwrap();
        assert_eq!(db.get_event(id).unwrap().unwrap().title, "周会");
        // 删除
        db.delete_event(id).unwrap();
        assert!(db.get_event(id).unwrap().is_none());
    }

    #[test]
    fn recurring_events_in_window_scoped_by_start() {
        let db = mem();
        let mut e = ev("每周例会", 1000, 1900);
        e.rrule = Some("FREQ=WEEKLY".into());
        db.insert_event(&e).unwrap();
        // 规则事件跨窗口(超越 end)，只要起始早于窗口末端就返回（展开在命令层）
        assert_eq!(db.events_in_window(10_000_000, 20_000_000).unwrap().len(), 1);
    }

    #[test]
    fn todo_crud_and_toggle() {
        let db = mem();
        let t = Todo {
            id: 0,
            title: "交周报".into(),
            notes: String::new(),
            due_date: Some(20260829),
            done: false,
            done_at_ms: None,
            created_ms: 1,
            updated_ms: 1,
        };
        let id = db.insert_todo(&t).unwrap();
        let todos = db.all_todos().unwrap();
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].due_date, Some(20260829));
        db.toggle_todo(id, true).unwrap();
        let done = db.all_todos().unwrap();
        assert!(done[0].done);
        assert!(done[0].done_at_ms.is_some());
        db.toggle_todo(id, false).unwrap();
        assert!(!db.all_todos().unwrap()[0].done);
        db.delete_todo(id).unwrap();
        assert!(db.all_todos().unwrap().is_empty());
    }

    #[test]
    fn override_upsert_replaces() {
        let db = mem();
        let id = db.insert_event(&ev("课", 100, 200)).unwrap();
        let mut edited = ev("改期课", 300, 400);
        db.upsert_override(id, 20260901, "edit", &Some(edited.clone())).unwrap();
        let ovs = db.overrides_for(id).unwrap();
        assert_eq!(ovs.len(), 1);
        assert_eq!(ovs[0].variant, "edit");
        assert_eq!(ovs[0].start_ms, Some(300));
        // 再 upsert 同一实例 → 更新而非新增
        edited.start_ms = 500;
        db.upsert_override(id, 20260901, "edit", &Some(edited)).unwrap();
        assert_eq!(db.overrides_for(id).unwrap().len(), 1);
        assert_eq!(db.overrides_for(id).unwrap()[0].start_ms, Some(500));
        // delete 变体
        db.upsert_override(id, 20260901, "delete", &None).unwrap();
        let ovs = db.overrides_for(id).unwrap();
        assert_eq!(ovs[0].variant, "delete");
        assert!(ovs[0].start_ms.is_none());
    }

    #[test]
    fn cascade_delete_event_removes_overrides() {
        let db = mem();
        let id = db.insert_event(&ev("课", 100, 200)).unwrap();
        db.upsert_override(id, 20260901, "delete", &None).unwrap();
        db.delete_event(id).unwrap();
        assert!(db.overrides_for(id).unwrap().is_empty());
    }

    #[test]
    fn local_day_key_is_local_date() {
        // 北京时间 2026-08-29 20:00（UTC 12:00）→ 本地日 20260829
        let utc = chrono::DateTime::parse_from_rfc3339("2026-08-29T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Local);
        assert_eq!(local_day_key(utc.timestamp_millis()), 20260829);
    }
}