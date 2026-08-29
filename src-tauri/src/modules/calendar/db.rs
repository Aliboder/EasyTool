//! 日程表 SQLite 存储：事件 / 重复例外 / 待办 / 提醒日志。
//! 时间口径：一律本地时间（chrono::Local 生成毫秒；全天事件按本地日 yyyymmdd）。
//! 连接用 Mutex 串行化（rusqlite::Connection 非 Sync），与其它模块同一模式。

use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::expand;

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
    /// 单条提醒提前量（分钟；NULL = 跟随全局提前量）
    pub remind_minutes: Option<i64>,
    /// 来源：手动创建为 None；.ics 导入为对应导入源 id
    pub ics_import_id: Option<i64>,
    /// 事件颜色（hex，如 #3b82f6；NULL = 默认色）
    pub color: Option<String>,
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

/// 订阅事件（只读层，混排展示用）
#[derive(Debug, Clone)]
pub struct FeedEvent {
    pub id: i64,
    pub subscription_id: i64,
    pub title: String,
    pub location: String,
    pub notes: String,
    pub all_day: bool,
    pub start_ms: i64,
    pub end_ms: i64,
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
                    remind_minutes INTEGER,
                    ics_import_id INTEGER,
                    color TEXT,
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
                );

                CREATE TABLE IF NOT EXISTS ics_imports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    imported_at INTEGER NOT NULL,
                    event_count INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    url TEXT NOT NULL,
                    color TEXT NOT NULL DEFAULT '#3b82f6',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    refresh_minutes INTEGER NOT NULL DEFAULT 360,
                    last_sync_ms INTEGER,
                    event_count INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS feed_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    location TEXT NOT NULL DEFAULT '',
                    notes TEXT NOT NULL DEFAULT '',
                    all_day INTEGER NOT NULL DEFAULT 0,
                    start_ms INTEGER NOT NULL,
                    end_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_feed_time ON feed_events(start_ms);",
            )
            .map_err(|e| e.to_string())?;
        // 增量迁移：老库补 events.ics_import_id 列（导入源标记）
        let cols: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("PRAGMA table_info(events)")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(|e| e.to_string())?;
            let v: Vec<String> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            v
        };
        if !cols.iter().any(|c| c == "ics_import_id") {
            self.conn
                .execute("ALTER TABLE events ADD COLUMN ics_import_id INTEGER", [])
                .map_err(|e| e.to_string())?;
        }
        // 增量迁移：老库补 events.remind_minutes 列（单条提前量覆盖；NULL=跟随全局）
        if !cols.iter().any(|c| c == "remind_minutes") {
            self.conn
                .execute("ALTER TABLE events ADD COLUMN remind_minutes INTEGER", [])
                .map_err(|e| e.to_string())?;
        }
        // 增量迁移：老库补 events.color 列（本地事件颜色标签）
        if !cols.iter().any(|c| c == "color") {
            self.conn
                .execute("ALTER TABLE events ADD COLUMN color TEXT", [])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    // ---------- 事件 ----------

    pub fn insert_event(&self, e: &Event) -> DbResult<i64> {
        self.conn
            .execute(
                "INSERT INTO events (title, location, notes, all_day, start_ms, end_ms, rrule, remind_minutes, ics_import_id, color, created_ms, updated_ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    e.title,
                    e.location,
                    e.notes,
                    e.all_day as i32,
                    e.start_ms,
                    e.end_ms,
                    e.rrule,
                    e.remind_minutes,
                    e.ics_import_id,
                    e.color,
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
                "UPDATE events SET title=?1, location=?2, notes=?3, all_day=?4, start_ms=?5, end_ms=?6, rrule=?7, remind_minutes=?8, color=?9, updated_ms=?10 WHERE id=?11",
                params![
                    e.title,
                    e.location,
                    e.notes,
                    e.all_day as i32,
                    e.start_ms,
                    e.end_ms,
                    e.rrule,
                    e.remind_minutes,
                    e.color,
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
                "SELECT id, title, location, notes, all_day, start_ms, end_ms, rrule, created_ms, updated_ms, remind_minutes, ics_import_id, color
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
                "SELECT id, title, location, notes, all_day, start_ms, end_ms, rrule, created_ms, updated_ms, remind_minutes, ics_import_id, color
                 FROM events WHERE id = ?1",
                params![id],
                row_to_event,
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    /// 与某事件同名的其它事件（同名课程分组同步用；排除自身）
    pub fn events_with_title_excluding(&self, title: &str, exclude_id: i64) -> DbResult<Vec<Event>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, location, notes, all_day, start_ms, end_ms, rrule, created_ms, updated_ms, remind_minutes, ics_import_id, color
                 FROM events WHERE title = ?1 AND id != ?2 ORDER BY start_ms ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![title, exclude_id], row_to_event)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// 全部事件（导出/JSON 备份用）
    pub fn all_events(&self) -> DbResult<Vec<Event>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, location, notes, all_day, start_ms, end_ms, rrule, created_ms, updated_ms, remind_minutes, ics_import_id, color
                 FROM events ORDER BY start_ms ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], row_to_event)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// 全部例外（导出/JSON 备份用）
    pub fn all_overrides(&self) -> DbResult<Vec<EventOverride>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, event_id, instance_date, variant, title, location, notes, all_day, start_ms, end_ms
                 FROM event_overrides",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
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

    /// 删除型例外（记录该实例的原始时刻，ICS 导出 EXDATE 用）
    pub fn insert_delete_override(
        &self,
        event_id: i64,
        instance_date: i64,
        original_start_ms: i64,
    ) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO event_overrides (event_id, instance_date, variant, start_ms)
                 VALUES (?1,?2,'delete',?3)
                 ON CONFLICT(event_id, instance_date) DO UPDATE SET variant='delete', start_ms=excluded.start_ms,
                   title=NULL, location=NULL, notes=NULL, all_day=NULL, end_ms=NULL",
                params![event_id, instance_date, original_start_ms],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
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

    /// 未完成且到期的待办（due_date <= 今天；提醒线程用）
    pub fn todos_pending_due(&self, today: i64) -> DbResult<Vec<Todo>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, notes, due_date, done, done_at_ms, created_ms, updated_ms
                 FROM todos WHERE done = 0 AND due_date IS NOT NULL AND due_date <= ?1
                 ORDER BY due_date ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![today], row_to_todo)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// 批量插入导入条目（单事务；重复规则整条保留 + EXDATE 转删除型例外；ics_import_id 关联导入源）
    pub fn insert_imported(&self, items: &[super::ics::ImportItem], ics_import_id: Option<i64>) -> DbResult<()> {
        if items.is_empty() {
            return Ok(());
        }
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let now = now_ms();
        let mut inserted: Vec<(i64, &super::ics::ImportItem)> = Vec::new();
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO events (title, location, notes, all_day, start_ms, end_ms, rrule, ics_import_id, created_ms, updated_ms)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
                )
                .map_err(|e| e.to_string())?;
            for it in items {
                stmt.execute(params![
                    it.title,
                    it.location,
                    it.notes,
                    it.all_day as i32,
                    it.start_ms,
                    it.end_ms,
                    it.rrule,
                    ics_import_id,
                    now
                ])
                .map_err(|e| e.to_string())?;
                inserted.push((tx.last_insert_rowid(), it));
            }
        }
        // EXDATE → 删除型例外（记录该次原始时刻，ICS 再导出时变回 EXDATE）
        for (id, it) in &inserted {
            if it.exdates.is_empty() {
                continue;
            }
            let Some(rule) = &it.rrule else { continue };
            let start_dt = expand::ts_to_local(it.start_ms);
            for day_key in &it.exdates {
                let inst_start = expand::expand(start_dt, rule)
                    .into_iter()
                    .find(|i| expand::local_day_key(*i) == *day_key)
                    .map(expand::local_to_ts)
                    .unwrap_or(0);
                tx.execute(
                    "INSERT INTO event_overrides (event_id, instance_date, variant, start_ms)
                     VALUES (?1,?2,'delete',?3)",
                    params![id, day_key, inst_start],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }

    // ---------- ICS 导入源（批 4 需求：按文件管理） ----------

    /// 按文件名取（或建）导入源记录，返回其 id（同名重复导入=覆盖更新）
    pub fn replace_ics_import(&self, name: &str, count: usize) -> DbResult<i64> {
        let import_id: i64 = match self
            .conn
            .query_row("SELECT id FROM ics_imports WHERE name = ?1", params![name], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?
        {
            Some(id) => id,
            None => {
                self.conn
                    .execute(
                        "INSERT INTO ics_imports (name, imported_at, event_count) VALUES (?1, ?2, 0)",
                        params![name, now_ms()],
                    )
                    .map_err(|e| e.to_string())?;
                self.conn.last_insert_rowid()
            }
        };
        // 覆盖语义：先清掉该来源旧数据，再插入新数据
        self.delete_events_by_import(import_id)?;
        self.set_ics_import_count(import_id, count as i64)
            .map_err(|e| e.to_string())?;
        Ok(import_id)
    }

    pub fn delete_events_by_import(&self, import_id: i64) -> DbResult<()> {
        self.conn
            .execute("DELETE FROM events WHERE ics_import_id = ?1", params![import_id])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn set_ics_import_count(&self, import_id: i64, count: i64) -> DbResult<()> {
        self.conn
            .execute(
                "UPDATE ics_imports SET event_count = ?1, imported_at = ?2 WHERE id = ?3",
                params![count, now_ms(), import_id],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// 导入源清单（含实时事件数）
    pub fn list_ics_imports(&self) -> DbResult<Vec<(i64, String, i64, i64)>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT i.id, i.name, i.imported_at,
                        (SELECT COUNT(*) FROM events e WHERE e.ics_import_id = i.id) AS n
                 FROM ics_imports i ORDER BY i.imported_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// 删除整份导入源（连带其事件；例外随 FK 级联）
    pub fn delete_ics_import(&self, import_id: i64) -> DbResult<u32> {
        self.delete_events_by_import(import_id)?;
        self.conn
            .execute("DELETE FROM ics_imports WHERE id = ?1", params![import_id])
            .map_err(|e| e.to_string())?;
        Ok(0)
    }

    // ---------- 数据管理 ----------

    /// 统计：(事件总数, 重复规则数, 待办总数, 未完成待办数, 导入源数)
    pub fn stats(&self) -> DbResult<(i64, i64, i64, i64, i64)> {
        let one = |sql: &str| -> DbResult<i64> {
            self.conn
                .query_row(sql, [], |r| r.get(0))
                .map_err(|e| e.to_string())
        };
        Ok((
            one("SELECT COUNT(*) FROM events")?,
            one("SELECT COUNT(*) FROM events WHERE rrule IS NOT NULL")?,
            one("SELECT COUNT(*) FROM todos")?,
            one("SELECT COUNT(*) FROM todos WHERE done = 0")?,
            one("SELECT COUNT(*) FROM ics_imports")?,
        ))
    }

    /// 删除某时刻之前的单次事件（重复规则保留：规则删除会连累未来实例）
    pub fn purge_single_before(&self, before_ms: i64) -> DbResult<u32> {
        let n = self
            .conn
            .execute(
                "DELETE FROM events WHERE rrule IS NULL AND start_ms < ?1",
                params![before_ms],
            )
            .map_err(|e| e.to_string())?;
        Ok(n as u32)
    }

    /// 清待办：only_done=true 只清已完成的；false 全清
    pub fn clear_todos(&self, only_done: bool) -> DbResult<u32> {
        let n = if only_done {
            self.conn
                .execute("DELETE FROM todos WHERE done = 1", [])
                .map_err(|e| e.to_string())?
        } else {
            self.conn
                .execute("DELETE FROM todos", [])
                .map_err(|e| e.to_string())?
        };
        Ok(n as u32)
    }

    /// 清空全部数据（事件/例外/待办/导入源/提醒日志）
    pub fn clear_all(&self) -> DbResult<()> {
        for sql in [
            "DELETE FROM events",
            "DELETE FROM event_overrides",
            "DELETE FROM todos",
            "DELETE FROM ics_imports",
            "DELETE FROM reminder_logs",
        ] {
            self.conn.execute(sql, []).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// 批量删除事件（按 id 列表）
    pub fn delete_events_batch(&self, ids: &[i64]) -> DbResult<u32> {
        if ids.is_empty() {
            return Ok(0);
        }
        let placeholders = (1..=ids.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("DELETE FROM events WHERE id IN ({placeholders})");
        let n = self
            .conn
            .execute(&sql, rusqlite::params_from_iter(ids.iter()))
            .map_err(|e| e.to_string())?;
        Ok(n as u32)
    }

    // ---------- 订阅日历（只读外部日历源） ----------

    pub fn add_subscription(&self, name: &str, url: &str, color: &str) -> DbResult<i64> {
        self.conn
            .execute(
                "INSERT INTO subscriptions (name, url, color) VALUES (?1, ?2, ?3)",
                params![name, url, color],
            )
            .map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_subscription(
        &self,
        id: i64,
        name: &str,
        color: &str,
        enabled: bool,
        refresh_minutes: i64,
    ) -> DbResult<()> {
        self.conn
            .execute(
                "UPDATE subscriptions SET name=?1, color=?2, enabled=?3, refresh_minutes=?4 WHERE id=?5",
                params![name, color, enabled as i32, refresh_minutes, id],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn delete_subscription(&self, id: i64) -> DbResult<()> {
        self.conn
            .execute("DELETE FROM subscriptions WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// 订阅清单：(id, name, url, color, enabled, refresh_minutes, last_sync_ms, event_count)
    pub fn list_subscriptions(&self) -> DbResult<Vec<(i64, String, String, String, bool, i64, Option<i64>, i64)>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT s.id, s.name, s.url, s.color, s.enabled, s.refresh_minutes, s.last_sync_ms,
                        (SELECT COUNT(*) FROM feed_events f WHERE f.subscription_id = s.id)
                 FROM subscriptions s ORDER BY s.id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get::<_, i32>(4)? != 0,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// 到期待刷新的订阅：(id, url) —— 启用且 refresh_minutes>0 且距上次同步超过间隔
    pub fn due_subscriptions(&self, now_ms: i64) -> DbResult<Vec<(i64, String)>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, url FROM subscriptions
                 WHERE enabled = 1 AND refresh_minutes > 0
                   AND (last_sync_ms IS NULL OR last_sync_ms + refresh_minutes * 60000 <= ?1)",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![now_ms], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// 整体替换某个订阅的事件数据（抓取成功后调用），并记录同步时间与条数
    pub fn replace_feed(&self, subscription_id: i64, items: &[super::ics::ImportItem]) -> DbResult<()> {
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        {
            tx.execute(
                "DELETE FROM feed_events WHERE subscription_id = ?1",
                params![subscription_id],
            )
            .map_err(|e| e.to_string())?;
            let mut stmt = tx
                .prepare(
                    "INSERT INTO feed_events (subscription_id, title, location, notes, all_day, start_ms, end_ms)
                     VALUES (?1,?2,?3,?4,?5,?6,?7)",
                )
                .map_err(|e| e.to_string())?;
            for it in items {
                stmt.execute(params![
                    subscription_id,
                    it.title,
                    it.location,
                    it.notes,
                    it.all_day as i32,
                    it.start_ms,
                    it.end_ms
                ])
                .map_err(|e| e.to_string())?;
            }
            tx.execute(
                "UPDATE subscriptions SET event_count = ?1, last_sync_ms = ?2 WHERE id = ?3",
                params![items.len() as i64, now_ms(), subscription_id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    /// 窗口内已启用订阅的事件（只读层，与本地事件混排展示）
    pub fn feed_events_in_window(&self, start_ms: i64, end_ms: i64) -> DbResult<Vec<FeedEvent>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT f.id, f.subscription_id, f.title, f.location, f.notes, f.all_day, f.start_ms, f.end_ms
                 FROM feed_events f JOIN subscriptions s ON s.id = f.subscription_id
                 WHERE s.enabled = 1 AND f.start_ms <= ?2 AND f.end_ms >= ?1
                 ORDER BY f.start_ms ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![start_ms, end_ms], |r| {
                Ok(FeedEvent {
                    id: r.get(0)?,
                    subscription_id: r.get(1)?,
                    title: r.get(2)?,
                    location: r.get(3)?,
                    notes: r.get(4)?,
                    all_day: r.get::<_, i32>(5)? != 0,
                    start_ms: r.get(6)?,
                    end_ms: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    // ---------- 提醒日志 ----------

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
        remind_minutes: r.get(10)?,
        ics_import_id: r.get(11)?,
        color: r.get(12)?,
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
            remind_minutes: None,
            ics_import_id: None,
            color: None,
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
    fn same_title_peer_lookup_excludes_self() {
        let db = mem();
        let a = db.insert_event(&ev("高数", 100, 200)).unwrap();
        let b = db.insert_event(&ev("高数", 300, 400)).unwrap();
        let c = db.insert_event(&ev("英语", 500, 600)).unwrap();
        let peers = db.events_with_title_excluding("高数", a).unwrap();
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].id, b);
        assert!(peers.iter().all(|p| p.id != c));
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
    fn ics_import_source_manage() {
        use crate::modules::calendar::ics::ImportItem;
        let db = mem();
        db.insert_event(&ev("自己的", 100, 200)).unwrap();
        let item = ImportItem {
            title: "课程".into(),
            location: String::new(),
            notes: String::new(),
            all_day: false,
            start_ms: 300,
            end_ms: 400,
            rrule: None,
            exdates: vec![],
        };
        // 同名第一次导入
        let id1 = db.replace_ics_import("课表.ics", 1).unwrap();
        db.insert_imported(&[item.clone()], Some(id1)).unwrap();
        let list = db.list_ics_imports().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].3, 1);
        // 同名再导入（覆盖）：旧数据清掉、条数更新
        let id1 = db.replace_ics_import("课表.ics", 1).unwrap();
        db.insert_imported(&[item], Some(id1)).unwrap();
        assert_eq!(db.events_in_window(0, 9_000_000_000_000).unwrap().len(), 2);
        // 删除整份：只有导入源的数据被清，手建事件保留
        db.delete_ics_import(id1).unwrap();
        assert_eq!(db.events_in_window(0, 9_000_000_000_000).unwrap().len(), 1);
        assert!(db.list_ics_imports().unwrap().is_empty());
    }

    #[test]
    fn migration_adds_ics_column_idempotent() {
        let dir = std::env::temp_dir().join(format!("et-cal-mig-{}", now_ms()));
        let p = dir.as_path();
        {
            let db = CalendarDb::open(p).unwrap();
            let id = db.replace_ics_import("a.ics", 0).unwrap();
            db.delete_ics_import(id).unwrap();
        }
        // 重开（老库升级路径）不应报错，导入源机制可用
        let db = CalendarDb::open(p).unwrap();
        let list = db.list_ics_imports().unwrap();
        assert!(list.is_empty());
        drop(db);
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn data_management_ops() {
        let db = mem();
        db.insert_event(&ev("旧的", 100, 200)).unwrap();
        let mut weekly = ev("每周", 300, 400);
        weekly.rrule = Some("FREQ=WEEKLY".into());
        db.insert_event(&weekly).unwrap();
        db.insert_event(&ev("晚的", 100_000, 200_000)).unwrap();
        db.insert_todo(&Todo {
            id: 0,
            title: "做A".into(),
            notes: String::new(),
            due_date: None,
            done: true,
            done_at_ms: None,
            created_ms: 0,
            updated_ms: 0,
        })
        .unwrap();
        db.insert_todo(&Todo {
            id: 0,
            title: "做B".into(),
            notes: String::new(),
            due_date: None,
            done: false,
            done_at_ms: None,
            created_ms: 0,
            updated_ms: 0,
        })
        .unwrap();

        // 统计
        let (events, recurring, todos, pending, imports) = db.stats().unwrap();
        assert_eq!(events, 3);
        assert_eq!(recurring, 1);
        assert_eq!(todos, 2);
        assert_eq!(pending, 1);
        assert_eq!(imports, 0);

        // 按日期清理：只清单次事件，重复规则保留
        assert_eq!(db.purge_single_before(500).unwrap(), 1); // 旧的(100)
        assert_eq!(db.events_in_window(0, 9_000_000_000_000).unwrap().len(), 2);

        // 清已完成待办
        assert_eq!(db.clear_todos(true).unwrap(), 1);
        assert_eq!(db.all_todos().unwrap().len(), 1);
        // 批量删
        let ids: Vec<i64> = db.events_in_window(0, 9_000_000_000_000).unwrap().into_iter().map(|e| e.id).collect();
        assert_eq!(db.delete_events_batch(&ids).unwrap(), 2);
        assert!(db.events_in_window(0, 9_000_000_000_000).unwrap().is_empty());
        // 清空全部
        db.clear_all().unwrap();
        assert!(db.all_todos().unwrap().is_empty());
    }

    #[test]
    fn subscription_lifecycle() {
        use crate::modules::calendar::ics::ImportItem;
        let db = mem();
        let sid = db
            .add_subscription("假日日历", "https://example.com/holidays.ics", "#ef4444")
            .unwrap();
        // 未同步过 → 到期待刷新
        assert_eq!(db.due_subscriptions(now_ms()).unwrap().len(), 1);
        // 抓取替换：整份替换 + 记录条数与同步时间
        let item = ImportItem {
            title: "国庆".into(),
            location: String::new(),
            notes: String::new(),
            all_day: true,
            start_ms: 1000,
            end_ms: 2000,
            rrule: None,
            exdates: vec![],
        };
        db.replace_feed(sid, &[item]).unwrap();
        let subs = db.list_subscriptions().unwrap();
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].7, 1);
        assert!(subs[0].4);
        assert_eq!(db.feed_events_in_window(0, 5000).unwrap().len(), 1);
        // 同步后默认间隔(360min)内不再到期
        assert!(db.due_subscriptions(now_ms()).unwrap().is_empty());
        // 改为 1 分钟且上次同步在 2 分钟前 → 到期
        db.update_subscription(sid, "假日日历", "#ef4444", true, 1).unwrap();
        db.conn
            .execute(
                "UPDATE subscriptions SET last_sync_ms = ?1 WHERE id = ?2",
                params![now_ms() - 120_000, sid],
            )
            .unwrap();
        assert_eq!(db.due_subscriptions(now_ms()).unwrap().len(), 1);
        // 停用后不再到期
        db.update_subscription(sid, "假日日历", "#ef4444", false, 1).unwrap();
        assert!(db.due_subscriptions(now_ms()).unwrap().is_empty());
        // 窗口外不可见
        assert!(db.feed_events_in_window(5000, 9999).unwrap().is_empty());
        // 删除订阅 → 订阅事件级联清除
        db.delete_subscription(sid).unwrap();
        assert!(db.list_subscriptions().unwrap().is_empty());
        assert!(db.feed_events_in_window(0, 9999).unwrap().is_empty());
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