//! 统计聚合查询（自 db.rs 拆出）：日/周/月榜单、概览、每日趋势、时间线、应用详情

use chrono::Datelike;
use rusqlite::params;

use super::db::{day_start, next_day_start, TimetrackerDb};
use super::models::{App, DailyStat, DayOverview, Event};

impl TimetrackerDb {
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
}
