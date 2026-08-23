//! 余额历史存储：SQLite（quota.db）持久化。统计基于相邻记录余额下降之和。
//! 纯统计函数（today_spend/avg_daily_spent/daily_series）与存储解耦，便于测试。

use chrono::{DateTime, Duration, Local, NaiveDate, Utc};

use super::db::QuotaDb;

#[derive(Debug, Clone)]
pub struct Record {
    pub time: DateTime<Utc>,
    pub balance: f64,
}

/// 记录归属的本地日历日：存储为 UTC，统计一律按本地时区日界切桶
/// （否则 UTC+8 下本地 0-8 点的消费会被记到前一天）
fn local_day(t: DateTime<Utc>) -> NaiveDate {
    t.with_timezone(&Local).date_naive()
}

/// 按时间升序读取余额历史
pub fn load(db: &QuotaDb, account_id: &str) -> Vec<Record> {
    db.load_balance(account_id)
        .unwrap_or_default()
        .into_iter()
        .map(|(time_ms, balance, _granted, _topped_up)| Record {
            time: DateTime::from_timestamp_millis(time_ms).unwrap_or_else(Utc::now),
            balance,
        })
        .collect()
}

/// 追加一条记录；相同余额仅刷新时间戳（去重）
pub fn append(
    db: &QuotaDb,
    account_id: &str,
    balance: f64,
    granted: f64,
    topped_up: f64,
    time: DateTime<Utc>,
) {
    let _ = db.append_balance(account_id, balance, granted, topped_up, time.timestamp_millis());
}

fn spent_since(records: &[Record], from: NaiveDate) -> f64 {
    let mut spent = 0.0;
    for i in 1..records.len() {
        let t = local_day(records[i].time);
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
        let t = local_day(records[i].time);
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
        let t = local_day(r.time);
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
        let t = local_day(records[i].time);
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
        let t = local_day(r.time);
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

    fn mem() -> QuotaDb {
        QuotaDb::open(std::path::Path::new(":memory:")).unwrap()
    }

    #[test]
    fn append_dedups_equal_balance() {
        let db = mem();
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
        append(&db, "a", 100.0, 0.0, 100.0, t1);
        append(&db, "a", 100.0, 0.0, 100.0, t2); // 同值仅刷新时间
        let records = load(&db, "a");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].time, t2);
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
