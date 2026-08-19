//! 额度监控 SQLite 存储：余额历史 / Go 快照 / Go 重置周期。
//! 连接用 Mutex 串行化（rusqlite::Connection 非 Sync），与剪贴板模块 Db 同一模式。

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

pub struct QuotaDb {
    pub conn: Connection,
}

/// Go 快照：某账户某窗口一次轮询的用量
#[derive(Debug, Clone)]
pub struct GoSnapshot {
    pub captured_at: i64, // unix ms
    pub window: String,
    pub used_percent: i32,
    pub resets_at: Option<i64>, // unix s
}

/// Go 重置周期
#[derive(Debug, Clone)]
pub struct GoCycle {
    pub id: i64,
    pub account_id: String,
    pub window: String,
    pub cycle_start: i64, // unix ms
    pub cycle_end: Option<i64>,
    pub peak_utilization: f64,
    pub total_delta: f64,
}

impl QuotaDb {
    /// 打开数据库并建表（测试可用 ":memory:"）
    pub fn open(path: &Path) -> DbResult<Self> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let db = QuotaDb { conn };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> DbResult<()> {
        self.conn
            .execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
                CREATE TABLE IF NOT EXISTS balance_history (
                    account_id TEXT NOT NULL,
                    time INTEGER NOT NULL,
                    balance REAL NOT NULL,
                    granted REAL NOT NULL DEFAULT 0,
                    topped_up REAL NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_bh_account_time ON balance_history(account_id, time);
                CREATE TABLE IF NOT EXISTS go_snapshots (
                    account_id TEXT NOT NULL,
                    captured_at INTEGER NOT NULL,
                    window TEXT NOT NULL,
                    used_percent INTEGER NOT NULL,
                    resets_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_gs_account_window_time ON go_snapshots(account_id, window, captured_at);
                CREATE TABLE IF NOT EXISTS go_cycles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id TEXT NOT NULL,
                    window TEXT NOT NULL,
                    cycle_start INTEGER NOT NULL,
                    cycle_end INTEGER,
                    peak_utilization REAL NOT NULL DEFAULT 0,
                    total_delta REAL NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_gc_account_window ON go_cycles(account_id, window);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Option<String> {
        self.conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    // ---------- 余额历史 ----------

    /// 追加余额记录；同一账户相同余额仅刷新时间戳（去重，同 JSON 时代语义）
    pub fn append_balance(
        &self,
        account_id: &str,
        balance: f64,
        granted: f64,
        topped_up: f64,
        time_ms: i64,
    ) -> DbResult<()> {
        let last: Option<f64> = self
            .conn
            .query_row(
                "SELECT balance FROM balance_history WHERE account_id = ?1 ORDER BY time DESC LIMIT 1",
                params![account_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if last == Some(balance) {
            self.conn
                .execute(
                    "UPDATE balance_history SET time = ?1, granted = ?2, topped_up = ?3
                     WHERE account_id = ?4 AND time = (SELECT MAX(time) FROM balance_history WHERE account_id = ?4)",
                    params![time_ms, granted, topped_up, account_id],
                )
                .map_err(|e| e.to_string())?;
        } else {
            self.conn
                .execute(
                    "INSERT INTO balance_history (account_id, time, balance, granted, topped_up)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![account_id, time_ms, balance, granted, topped_up],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// 按时间升序读余额历史：(time_ms, balance, granted, topped_up)
    pub fn load_balance(&self, account_id: &str) -> DbResult<Vec<(i64, f64, f64, f64)>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT time, balance, granted, topped_up FROM balance_history
                 WHERE account_id = ?1 ORDER BY time ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![account_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, f64>(1)?,
                    r.get::<_, f64>(2)?,
                    r.get::<_, f64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn latest_balance(&self, account_id: &str) -> DbResult<Option<(i64, f64, f64, f64)>> {
        self.conn
            .query_row(
                "SELECT time, balance, granted, topped_up FROM balance_history
                 WHERE account_id = ?1 ORDER BY time DESC LIMIT 1",
                params![account_id],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, f64>(1)?,
                        r.get::<_, f64>(2)?,
                        r.get::<_, f64>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    /// 上限清理：保留最近 keep 条余额记录（旧 JSON 时代上限 5000）
    pub fn prune_balance(&self, account_id: &str, keep: i64) -> DbResult<()> {
        self.conn
            .execute(
                "DELETE FROM balance_history WHERE account_id = ?1 AND time < (
                    SELECT time FROM balance_history WHERE account_id = ?1
                    ORDER BY time DESC LIMIT 1 OFFSET ?2
                 )",
                params![account_id, (keep - 1).max(0)],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    // ---------- Go 快照 ----------

    pub fn insert_go_snapshot(&self, account_id: &str, s: &GoSnapshot) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO go_snapshots (account_id, captured_at, window, used_percent, resets_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![account_id, s.captured_at, s.window, s.used_percent, s.resets_at],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// 某窗口的利用率时间序列（升序）
    pub fn go_series(
        &self,
        account_id: &str,
        window: &str,
        since_ms: i64,
    ) -> DbResult<Vec<GoSnapshot>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT captured_at, window, used_percent, resets_at FROM go_snapshots
                 WHERE account_id = ?1 AND window = ?2 AND captured_at >= ?3 ORDER BY captured_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![account_id, window, since_ms], |r| {
                Ok(GoSnapshot {
                    captured_at: r.get(0)?,
                    window: r.get(1)?,
                    used_percent: r.get(2)?,
                    resets_at: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// 本次写入前的上一份快照
    pub fn prev_go_snapshot(
        &self,
        account_id: &str,
        window: &str,
        before_ms: i64,
    ) -> DbResult<Option<GoSnapshot>> {
        self.conn
            .query_row(
                "SELECT captured_at, window, used_percent, resets_at FROM go_snapshots
                 WHERE account_id = ?1 AND window = ?2 AND captured_at < ?3
                 ORDER BY captured_at DESC LIMIT 1",
                params![account_id, window, before_ms],
                |r| {
                    Ok(GoSnapshot {
                        captured_at: r.get(0)?,
                        window: r.get(1)?,
                        used_percent: r.get(2)?,
                        resets_at: r.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    /// 各窗口最新快照（重启回填用）
    pub fn latest_go_snapshots(&self, account_id: &str) -> DbResult<Vec<GoSnapshot>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT s.captured_at, s.window, s.used_percent, s.resets_at
                 FROM go_snapshots s
                 JOIN (SELECT window, MAX(captured_at) AS m FROM go_snapshots
                       WHERE account_id = ?1 GROUP BY window) t
                   ON s.window = t.window AND s.captured_at = t.m
                 WHERE s.account_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![account_id], |r| {
                Ok(GoSnapshot {
                    captured_at: r.get(0)?,
                    window: r.get(1)?,
                    used_percent: r.get(2)?,
                    resets_at: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    // ---------- Go 重置周期 ----------

    pub fn start_cycle(&self, account_id: &str, window: &str, start_ms: i64) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO go_cycles (account_id, window, cycle_start, peak_utilization, total_delta)
                 VALUES (?1, ?2, ?3, 0, 0)",
                params![account_id, window, start_ms],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn active_cycle(&self, account_id: &str, window: &str) -> DbResult<Option<GoCycle>> {
        self.conn
            .query_row(
                "SELECT id, account_id, window, cycle_start, cycle_end, peak_utilization, total_delta
                 FROM go_cycles WHERE account_id = ?1 AND window = ?2 AND cycle_end IS NULL
                 ORDER BY cycle_start DESC LIMIT 1",
                params![account_id, window],
                |r| {
                    Ok(GoCycle {
                        id: r.get(0)?,
                        account_id: r.get(1)?,
                        window: r.get(2)?,
                        cycle_start: r.get(3)?,
                        cycle_end: r.get(4)?,
                        peak_utilization: r.get(5)?,
                        total_delta: r.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn update_active_cycle(
        &self,
        account_id: &str,
        window: &str,
        peak: f64,
        delta: f64,
    ) -> DbResult<()> {
        self.conn
            .execute(
                "UPDATE go_cycles SET peak_utilization = ?1, total_delta = ?2
                 WHERE account_id = ?3 AND window = ?4 AND cycle_end IS NULL",
                params![peak, delta, account_id, window],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn close_active_cycle(&self, account_id: &str, window: &str, end_ms: i64) -> DbResult<()> {
        self.conn
            .execute(
                "UPDATE go_cycles SET cycle_end = ?1
                 WHERE account_id = ?2 AND window = ?3 AND cycle_end IS NULL",
                params![end_ms, account_id, window],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn cycle_history(&self, account_id: &str, window: &str, limit: i64) -> DbResult<Vec<GoCycle>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, account_id, window, cycle_start, cycle_end, peak_utilization, total_delta
                 FROM go_cycles WHERE account_id = ?1 AND window = ?2 AND cycle_end IS NOT NULL
                 ORDER BY cycle_start DESC LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![account_id, window, limit], |r| {
                Ok(GoCycle {
                    id: r.get(0)?,
                    account_id: r.get(1)?,
                    window: r.get(2)?,
                    cycle_start: r.get(3)?,
                    cycle_end: r.get(4)?,
                    peak_utilization: r.get(5)?,
                    total_delta: r.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> QuotaDb {
        QuotaDb::open(Path::new(":memory:")).unwrap()
    }

    #[test]
    fn append_balance_dedups_equal() {
        let db = mem();
        db.append_balance("a", 100.0, 1.0, 99.0, 1000).unwrap();
        db.append_balance("a", 100.0, 1.0, 99.0, 2000).unwrap();
        let rows = db.load_balance("a").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, 2000); // 同值刷新时间戳
        db.append_balance("a", 90.0, 1.0, 89.0, 3000).unwrap();
        assert_eq!(db.load_balance("a").unwrap().len(), 2);
    }

    #[test]
    fn prune_balance_keeps_recent() {
        let db = mem();
        for (i, t) in [1000i64, 2000, 3000, 4000].iter().enumerate() {
            db.append_balance("a", 100.0 - i as f64, 0.0, 0.0, *t).unwrap();
        }
        db.prune_balance("a", 2).unwrap();
        let rows = db.load_balance("a").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, 3000);
    }

    #[test]
    fn cycle_lifecycle() {
        let db = mem();
        assert!(db.active_cycle("a", "weekly").unwrap().is_none());
        db.start_cycle("a", "weekly", 1000).unwrap();
        let c = db.active_cycle("a", "weekly").unwrap().unwrap();
        assert_eq!(c.cycle_start, 1000);
        db.update_active_cycle("a", "weekly", 80.0, 50.0).unwrap();
        db.close_active_cycle("a", "weekly", 5000).unwrap();
        assert!(db.active_cycle("a", "weekly").unwrap().is_none());
        let hist = db.cycle_history("a", "weekly", 10).unwrap();
        assert_eq!(hist.len(), 1);
        assert_eq!(hist[0].peak_utilization, 80.0);
        assert_eq!(hist[0].total_delta, 50.0);
    }

    #[test]
    fn snapshots_roundtrip() {
        let db = mem();
        db.insert_go_snapshot(
            "a",
            &GoSnapshot {
                captured_at: 1000,
                window: "weekly".into(),
                used_percent: 20,
                resets_at: Some(3600),
            },
        )
        .unwrap();
        db.insert_go_snapshot(
            "a",
            &GoSnapshot {
                captured_at: 2000,
                window: "weekly".into(),
                used_percent: 30,
                resets_at: Some(3600),
            },
        )
        .unwrap();
        let series = db.go_series("a", "weekly", 0).unwrap();
        assert_eq!(series.len(), 2);
        assert_eq!(series[1].used_percent, 30);
        let prev = db.prev_go_snapshot("a", "weekly", 2500).unwrap().unwrap();
        assert_eq!(prev.used_percent, 30);
        let latest = db.latest_go_snapshots("a").unwrap();
        assert_eq!(latest.len(), 1);
        assert_eq!(latest[0].used_percent, 30);
    }
}
