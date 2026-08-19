//! 余额历史存储：与 QuotaMonitor 的「余额记录.json」同构（records: [{time, balance}]），
//! 便于迁移旧数据。统计基于相邻记录余额下降之和。

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Record {
    pub time: DateTime<Utc>,
    pub balance: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HistoryDoc {
    pub records: Vec<Record>,
}

pub fn load(path: &Path) -> Vec<Record> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str::<HistoryDoc>(&text)
            .map(|d| d.records)
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save(path: &Path, records: &[Record]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string(&HistoryDoc {
        records: records.to_vec(),
    })?;
    fs::write(path, json)
}

/// 追加一条记录；相同余额仅刷新时间戳（去重）
pub fn append(path: &Path, balance: f64, time: DateTime<Utc>) {
    let mut records = load(path);
    if let Some(last) = records.last_mut() {
        if last.balance == balance {
            last.time = time;
            let _ = save(path, &records);
            return;
        }
    }
    records.push(Record { time, balance });
    if records.len() > 5000 {
        records = records.split_off(records.len() - 2500);
    }
    let _ = save(path, &records);
}

fn spent_since(records: &[Record], from: NaiveDate) -> f64 {
    let mut spent = 0.0;
    for i in 1..records.len() {
        let t = records[i].time.date_naive();
        if t < from {
            continue;
        }
        let d = records[i - 1].balance - records[i].balance;
        if d > 0.0 {
            spent += d;
        }
    }
    spent
}

/// 今日消费（本地零点起，余额下降之和）
pub fn today_spend(records: &[Record], today: NaiveDate) -> f64 {
    spent_since(records, today)
}

/// 近 days 天日均消费（不含今天），按实际有记录的日期数平均
pub fn avg_daily_spent(records: &[Record], days: i64, today: NaiveDate) -> f64 {
    let start = today - Duration::days(days);
    let mut spent = 0.0;
    let mut days_with_data = 0usize;
    for i in 1..records.len() {
        let t = records[i].time.date_naive();
        if t < start || t >= today {
            continue;
        }
        let d = records[i - 1].balance - records[i].balance;
        if d > 0.0 {
            spent += d;
        }
    }
    let mut seen = None;
    for r in records {
        let t = r.time.date_naive();
        if t < start || t >= today {
            continue;
        }
        if seen != Some(t) {
            days_with_data += 1;
            seen = Some(t);
        }
    }
    if days_with_data == 0 {
        0.0
    } else {
        spent / days_with_data as f64
    }
}

/// 近 days 天每日消费序列：[0]=最远一天 ... [days-1]=今天；
/// 返回 (日期字符串, 金额)；无记录或有余额上升的日期为 0
pub fn daily_series(records: &[Record], days: u32, today: NaiveDate) -> Vec<(String, f64)> {
    let mut result = vec![0.0; days as usize];
    for i in 1..records.len() {
        let t = records[i].time.date_naive();
        let idx = (today - t).num_days();
        if idx < 0 || idx >= days as i64 {
            continue;
        }
        let d = records[i - 1].balance - records[i].balance;
        if d > 0.0 {
            result[(days as i64 - 1 - idx) as usize] += d;
        }
    }
    (0..days)
        .map(|k| {
            let date = today - Duration::days((days - 1 - k) as i64);
            (date.format("%m-%d").to_string(), result[k as usize])
        })
        .collect()
}

/// 完整消费时间线：从最早有记录的日期到今天，每日消费序列 [0]=最早 ... [n-1]=今天；
/// 无记录或有余额上升的日期为 0
pub fn daily_series_all(records: &[Record], today: NaiveDate) -> Vec<(String, f64)> {
    let mut first: Option<NaiveDate> = None;
    for r in records {
        let t = r.time.date_naive();
        if t > today {
            continue;
        }
        first = Some(match first {
            Some(f) => f.min(t),
            None => t,
        });
    }
    let Some(first) = first else {
        return Vec::new();
    };
    let days = (today - first).num_days() as u32 + 1;
    daily_series(records, days, today)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(t: NaiveDate, balance: f64) -> Record {
        Record {
            time: t.and_hms_opt(12, 0, 0).unwrap().and_utc(),
            balance,
        }
    }

    fn tmp_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("easytool-quota-test-{}", std::process::id()))
    }

    #[test]
    fn append_dedups_equal_balance() {
        let path = tmp_path().join("h.json");
        let _ = fs::remove_file(&path);
        let t1 = NaiveDate::from_ymd_opt(2026, 8, 18)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap()
            .and_utc();
        let t2 = NaiveDate::from_ymd_opt(2026, 8, 18)
            .unwrap()
            .and_hms_opt(20, 0, 0)
            .unwrap()
            .and_utc();
        append(&path, 100.0, t1);
        append(&path, 100.0, t2); // 同值仅刷新时间
        let records = load(&path);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].time, t2);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn daily_stats() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 19).unwrap();
        // 8/17: 100 -> 90（-10），8/18: 90 -> 85（-5），8/19: 85 -> 100（充值，不算消费）
        let records = vec![
            rec(NaiveDate::from_ymd_opt(2026, 8, 17).unwrap(), 100.0),
            rec(NaiveDate::from_ymd_opt(2026, 8, 17).unwrap(), 90.0),
            rec(NaiveDate::from_ymd_opt(2026, 8, 18).unwrap(), 85.0),
            rec(NaiveDate::from_ymd_opt(2026, 8, 19).unwrap(), 100.0),
        ];
        assert_eq!(today_spend(&records, today), 0.0); // 今日无消费
        assert!((avg_daily_spent(&records, 7, today) - 7.5).abs() < 1e-9); // (10+5)/2
        let series = daily_series(&records, 14, today);
        assert_eq!(series.len(), 14);
        assert_eq!(series[13].1, 0.0); // 今天
        assert_eq!(series[12].1, 5.0); // 昨天
        assert_eq!(series[11].1, 10.0); // 前天
    }
}