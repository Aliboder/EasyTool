use chrono::Datelike;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::RwLock;

use super::models::{
    auto_categorize, App, AppListItem, AUTO_CATEGORIZE_VERSION, CategoryBreakdown, CategoryRule,
    DailyStat, DayOverview, Event,
};

/// 编译后的分类规则缓存（priority 降序，首条命中即归入）。
/// 分类仅在窗口切换/规则变更时触发，频率低；缓存避免频繁编 regex。
static RULES_CACHE: RwLock<Vec<(Regex, i64, String)>> = RwLock::new(Vec::new());

/// 本地时间字符串口径统一为 "YYYY-MM-DD HH:MM:SS"，
/// ISO 风格可直接字典序比较，配合 idx_events_start_time 走索引
fn day_start(date: &str) -> String {
    format!("{date} 00:00:00")
}

fn next_day_start(date: &str) -> Option<String> {
    let d = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let next = d.checked_add_days(chrono::Days::new(1))?;
    Some(next.format("%Y-%m-%d 00:00:00").to_string())
}

pub struct TimetrackerDb {
    conn: Connection,
}

impl TimetrackerDb {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("打开数据库失败: {e}"))?;
        let db = TimetrackerDb { conn };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA busy_timeout=5000;
                 CREATE TABLE IF NOT EXISTS apps (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     exe_path TEXT UNIQUE NOT NULL,
                     app_name TEXT NOT NULL,
                     window_title TEXT,
                     category TEXT DEFAULT 'unknown',
                     category_locked INTEGER DEFAULT 0,
                     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE IF NOT EXISTS events (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     app_id INTEGER NOT NULL,
                     start_time TEXT NOT NULL,
                     end_time TEXT,
                     duration_sec INTEGER DEFAULT 0,
                     window_title TEXT,
                     is_active INTEGER DEFAULT 1,
                     FOREIGN KEY (app_id) REFERENCES apps(id)
                 );
                 CREATE INDEX IF NOT EXISTS idx_events_app_id ON events(app_id);
                 CREATE INDEX IF NOT EXISTS idx_events_start_time ON events(start_time);
                 CREATE INDEX IF NOT EXISTS idx_events_end_time ON events(end_time);
                 CREATE INDEX IF NOT EXISTS idx_apps_category ON apps(category);
                 CREATE TABLE IF NOT EXISTS category_rules (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     pattern TEXT NOT NULL,
                     category TEXT NOT NULL,
                     priority INTEGER DEFAULT 0,
                     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE IF NOT EXISTS meta (
                     key TEXT PRIMARY KEY,
                     value TEXT NOT NULL
                 );",
            )
            .map_err(|e| format!("建表失败: {e}"))?;
        // 旧库补列：category_locked（手动锁定标记），CREATE IF NOT EXISTS 不回溯已有表
        self.ensure_column("apps", "category_locked", "category_locked INTEGER DEFAULT 0")?;
        // 旧库补列：display_name（友好显示名，空 = 未解析，UI 查询 COALESCE 回退 app_name）
        self.ensure_column("apps", "display_name", "display_name TEXT")?;
        // 启动时结算上次异常退出遗留的「进行中」会话：end_time 置为 start（时长 0），
        // 避免应用停机的那段时间被算成使用时长（如重启后首跳把停机 16h 计入）
        self.conn
            .execute(
                "UPDATE events SET end_time = start_time, duration_sec = 0 WHERE end_time IS NULL",
                [],
            )
            .map_err(|e| format!("结算遗留会话失败: {e}"))?;
        // 一次性清理存量应用名的扩展名（采集改去后缀后，老数据仍带 .exe）
        self.strip_exe_app_names()?;
        self.reload_rules()?;
        Ok(())
    }

    /// 幂等清理：把 apps.app_name 的扩展名去掉（qq.exe → qq），保证历史数据与新采集一致
    fn strip_exe_app_names(&self) -> Result<(), String> {
        let rows: Vec<(i64, String)> = self
            .conn
            .prepare("SELECT id, app_name FROM apps")
            .map_err(|e| format!("查询应用失败: {e}"))?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| format!("查询应用失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集应用失败: {e}"))?;
        for (id, name) in rows {
            let stem = std::path::Path::new(&name)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| name.clone());
            if stem != name {
                self.conn
                    .execute(
                        "UPDATE apps SET app_name = ?1, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?2 AND app_name = ?3",
                        params![stem, id, name],
                    )
                    .map_err(|e| format!("清理应用名失败: {e}"))?;
            }
        }
        Ok(())
    }

    /// 幂等补列：PRAGMA table_info 查列名，缺失才 ALTER TABLE ADD COLUMN
    fn ensure_column(&self, table: &str, column: &str, ddl: &str) -> Result<(), String> {
        let exists = self
            .conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|e| format!("查询表结构失败: {e}"))?
            .query_map([], |row| Ok(row.get::<_, String>(1).unwrap_or_default() == column))
            .map_err(|e| format!("查询表结构失败: {e}"))?
            .filter_map(Result::ok)
            .any(|c| c);
        if !exists {
            self.conn
                .execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {ddl}"))
                .map_err(|e| format!("补列失败: {e}"))?;
        }
        Ok(())
    }

    /// 插入或更新应用，返回 app_id
    pub fn upsert_app(
        &self,
        exe_path: &str,
        app_name: &str,
        category: &str,
        display_name: Option<&str>,
    ) -> Result<i64, String> {
        self.conn
            .execute(
                "INSERT INTO apps (exe_path, app_name, category, display_name)
                 VALUES (?1, ?2, ?3, NULLIF(?4, ''))
                 ON CONFLICT(exe_path) DO UPDATE SET
                     app_name = excluded.app_name,
                     display_name = CASE
                         WHEN NULLIF(excluded.display_name, '') IS NOT NULL
                         THEN excluded.display_name
                         ELSE apps.display_name
                     END,
                     updated_at = CURRENT_TIMESTAMP",
                params![exe_path, app_name, category, display_name.unwrap_or("")],
            )
            .map_err(|e| format!("插入应用失败: {e}"))?;

        self.conn
            .query_row(
                "SELECT id FROM apps WHERE exe_path = ?1",
                params![exe_path],
                |row| row.get(0),
            )
            .map_err(|e| format!("查询应用ID失败: {e}"))
    }

    /// 全量对齐友好显示名：用当前解析器覆盖所有行（修复历史解析 bug 留下的截断名，
    /// 如 "腾讯电脑管家" → "腾讯电"）。resolve 失败（exe 已卸载等）保留原值。
    pub fn backfill_display_names(
        &self,
        resolver: &super::display_name::DisplayNameResolver,
    ) -> Result<usize, String> {
        let rows: Vec<(i64, String)> = self
            .conn
            .prepare("SELECT id, exe_path FROM apps")
            .map_err(|e| format!("准备显示名回填查询失败: {e}"))?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| format!("查询显示名回填失败: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("收集显示名回填失败: {e}"))?;
        let mut updated = 0usize;
        for (id, exe_path) in rows {
            if let Some(name) = resolver.resolve(&exe_path) {
                self.conn
                    .execute(
                        "UPDATE apps SET display_name = ?1, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?2",
                        params![name, id],
                    )
                    .map_err(|e| format!("回填显示名失败: {e}"))?;
                updated += 1;
            }
        }
        Ok(updated)
    }

    /// 子组件后缀是否与主名「紧贴」：'-' 连接或 CJK 汉字紧贴。
    /// ASCII 字母数字紧贴不算（避免 "Google Chrome" + "Google ChromeBeta" 这类独立产品被误并）。
    fn is_connected_suffix(full: &str, prefix_len: usize) -> bool {
        full[prefix_len..]
            .chars()
            .next()
            .is_some_and(|c| c == '-' || ('\u{4E00}'..='\u{9FFF}').contains(&c))
    }

    /// 归并同软件的多 exe 条目（display_name 相同，或"-后缀/CJK 紧贴"前缀相连，
    /// 如 "腾讯电脑管家-硬件检测" 归入 "腾讯电脑管家"）：事件 app_id 改指主行后删被并行。
    /// 主行 = display_name 最短者（同名取 id 最小）。O(n²) 全表遍历，apps 数千行时改 SQL 优化。
    /// 必须在 backfill_display_names 之后调用（名称是修复后的才归并得准）。
    pub fn merge_duplicate_apps(&self) -> Result<usize, String> {
        let rows: Vec<(i64, String)> = self
            .conn
            .prepare(
                "SELECT id, display_name FROM apps
                 WHERE display_name IS NOT NULL AND display_name != ''",
            )
            .map_err(|e| format!("准备归并查询失败: {e}"))?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| format!("查询归并失败: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("收集归并失败: {e}"))?;
        let mut rows = rows;
        // 短名先登记为主行 → 前缀目标总是先于其子组件出现；同名取 id 小者
        rows.sort_by(|a, b| a.1.len().cmp(&b.1.len()).then(a.0.cmp(&b.0)));
        let mut targets: Vec<(i64, String)> = Vec::new();
        let mut merged = 0usize;
        for (id, name) in &rows {
            let target = targets.iter().find(|(_, tname)| {
                name == tname
                    || (name.starts_with(tname.as_str())
                        && Self::is_connected_suffix(name, tname.len()))
            });
            if let Some((tid, _)) = target {
                self.conn
                    .execute(
                        "UPDATE events SET app_id = ?1 WHERE app_id = ?2",
                        params![tid, id],
                    )
                    .map_err(|e| format!("归并事件失败: {e}"))?;
                self.conn
                    .execute("DELETE FROM apps WHERE id = ?1", params![id])
                    .map_err(|e| format!("删除被并行失败: {e}"))?;
                merged += 1;
            } else {
                targets.push((*id, name.clone()));
            }
        }
        Ok(merged)
    }

    /// 采集时找归并目标：新解析出的 display_name 若命中已有应用（同名或作为其子组件），
    /// 返回已有 app_id，调用方直接复用（不新建行）。规则与 merge_duplicate_apps 一致。
    /// 反向情况（新名是主名、库中已有子组件）由下次启动的 merge_duplicate_apps 自愈。
    pub fn find_merge_target(&self, display_name: &str) -> Result<Option<i64>, String> {
        if display_name.trim().is_empty() {
            return Ok(None);
        }
        let rows: Vec<(i64, String)> = self
            .conn
            .prepare(
                "SELECT id, display_name FROM apps
                 WHERE display_name IS NOT NULL AND display_name != ''",
            )
            .map_err(|e| format!("准备归并查询失败: {e}"))?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| format!("查询归并失败: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("收集归并失败: {e}"))?;
        Ok(rows
            .iter()
            .find(|(_, n)| {
                n == display_name
                    || (display_name.starts_with(n.as_str())
                        && Self::is_connected_suffix(display_name, n.len()))
            })
            .map(|(id, _)| *id))
    }

    /// 手动设置应用分类：标记 category_locked=1（rules 重跑时跳过，避免覆盖用户手动选择）
    pub fn update_app_category(&self, app_id: i64, category: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE apps SET category = ?1, category_locked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                params![category, app_id],
            )
            .map_err(|e| format!("更新分类失败: {e}"))?;
        Ok(())
    }

    /// 开始新会话事件（时间由调用方传本地时间字符串，与查询口径一致）
    pub fn start_event(&self, app_id: i64, window_title: &str, local_now: &str) -> Result<i64, String> {
        self.conn
            .execute(
                "INSERT INTO events (app_id, start_time, window_title) VALUES (?1, ?2, ?3)",
                params![app_id, local_now, window_title],
            )
            .map_err(|e| format!("创建事件失败: {e}"))?;
        Ok(self.conn.last_insert_rowid())
    }

    /// 跨天滚动：活跃会话若起于昨日（如 23:50 用到今天 00:10），
    /// 在昨日末尾封账，并开一条今日新会话（继承应用/标题/活跃态），
    /// 时长归属不再错天。心跳与切换结算前调用；会话最长跨一天，单次滚动即可
    pub fn roll_cross_day_event(&self) -> Result<(), String> {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let row = self.conn.query_row(
            "SELECT id, app_id, start_time, window_title, is_active
             FROM events WHERE end_time IS NULL",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i32>(4)?,
                ))
            },
        );
        let (id, app_id, start, title, active) = match row {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(format!("查询活跃会话失败: {e}")),
        };
        let start_date = start.split(' ').next().unwrap_or("").to_string();
        if start_date >= today {
            return Ok(()); // 同一天，无需滚动
        }
        // 原会话封账于昨日 23:59:59
        let yesterday_end = format!("{start_date} 23:59:59");
        self.conn
            .execute(
                "UPDATE events SET end_time = ?1,
                     duration_sec = MAX(0, CAST((julianday(?1) - julianday(start_time)) * 86400 AS INTEGER))
                 WHERE id = ?2",
                params![yesterday_end, id],
            )
            .map_err(|e| format!("封账失败: {e}"))?;
        // 今日新会话从 0 点起算（end_time 保持 NULL，交由后续心跳/切换正常结算）
        self.conn
            .execute(
                "INSERT INTO events (app_id, start_time, window_title, is_active)
                 VALUES (?1, ?2, ?3, ?4)",
                params![app_id, day_start(&today), title, active],
            )
            .map_err(|e| format!("滚动新会话失败: {e}"))?;
        log::info!("timetracker: rolled cross-day session {id} ({start_date} -> {today})");
        Ok(())
    }

    /// 当前进行中会话的应用 exe_path（无进行中会话返回 None）。
    /// 用于判断「同应用的不同窗口」是否改变：同 exe 不算真实切换，不应切分会话。
    pub fn active_event_app_path(&self) -> Result<Option<String>, String> {
        let row = self.conn.query_row(
            "SELECT a.exe_path FROM events e JOIN apps a ON e.app_id = a.id
             WHERE e.end_time IS NULL LIMIT 1",
            [],
            |r| r.get::<_, String>(0),
        );
        match row {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("查询进行中会话应用失败: {e}")),
        }
    }

    /// 心跳：延长当前会话；若活跃状态翻转则封账旧段、开新段（保持同 app/标题）。
    /// 这样「使用→挂机→使用」中间那段挂机能单独算出来；只有 close_current_event /
    /// 跨天滚动 / 暂停录制才真正结束。end_time 保持 NULL = 「进行中」且时长单调增长。
    pub fn update_current_event(&self, local_now: &str, is_active: bool) -> Result<(), String> {
        let row = self.conn.query_row(
            "SELECT id, app_id, COALESCE(window_title, ''), is_active
             FROM events WHERE end_time IS NULL",
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, i32>(3)?)),
        );
        let (id, app_id, title, cur_active) = match row {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()), // 无进行中会话
            Err(e) => return Err(format!("查询进行中会话失败: {e}")),
        };
        let active_i = is_active as i32;
        if cur_active == active_i {
            // 状态未变：延长（保持开启），时长 = 当前 - 开始
            self.conn
                .execute(
                    "UPDATE events SET
                         duration_sec = MAX(0, CAST((julianday(?1) - julianday(start_time)) * 86400 AS INTEGER))
                     WHERE id = ?2",
                    params![local_now, id],
                )
                .map_err(|e| format!("延长会话失败: {e}"))?;
        } else {
            // 状态翻转：封账旧段（保留其 is_active），开新段（同 app/标题、新 is_active）
            self.conn
                .execute(
                    "UPDATE events SET
                         end_time = ?1,
                         duration_sec = MAX(0, CAST((julianday(?1) - julianday(start_time)) * 86400 AS INTEGER))
                     WHERE id = ?2",
                    params![local_now, id],
                )
                .map_err(|e| format!("封账会话失败: {e}"))?;
            self.conn
                .execute(
                    "INSERT INTO events (app_id, start_time, window_title, is_active)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![app_id, local_now, title, active_i],
                )
                .map_err(|e| format!("开启新段失败: {e}"))?;
        }
        Ok(())
    }

    /// 封账当前会话（切换窗口 / 暂停录制时调用）：写入 end_time 并结算时长
    pub fn close_current_event(&self, local_now: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE events SET
                     end_time = ?1,
                     duration_sec = MAX(0, CAST((julianday(?1) - julianday(start_time)) * 86400 AS INTEGER))
                 WHERE end_time IS NULL",
                params![local_now],
            )
            .map_err(|e| format!("封账事件失败: {e}"))?;
        Ok(())
    }

    /// 今日统计（Top N）。start_time 已存本地时间，date() 直接可用
    pub fn get_today_stats(&self, limit: i64) -> Result<Vec<DailyStat>, String> {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        self.get_day_stats(&today, limit)
    }

    /// 任意一天统计（Top N），date 格式 YYYY-MM-DD。范围比较走 start_time 索引
    pub fn get_day_stats(&self, date: &str, limit: i64) -> Result<Vec<DailyStat>, String> {
        let next = next_day_start(date).ok_or_else(|| "日期格式错误".to_string())?;
        let mut stmt = self
            .conn
            .prepare(
                "SELECT e.app_id, COALESCE(NULLIF(a.display_name, ''), a.app_name),
                        a.category, a.exe_path,
                        SUM(e.duration_sec) as total_duration,
                        SUM(CASE WHEN e.is_active = 1 THEN e.duration_sec ELSE 0 END) as active_duration,
                        COUNT(*) as session_count
                 FROM events e
                 JOIN apps a ON e.app_id = a.id
                 WHERE e.start_time >= ?1 AND e.start_time < ?2
                 GROUP BY e.app_id
                 ORDER BY total_duration DESC
                 LIMIT ?3",
            )
            .map_err(|e| format!("准备查询失败: {e}"))?;

        let rows = stmt
            .query_map(params![day_start(date), next, limit], |row| {
                Ok(DailyStat {
                    app_id: row.get(0)?,
                    app_name: row.get(1)?,
                    category: row.get(2)?,
                    exe_path: row.get(3)?,
                    date: date.to_string(),
                    total_duration_sec: row.get(4)?,
                    active_duration_sec: row.get(5)?,
                    session_count: row.get(6)?,
                })
            })
            .map_err(|e| format!("查询失败: {e}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集结果失败: {e}"))
    }

    /// 单日概览：当日总/活跃时长 + 前一日总时长（对比用）+ 应用数
    pub fn get_day_overview(&self, date: &str) -> Result<DayOverview, String> {
        let d = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| "日期格式错误".to_string())?;
        let next = d
            .checked_add_days(chrono::Days::new(1))
            .ok_or_else(|| "日期计算失败".to_string())?
            .format("%Y-%m-%d")
            .to_string();
        let prev = d
            .checked_sub_days(chrono::Days::new(1))
            .map(|p| p.format("%Y-%m-%d").to_string());
        let (total, active, app_count) = self.range_stats(date, Some(&next))?;
        let prev_total = match prev {
            Some(p) => self.range_stats(&p, Some(&date))?.0,
            None => 0,
        };
        Ok(DayOverview {
            date: date.to_string(),
            total_sec: total,
            active_sec: active,
            prev_total_sec: prev_total,
            app_count,
        })
    }

    /// 本周概览（周日起）：本周总/活跃时长 + 上周总时长（对比用）+ 应用数
    pub fn get_week_overview(&self) -> Result<DayOverview, String> {
        let today = chrono::Local::now().date_naive();
        let sunday = today - chrono::Days::new(today.weekday().num_days_from_sunday() as u64);
        let prev_sunday = sunday - chrono::Days::new(7);
        let sunday_s = sunday.format("%Y-%m-%d").to_string();
        let prev_s = prev_sunday.format("%Y-%m-%d").to_string();
        let (total, active, app_count) = self.range_stats(&sunday_s, None)?;
        let prev_total = self.range_stats(&prev_s, Some(&sunday_s))?.0;
        Ok(DayOverview {
            date: chrono::Local::now().format("%G-W%V").to_string(),
            total_sec: total,
            active_sec: active,
            prev_total_sec: prev_total,
            app_count,
        })
    }

    /// 本月概览（自然月）：本月总/活跃时长 + 上月总时长（对比用）+ 应用数
    pub fn get_month_overview(&self) -> Result<DayOverview, String> {
        let today = chrono::Local::now().date_naive();
        let first_s = today.format("%Y-%m-01").to_string();
        let prev_first_s = today
            .with_day(1)
            .and_then(|f| f.checked_sub_months(chrono::Months::new(1)))
            .map(|f| f.format("%Y-%m-01").to_string())
            .unwrap_or_default();
        let (total, active, app_count) = self.range_stats(&first_s, None)?;
        let prev_total = if prev_first_s.is_empty() {
            0
        } else {
            self.range_stats(&prev_first_s, Some(&first_s))?.0
        };
        Ok(DayOverview {
            date: today.format("%Y-%m").to_string(),
            total_sec: total,
            active_sec: active,
            prev_total_sec: prev_total,
            app_count,
        })
    }

    /// 区间统计 [start, end)：返回 (总时长, 活跃时长, 去重应用数)。end 为 None 表示开放到当前
    fn range_stats(&self, start: &str, end: Option<&str>) -> Result<(i64, i64, i64), String> {
        let row = match end {
            Some(end) => self.conn.query_row(
                "SELECT COALESCE(SUM(duration_sec), 0),
                        COALESCE(SUM(CASE WHEN is_active = 1 THEN duration_sec ELSE 0 END), 0),
                        COUNT(DISTINCT app_id)
                 FROM events WHERE start_time >= ?1 AND start_time < ?2",
                params![day_start(start), day_start(end)],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ),
            None => self.conn.query_row(
                "SELECT COALESCE(SUM(duration_sec), 0),
                        COALESCE(SUM(CASE WHEN is_active = 1 THEN duration_sec ELSE 0 END), 0),
                        COUNT(DISTINCT app_id)
                 FROM events WHERE start_time >= ?1",
                params![day_start(start)],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ),
        };
        row.map_err(|e| format!("查询失败: {e}"))
    }

    /// 近 N 天每日总时长（按日升序，缺数据的日期无行），卡片迷你趋势用
    pub fn get_daily_totals(&self, days: i64) -> Result<Vec<(String, i64)>, String> {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let start_date = chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d")
            .ok()
            .and_then(|d| d.checked_sub_days(chrono::Days::new(days.max(1) as u64 - 1)))
            .map(|d| d.format("%Y-%m-%d").to_string());
        let Some(start_date) = start_date else {
            return Ok(vec![]);
        };
        let mut stmt = self
            .conn
            .prepare(
                "SELECT substr(e.start_time, 1, 10), SUM(e.duration_sec)
                 FROM events e
                 WHERE e.start_time >= ?1 AND e.start_time < ?2
                 GROUP BY substr(e.start_time, 1, 10)
                 ORDER BY 1",
            )
            .map_err(|e| format!("准备查询失败: {e}"))?;
        let next = next_day_start(&today).unwrap_or_else(|| format!("{today} 23:59:59"));
        let rows = stmt
            .query_map(params![day_start(&start_date), next], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| format!("查询失败: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集结果失败: {e}"))
    }

    /// 本周统计（周日起）。起点由 Rust 计算后传入，SQL 走索引
    pub fn get_week_stats(&self, limit: i64) -> Result<Vec<DailyStat>, String> {
        let week_label = chrono::Local::now().format("%G-W%V").to_string();
        let today = chrono::Local::now().date_naive();
        let sunday =
            (today - chrono::Days::new(today.weekday().num_days_from_sunday() as u64))
                .format("%Y-%m-%d")
                .to_string();

        let mut stmt = self
            .conn
            .prepare(
                "SELECT e.app_id, COALESCE(NULLIF(a.display_name, ''), a.app_name),
                        a.category, a.exe_path,
                        SUM(e.duration_sec),
                        SUM(CASE WHEN e.is_active = 1 THEN e.duration_sec ELSE 0 END),
                        COUNT(*)
                 FROM events e
                 JOIN apps a ON e.app_id = a.id
                 WHERE e.start_time >= ?1
                 GROUP BY e.app_id
                 ORDER BY 5 DESC
                 LIMIT ?2",
            )
            .map_err(|e| format!("准备查询失败: {e}"))?;

        let rows = stmt
            .query_map(params![day_start(&sunday), limit], |row| {
                Ok(DailyStat {
                    app_id: row.get(0)?,
                    app_name: row.get(1)?,
                    category: row.get(2)?,
                    exe_path: row.get(3)?,
                    date: week_label.clone(),
                    total_duration_sec: row.get(4)?,
                    active_duration_sec: row.get(5)?,
                    session_count: row.get(6)?,
                })
            })
            .map_err(|e| format!("查询失败: {e}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集结果失败: {e}"))
    }

    /// 本月统计。起点由 Rust 计算，SQL 走索引
    pub fn get_month_stats(&self, limit: i64) -> Result<Vec<DailyStat>, String> {
        let month_label = chrono::Local::now().format("%Y-%m").to_string();
        let first_of_month = chrono::Local::now()
            .date_naive()
            .format("%Y-%m-01")
            .to_string();

        let mut stmt = self
            .conn
            .prepare(
                "SELECT e.app_id, COALESCE(NULLIF(a.display_name, ''), a.app_name),
                        a.category, a.exe_path,
                        SUM(e.duration_sec),
                        SUM(CASE WHEN e.is_active = 1 THEN e.duration_sec ELSE 0 END),
                        COUNT(*)
                 FROM events e
                 JOIN apps a ON e.app_id = a.id
                 WHERE e.start_time >= ?1
                 GROUP BY e.app_id
                 ORDER BY 5 DESC
                 LIMIT ?2",
            )
            .map_err(|e| format!("准备查询失败: {e}"))?;

        let rows = stmt
            .query_map(params![day_start(&first_of_month), limit], |row| {
                Ok(DailyStat {
                    app_id: row.get(0)?,
                    app_name: row.get(1)?,
                    category: row.get(2)?,
                    exe_path: row.get(3)?,
                    date: month_label.clone(),
                    total_duration_sec: row.get(4)?,
                    active_duration_sec: row.get(5)?,
                    session_count: row.get(6)?,
                })
            })
            .map_err(|e| format!("查询失败: {e}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集结果失败: {e}"))
    }

    /// 指定日期的时间线事件（JOIN 带出应用名与分类）。范围比较走索引
    pub fn get_app_timeline(&self, date: &str) -> Result<Vec<Event>, String> {
        let next = next_day_start(date).ok_or_else(|| "日期格式错误".to_string())?;
        let mut stmt = self
            .conn
            .prepare(
                "SELECT e.id, e.app_id, e.start_time, e.end_time, e.duration_sec,
                        e.window_title, e.is_active,
                        COALESCE(NULLIF(a.display_name, ''), a.app_name), a.category,
                        a.exe_path
                 FROM events e
                 JOIN apps a ON e.app_id = a.id
                 WHERE e.start_time >= ?1 AND e.start_time < ?2 AND e.duration_sec > 0
                 ORDER BY e.start_time",
            )
            .map_err(|e| format!("准备查询失败: {e}"))?;

        let rows = stmt
            .query_map(params![day_start(date), next], |row| {
                Ok(Event {
                    id: row.get(0)?,
                    app_id: row.get(1)?,
                    start_time: row.get(2)?,
                    end_time: row.get(3)?,
                    duration_sec: row.get(4)?,
                    window_title: row.get(5)?,
                    is_active: row.get(6)?,
                    app_name: row.get(7)?,
                    category: row.get(8)?,
                    exe_path: row.get(9)?,
                })
            })
            .map_err(|e| format!("查询失败: {e}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集结果失败: {e}"))
    }

    /// 指定区间 [start, end) 的时间线事件（周/月多日图用）。范围比较走索引
    pub fn get_app_timeline_range(&self, start: &str, end: &str) -> Result<Vec<Event>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT e.id, e.app_id, e.start_time, e.end_time, e.duration_sec,
                        e.window_title, e.is_active,
                        COALESCE(NULLIF(a.display_name, ''), a.app_name), a.category,
                        a.exe_path
                 FROM events e
                 JOIN apps a ON e.app_id = a.id
                 WHERE e.start_time >= ?1 AND e.start_time < ?2 AND e.duration_sec > 0
                 ORDER BY e.start_time",
            )
            .map_err(|e| format!("准备范围查询失败: {e}"))?;

        let rows = stmt
            .query_map(params![day_start(start), day_start(end)], |row| {
                Ok(Event {
                    id: row.get(0)?,
                    app_id: row.get(1)?,
                    start_time: row.get(2)?,
                    end_time: row.get(3)?,
                    duration_sec: row.get(4)?,
                    window_title: row.get(5)?,
                    is_active: row.get(6)?,
                    app_name: row.get(7)?,
                    category: row.get(8)?,
                    exe_path: row.get(9)?,
                })
            })
            .map_err(|e| format!("范围查询失败: {e}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集范围结果失败: {e}"))
    }

    /// 应用近 N 天每日时长趋势（详情页用）。范围比较走索引
    pub fn get_app_daily_trend(&self, app_id: i64, days: i64) -> Result<Vec<DailyStat>, String> {
        let today = chrono::Local::now().date_naive();
        let start_date = today
            .checked_sub_days(chrono::Days::new(days.max(1) as u64 - 1))
            .map(|d| d.format("%Y-%m-%d").to_string())
            .ok_or_else(|| "日期计算失败".to_string())?;

        let mut stmt = self
            .conn
            .prepare(
                "SELECT substr(e.start_time, 1, 10),
                        SUM(e.duration_sec),
                        SUM(CASE WHEN e.is_active = 1 THEN e.duration_sec ELSE 0 END),
                        COUNT(*)
                 FROM events e
                 WHERE e.app_id = ?1 AND e.start_time >= ?2
                 GROUP BY substr(e.start_time, 1, 10)
                 ORDER BY 1",
            )
            .map_err(|e| format!("准备查询失败: {e}"))?;

        let rows = stmt
            .query_map(params![app_id, day_start(&start_date)], |row| {
                Ok(DailyStat {
                    app_id,
                    app_name: String::new(),
                    category: String::new(),
                    exe_path: String::new(),
                    date: row.get(0)?,
                    total_duration_sec: row.get(1)?,
                    active_duration_sec: row.get(2)?,
                    session_count: row.get(3)?,
                })
            })
            .map_err(|e| format!("查询失败: {e}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集结果失败: {e}"))
    }

    /// 应用聚合信息：(今日, 本周, 本月) 时长。范围比较走索引
    pub fn get_app_durations(&self, app_id: i64) -> Result<(i64, i64, i64), String> {
        let today = chrono::Local::now().date_naive();
        let today_s = today.format("%Y-%m-%d").to_string();
        let next = next_day_start(&today_s).unwrap_or_default();
        let sunday =
            (today - chrono::Days::new(today.weekday().num_days_from_sunday() as u64))
                .format("%Y-%m-%d")
                .to_string();
        let month_start = today.format("%Y-%m-01").to_string();

        let today_dur: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(duration_sec), 0) FROM events
                 WHERE app_id = ?1 AND start_time >= ?2 AND start_time < ?3",
                params![app_id, day_start(&today_s), next],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let week: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(duration_sec), 0) FROM events
                 WHERE app_id = ?1 AND start_time >= ?2",
                params![app_id, day_start(&sunday)],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let month: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(duration_sec), 0) FROM events
                 WHERE app_id = ?1 AND start_time >= ?2",
                params![app_id, day_start(&month_start)],
                |row| row.get(0),
            )
            .unwrap_or(0);

        Ok((today_dur, week, month))
    }

    /// 应用基础信息
    pub fn get_app(&self, app_id: i64) -> Result<Option<App>, String> {
        let result = self.conn.query_row(
            "SELECT id, exe_path, COALESCE(NULLIF(display_name, ''), app_name),
                    window_title, category, created_at, updated_at
             FROM apps WHERE id = ?1",
            params![app_id],
            |row| {
                Ok(App {
                    id: row.get(0)?,
                    exe_path: row.get(1)?,
                    app_name: row.get(2)?,
                    window_title: row.get(3)?,
                    category: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        );

        match result {
            Ok(app) => Ok(Some(app)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("查询应用失败: {e}")),
        }
    }

    /// 删除指定事件
    pub fn delete_event(&self, event_id: i64) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM events WHERE id = ?1", params![event_id])
            .map_err(|e| format!("删除事件失败: {e}"))?;
        Ok(())
    }

    // ========== 分类规则 ==========

    /// 加载所有规则（priority 降序）。
    pub fn get_category_rules(&self) -> Result<Vec<CategoryRule>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, pattern, category, priority
                 FROM category_rules ORDER BY priority DESC, id ASC",
            )
            .map_err(|e| format!("准备规则查询失败: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(CategoryRule {
                    id: row.get(0)?,
                    pattern: row.get(1)?,
                    category: row.get(2)?,
                    priority: row.get(3)?,
                })
            })
            .map_err(|e| format!("查询规则失败: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集规则失败: {e}"))
    }

    /// 把数据库里的规则重新编译进缓存（规则增删改后调用；无效正则跳过并告警）。
    fn reload_rules(&self) -> Result<(), String> {
        let rules = self.get_category_rules()?;
        let mut cache = RULES_CACHE
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        cache.clear();
        for r in rules {
            match Regex::new(&r.pattern) {
                Ok(re) => cache.push((re, r.priority, r.category)),
                Err(e) => log::warn!("timetracker: 跳过无效分类规则 [{}]: {e}", r.pattern),
            }
        }
        Ok(())
    }

    /// 规则优先，回退内置 auto_categorize，再否则 unknown。
    /// 规则匹配 app 名或窗口标题（正则），首条命中即定分类。
    pub fn categorize(&self, app_name: &str, exe_path: &str, title: &str) -> String {
        let cache = RULES_CACHE
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for (re, _priority, category) in cache.iter() {
            if re.is_match(app_name) || (!title.is_empty() && re.is_match(title)) {
                return category.clone();
            }
        }
        let fallback = auto_categorize(app_name, exe_path);
        if fallback != "unknown" {
            return fallback;
        }
        "unknown".to_string()
    }

    /// 新增规则（校验正则；priority 取当前最大 +1）。
    pub fn add_category_rule(&self, pattern: &str, category: &str) -> Result<i64, String> {
        Regex::new(pattern).map_err(|e| format!("正则无效: {e}"))?;
        let max_prio: i64 = self
            .conn
            .query_row("SELECT COALESCE(MAX(priority),0) FROM category_rules", [], |r| {
                r.get(0)
            })
            .unwrap_or(0);
        self.conn
            .execute(
                "INSERT INTO category_rules (pattern, category, priority) VALUES (?1, ?2, ?3)",
                params![pattern, category, max_prio + 1],
            )
            .map_err(|e| format!("新增规则失败: {e}"))?;
        self.reload_rules()?;
        Ok(self.conn.last_insert_rowid())
    }

    /// 更新规则。
    pub fn update_category_rule(
        &self,
        id: i64,
        pattern: &str,
        category: &str,
    ) -> Result<(), String> {
        Regex::new(pattern).map_err(|e| format!("正则无效: {e}"))?;
        self.conn
            .execute(
                "UPDATE category_rules SET pattern = ?1, category = ?2 WHERE id = ?3",
                params![pattern, category, id],
            )
            .map_err(|e| format!("更新规则失败: {e}"))?;
        self.reload_rules()
    }

    /// 删除规则。
    pub fn delete_category_rule(&self, id: i64) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM category_rules WHERE id = ?1", params![id])
            .map_err(|e| format!("删除规则失败: {e}"))?;
        self.reload_rules()
    }

    /// 当前分类指纹：内置分类版本 + 用户规则（pattern/category/priority，顺序敏感）。
    /// 规则或内置关键词任一变化都会得到不同指纹。
    fn rules_fingerprint(&self) -> Result<String, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT pattern, category, priority
                 FROM category_rules ORDER BY priority DESC, id ASC",
            )
            .map_err(|e| format!("准备规则指纹查询失败: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
            })
            .map_err(|e| format!("查询规则指纹失败: {e}"))?;
        let mut fp = format!("v{AUTO_CATEGORIZE_VERSION}");
        for row in rows {
            let (pattern, category, priority) =
                row.map_err(|e| format!("读取规则指纹失败: {e}"))?;
            fp.push(';');
            fp.push_str(&pattern);
            fp.push('\u{1}');
            fp.push_str(&category);
            fp.push('\u{1}');
            fp.push_str(&priority.to_string());
        }
        Ok(fp)
    }

    fn saved_rules_fingerprint(&self) -> Result<String, String> {
        self.conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'category_rules_fp'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map(|v| v.unwrap_or_default())
            .map_err(|e| format!("读取分类指纹失败: {e}"))
    }

    fn save_rules_fingerprint(&self, fp: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO meta(key, value) VALUES ('category_rules_fp', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![fp],
            )
            .map_err(|e| format!("保存分类指纹失败: {e}"))?;
        Ok(())
    }

    /// 启动时按指纹判断是否需要重分类：规则/内置关键词没变则跳过全量 UPDATE。
    pub fn reapply_categories_if_changed(&self) -> Result<bool, String> {
        self.reload_rules()?;
        let fp = self.rules_fingerprint()?;
        if self.saved_rules_fingerprint()? == fp {
            return Ok(false);
        }
        self.reapply_categories_inner()?;
        self.save_rules_fingerprint(&fp)?;
        Ok(true)
    }

    /// 用当前规则+build 内置回退重新分类所有已有应用（规则变更后调用）。
    pub fn reapply_categories(&self) -> Result<(), String> {
        self.reload_rules()?;
        let fp = self.rules_fingerprint()?;
        self.reapply_categories_inner()?;
        self.save_rules_fingerprint(&fp)
    }

    fn reapply_categories_inner(&self) -> Result<(), String> {
        self.reload_rules()?;
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, exe_path, app_name, COALESCE(window_title, '') FROM apps",
            )
            .map_err(|e| format!("准备应用查询失败: {e}"))?;
        let apps: Vec<(i64, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(|e| format!("查询应用失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集应用失败: {e}"))?;
        for (id, path, name, title) in apps {
            let cat = self.categorize(&name, &path, &title);
            self.conn
                .execute(
                    "UPDATE apps SET category = ?1, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?2 AND category <> ?1 AND category_locked = 0",
                    params![cat, id],
                )
                .map_err(|e| format!("更新应用分类失败: {e}"))?;
        }
        Ok(())
    }

    /// 清空全部历史（事件与应用记录），保留分类规则与手动归类。返回删除的事件数
    pub fn clear_history(&self) -> Result<u32, String> {
        let events = self
            .conn
            .execute("DELETE FROM events", [])
            .map_err(|e| format!("清理事件失败: {e}"))?;
        self.conn
            .execute("DELETE FROM apps", [])
            .map_err(|e| format!("清理应用失败: {e}"))?;
        Ok(events as u32)
    }

    /// 设置页：列出所有应用（含累计时长，按时长降序）。
    pub fn list_apps(&self) -> Result<Vec<AppListItem>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT a.id, COALESCE(NULLIF(a.display_name, ''), a.app_name),
                        a.exe_path, a.category, a.category_locked,
                        COALESCE(SUM(e.duration_sec), 0)
                 FROM apps a LEFT JOIN events e ON e.app_id = a.id
                 GROUP BY a.id
                 ORDER BY COALESCE(SUM(e.duration_sec), 0) DESC,
                          COALESCE(NULLIF(a.display_name, ''), a.app_name) ASC",
            )
            .map_err(|e| format!("准备应用列表查询失败: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AppListItem {
                    id: row.get(0)?,
                    app_name: row.get(1)?,
                    exe_path: row.get(2)?,
                    category: row.get(3)?,
                    category_locked: row.get::<_, i64>(4)? != 0,
                    total_duration_sec: row.get(5)?,
                })
            })
            .map_err(|e| format!("查询应用列表失败: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集应用列表失败: {e}"))
    }

    /// 解除手动锁定，并按当前规则+内置回退重新归类单个应用。
    pub fn reset_app_category(&self, app_id: i64) -> Result<(), String> {
        self.reload_rules()?;
        let (path, name, title) = self
            .conn
            .query_row(
                "SELECT exe_path, app_name, COALESCE(window_title, '') FROM apps WHERE id = ?1",
                params![app_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .map_err(|e| format!("查询应用失败: {e}"))?;
        let cat = self.categorize(&name, &path, &title);
        self.conn
            .execute(
                "UPDATE apps SET category = ?1, category_locked = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                params![cat, app_id],
            )
            .map_err(|e| format!("重置分类失败: {e}"))?;
        Ok(())
    }

    /// 单日分类占比：按分类汇总当日全部时长（非 Top N）。
    pub fn get_category_breakdown(&self, date: &str) -> Result<Vec<CategoryBreakdown>, String> {
        let next = next_day_start(date).ok_or_else(|| "日期格式错误".to_string())?;
        let next = next
            .split(' ')
            .next()
            .unwrap_or(date)
            .to_string();
        self.get_category_breakdown_range(date, &next)
    }

    /// 区间分类占比 [start, end)：按分类汇总时长（非 Top N）。
    pub fn get_category_breakdown_range(
        &self,
        start: &str,
        end: &str,
    ) -> Result<Vec<CategoryBreakdown>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT a.category,
                        SUM(e.duration_sec),
                        SUM(CASE WHEN e.is_active = 1 THEN e.duration_sec ELSE 0 END)
                 FROM events e
                 JOIN apps a ON e.app_id = a.id
                 WHERE e.start_time >= ?1 AND e.start_time < ?2
                 GROUP BY a.category
                 ORDER BY SUM(e.duration_sec) DESC",
            )
            .map_err(|e| format!("准备分类占比查询失败: {e}"))?;
        let rows = stmt
            .query_map(params![day_start(start), day_start(end)], |row| {
                Ok(CategoryBreakdown {
                    category: row.get(0)?,
                    total_duration_sec: row.get(1)?,
                    active_duration_sec: row.get(2)?,
                })
            })
            .map_err(|e| format!("查询分类占比失败: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("收集分类占比失败: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn temp_db(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("tt_test_{}_{name}.db", std::process::id()))
    }
    fn remove(p: &Path) {
        let _ = std::fs::remove_file(p);
        let _ = std::fs::remove_file(format!("{}-wal", p.display()));
        let _ = std::fs::remove_file(format!("{}-shm", p.display()));
    }

    #[test]
    fn heartbeat_extends_without_freeze() {
        let p = temp_db("extend");
        remove(&p);
        let db = TimetrackerDb::open(&p).unwrap();
        let app_id = db.upsert_app("c:\\a.exe", "A", "dev", None).unwrap();
        let ev = db
            .start_event(app_id, "title", "2026-08-26 10:00:00")
            .unwrap();

        // 心跳 15s：保持开启（end_time 为 NULL），时长≈15
        db.update_current_event("2026-08-26 10:00:15", true)
            .unwrap();
        let (dur1, end): (i64, Option<String>) = db
            .conn
            .query_row(
                "SELECT duration_sec, end_time FROM events WHERE id = ?1",
                params![ev],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(dur1 >= 14 && dur1 <= 15, "首个心跳时长约15s，实际 {dur1}");
        assert_eq!(end, None, "心跳不应封账事件");

        // 再心跳到 30s：时长继续增长（未冻结），end_time 仍为 NULL
        db.update_current_event("2026-08-26 10:00:30", true)
            .unwrap();
        let (dur2, end): (i64, Option<String>) = db
            .conn
            .query_row(
                "SELECT duration_sec, end_time FROM events WHERE id = ?1",
                params![ev],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(
            dur2 > dur1,
            "会话应持续累计而非冻结：{dur1} -> {dur2}"
        );
        assert_eq!(end, None);

        // 封账：end_time 写入，时长≈45
        db.close_current_event("2026-08-26 10:00:45").unwrap();
        let (dur, end): (i64, Option<String>) = db
            .conn
            .query_row(
                "SELECT duration_sec, end_time FROM events WHERE id = ?1",
                params![ev],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(dur >= 43 && dur <= 45, "封账时长约45s，实际 {dur}");
        assert_eq!(end, Some("2026-08-26 10:00:45".to_string()));

        remove(&p);
    }

    #[test]
    fn init_settles_stale_open_event() {
        let p = temp_db("stale");
        remove(&p);
        // 先建库并留一条「进行中」（end_time NULL）会话
        {
            let db = TimetrackerDb::open(&p).unwrap();
            let app_id = db.upsert_app("c:\\b.exe", "B", "dev", None).unwrap();
            db.start_event(app_id, "t", "2026-08-25 09:00:00")
                .unwrap();
        }
        // 重新打开：init 应把遗留 open 会话 end_time 置为 start（时长 0）
        let db = TimetrackerDb::open(&p).unwrap();
        let (dur, end): (i64, Option<String>) = db
            .conn
            .query_row(
                "SELECT duration_sec, end_time FROM events",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(dur, 0);
        assert_eq!(end, Some("2026-08-25 09:00:00".to_string()));
        remove(&p);
    }

    #[test]
    fn active_event_app_path_tracks_open() {
        let p = temp_db("activepath");
        remove(&p);
        let db = TimetrackerDb::open(&p).unwrap();
        let app_id = db.upsert_app("c:\\app.exe", "app", "dev", None).unwrap();
        // 尚无进行中会话
        assert_eq!(db.active_event_app_path().unwrap(), None);
        // 开段后返回该应用 exe_path
        db.start_event(app_id, "t", "2026-08-26 10:00:00").unwrap();
        assert_eq!(
            db.active_event_app_path().unwrap(),
            Some("c:\\app.exe".to_string())
        );
        // 封账后返回 None
        db.close_current_event("2026-08-26 10:00:05").unwrap();
        assert_eq!(db.active_event_app_path().unwrap(), None);
        remove(&p);
    }

    #[test]
    fn heartbeat_splits_on_active_flip() {
        let p = temp_db("flip");
        remove(&p);
        let db = TimetrackerDb::open(&p).unwrap();
        let app_id = db.upsert_app("c:\\c.exe", "C", "dev", None).unwrap();
        db.start_event(app_id, "t", "2026-08-26 10:00:00")
            .unwrap();

        // 活跃持续 15s：单段，end_time NULL
        db.update_current_event("2026-08-26 10:00:15", true)
            .unwrap();
        // 翻转为挂机：应封账旧段（dur≈30、end 写入）、开新段（is_active=0）
        db.update_current_event("2026-08-26 10:00:30", false)
            .unwrap();
        let rows: Vec<(i64, Option<String>, i64, i32)> = db
            .conn
            .prepare("SELECT duration_sec, end_time, is_active, id FROM events ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(rows.len(), 2, "活跃/挂机翻转应切成两段");
        let r0 = &rows[0];
        let r1 = &rows[1];
        let dur0 = r0.0;
        let end0 = r0.1.clone();
        let act0 = r0.2;
        let _dur1 = r1.0; // 该断言只关心 act/end 与封账语义，时长值未直接使用
        let end1 = r1.1.clone();
        let act1 = r1.2;
        assert!(dur0 >= 28 && dur0 <= 30, "旧活跃段时长≈30s，实际 {dur0}");
        assert!(end0.is_some(), "旧段应已封账");
        assert_eq!(act0, 1);
        assert_eq!(act1, 0, "新段应为挂机标记");
        assert!(end1.is_none(), "新段仍进行中");

        // 挂机继续：extend 新段（不切），时长增长、仍进行中
        db.update_current_event("2026-08-26 10:00:45", false)
            .unwrap();
        let (dur1, end1): (i64, Option<String>) = db
            .conn
            .query_row("SELECT duration_sec, end_time FROM events WHERE id = (SELECT MAX(id) FROM events)", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert!(dur1 >= 13 && dur1 <= 15, "挂机段时长≈15s，实际 {dur1}");
        assert!(end1.is_none(), "状态未变不封账");

        remove(&p);
    }

    #[test]
    fn merge_duplicate_apps_merges_same_product() {
        let p = temp_db("merge");
        remove(&p);
        let db = TimetrackerDb::open(&p).unwrap();
        // 电脑管家场景：主 exe + 多个子组件 exe，各自有事件
        let main = db
            .upsert_app("d:\\qqpcmgr\\qqpctray.exe", "qqpctray", "efficiency", Some("腾讯电脑管家"))
            .unwrap();
        let sub = db
            .upsert_app("d:\\qqpcmgr\\qmhwdetect.exe", "qmhwdetect", "efficiency", Some("腾讯电脑管家-硬件检测"))
            .unwrap();
        let other = db
            .upsert_app("c:\\tools\\notepad.exe", "notepad", "dev", Some("记事本"))
            .unwrap();
        // 同主名第二 exe
        let dup = db
            .upsert_app("d:\\qqpcmgr\\qmui.exe", "qmui", "efficiency", Some("腾讯电脑管家"))
            .unwrap();
        for id in [main, sub, other, dup] {
            db.start_event(id, "t", "2026-08-26 10:00:00").unwrap();
        }

        let merged = db.merge_duplicate_apps().unwrap();
        assert_eq!(merged, 2, "硬件检测归入主名 + 同名 qmui 归入主行");

        // 电脑管家的 3 条事件指向主行；无关应用（记事本）事件不受影响
        let rows: Vec<i64> = db
            .conn
            .prepare("SELECT app_id FROM events")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let mut rows = rows;
        rows.sort_unstable();
        assert_eq!(rows, vec![main, main, main, other], "管家事件归主行，记事本保留");
        // 只剩主行 + 无关应用
        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM apps", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);

        // 增量查找：新 exe 解析出子组件名 → 归到主行
        assert_eq!(db.find_merge_target("腾讯电脑管家-网络测速").unwrap(), Some(main));
        // 精确同名 → 归主行
        assert_eq!(db.find_merge_target("腾讯电脑管家").unwrap(), Some(main));
        // 无关名字 → None
        assert_eq!(db.find_merge_target("QQ音乐").unwrap(), None);
        // ASCII 紧贴不算子组件（Google ChromeBeta 不被并入 Google Chrome）
        assert_eq!(db.find_merge_target("Google ChromeBeta").unwrap(), None);

        remove(&p);
    }
}
