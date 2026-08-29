//! RRULE 展开：只保留"把规则字符串拆成字段"的薄解析，日期运算全部委托给成熟的
//! [rrule](https://crates.io/crates/rrule) crate（RFC 5545 实现，rrule.js 的 Rust 移植，
//! 处理 BYDAY/INTERVAL/UNTIL/每期计数等边界情况，无需自己搬日历算法）。
//! 兼容说明：crate 遵循 RFC（如"每月 31 日"在无 31 日的月份被跳过），
//! 按设计文档在此补回"钳制到月末"（手机日历习惯）；不支持的年/日级规则降级为单次。

use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveDateTime, TimeZone, Utc, Weekday};
use rrule::{Frequency, NWeekday, RRule, Tz};

pub struct Rrule {
    pub freq: Freq,
    pub byday: Vec<NWeekday>,
    pub until_utc: Option<NaiveDateTime>,
    pub interval: u32,
    pub count: Option<u32>,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
}

const MAX_OCCURRENCES: u16 = 500;

fn weekday_from_code(s: &str) -> Option<Weekday> {
    Some(match s.to_uppercase().as_str() {
        "MO" => Weekday::Mon,
        "TU" => Weekday::Tue,
        "WE" => Weekday::Wed,
        "TH" => Weekday::Thu,
        "FR" => Weekday::Fri,
        "SA" => Weekday::Sat,
        "SU" => Weekday::Sun,
        _ => return None,
    })
}

/// 解析 BYDAY 单项：数字前缀 = 第 N 个星期 X（如 "1MO"/"-1FR"），否则 = 每周该天
fn byday_item(s: &str) -> Option<NWeekday> {
    let s = s.trim();
    let (num, code) = if let Some(stripped) = s.strip_prefix(['+', '-']) {
        // 只接一个符号位
        let sign = if s.starts_with('-') { -1 } else { 1 };
        let digits: String = stripped.chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() {
            return None;
        }
        let n: i16 = digits.parse().ok()?;
        (Some(sign * n), &stripped[digits.len()..])
    } else {
        let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() {
            (None, s)
        } else {
            (Some(digits.parse().ok()?), &s[digits.len()..])
        }
    };
    Some(match num {
        Some(n) => NWeekday::Nth(n, weekday_from_code(code)?),
        None => NWeekday::Every(weekday_from_code(code)?),
    })
}

/// 解析 RRULE 字符串 → 本模块字段（供 rrule crate 构造用）；不支持的频率返回 None
pub fn parse_rule(rule: &str) -> Option<Rrule> {
    let mut freq: Option<Freq> = None;
    let mut byday: Vec<NWeekday> = Vec::new();
    let mut until_utc: Option<NaiveDateTime> = None;
    let mut interval: u32 = 1;
    let mut count: Option<u32> = None;
    for part in rule.split(';') {
        let (k, v) = part.split_once('=')?;
        match k.to_uppercase().as_str() {
            "FREQ" => {
                freq = Some(match v.to_uppercase().as_str() {
                    "DAILY" => Freq::Daily,
                    "WEEKLY" => Freq::Weekly,
                    "MONTHLY" => Freq::Monthly,
                    _ => return None, // YEARLY 等暂不支持（降级单次）
                });
            }
            "BYDAY" => {
                match freq {
                    None => return None, // BYDAY 在 FREQ 之前 → 无法判定
                    Some(Freq::Daily) => return None,
                    Some(_) => {}
                }
                for code in v.split(',') {
                    byday.push(byday_item(code)?);
                }
            }
            "UNTIL" => until_utc = parse_datetime_str(v),
            "INTERVAL" => {
                interval = v.parse().ok()?;
                if interval == 0 {
                    return None;
                }
            }
            "COUNT" => {
                count = Some(v.parse().ok()?);
                if count == Some(0) {
                    return None;
                }
            }
            "BYMONTH" | "BYMONTHDAY" | "BYSETPOS" | "WKST" | "BYHOUR" | "BYMINUTE"
            | "BYSECOND" => return None, // 超出当前 UI 范围
            _ => {} // 忽略未知键
        }
    }
    let freq = freq?;
    Some(Rrule { freq, byday, until_utc, interval, count })
}

fn parse_datetime_str(v: &str) -> Option<NaiveDateTime> {
    if v.len() >= 8 {
        let y: i32 = v[0..4].parse().ok()?;
        let m: u32 = v[4..6].parse().ok()?;
        let d: u32 = v[6..8].parse().ok()?;
        let (h, mi, s) = if v.len() >= 15 {
            (v[9..11].parse().ok()?, v[11..13].parse().ok()?, v[13..15].parse().ok()?)
        } else {
            (0, 0, 0)
        };
        return NaiveDate::from_ymd_opt(y, m, d)?.and_hms_opt(h, mi, s);
    }
    None
}

/// 展开 start（本地墙钟）之后的全部实例；不支持的规则/空结果 → 返回 [start]（单次）
pub fn expand(start: NaiveDateTime, rule: &str) -> Vec<NaiveDateTime> {
    let Some(rr) = parse_rule(rule) else {
        return vec![start];
    };
    let mut builder = RRule::new(match rr.freq {
        Freq::Daily => Frequency::Daily,
        Freq::Weekly => Frequency::Weekly,
        Freq::Monthly => Frequency::Monthly,
    })
    .interval(rr.interval as u16);
    if !rr.byday.is_empty() {
        builder = builder.by_weekday(rr.byday.clone());
    }
    if let Some(u) = rr.until_utc {
        builder = builder.until(Tz::UTC.from_utc_datetime(&u));
    }
    if let Some(c) = rr.count {
        builder = builder.count(c);
    }
    let Ok(set) = builder.build(start_tz(start)) else {
        return vec![start];
    };
    let mut out: Vec<NaiveDateTime> = set
        .all(MAX_OCCURRENCES)
        .dates
        .into_iter()
        .map(from_utc)
        .collect();
    // 设计约定：每月同日遇不足月钳制到月末（crate 按 RFC 跳过），仅对"每月同日"生效
    if rr.freq == Freq::Monthly && rr.byday.is_empty() {
        out = clamp_monthly_same_day(start, out);
    }
    if out.is_empty() {
        vec![start]
    } else {
        out
    }
}

/// 本地墙钟 → UTC
fn to_utc(naive: NaiveDateTime) -> chrono::DateTime<Utc> {
    Local
        .from_local_datetime(&naive)
        .earliest()
        .unwrap_or_else(|| Local.timestamp_opt(0, 0).earliest().unwrap())
        .with_timezone(&Utc)
}

/// 本地墙钟 → rrule 使用的 UTC（chrono DateTime<Tz>，Tz 为 rrule 重导出的时区枚举）
fn start_tz(naive: NaiveDateTime) -> DateTime<Tz> {
    Tz::UTC.from_utc_datetime(&to_utc(naive).naive_utc())
}

/// rrule 输出（UTC）→ 本地墙钟
fn from_utc(dt: DateTime<Tz>) -> NaiveDateTime {
    Local.from_utc_datetime(&dt.naive_utc()).naive_local()
}

/// 本地墙钟 → 毫秒（命令层展开实例用）
pub fn local_to_ts(naive: NaiveDateTime) -> i64 {
    to_utc(naive).timestamp_millis()
}

/// 本地墙钟 → 本地日键 yyyymmdd
pub fn local_day_key(naive: NaiveDateTime) -> i64 {
    use chrono::Datelike;
    naive.year() as i64 * 10000 + naive.month() as i64 * 100 + naive.day() as i64
}

/// 毫秒 → 本地墙钟
pub fn ts_to_local(ms: i64) -> NaiveDateTime {
    Local.timestamp_millis_opt(ms).earliest().map(|d| d.naive_local()).unwrap_or_else(|| {
        Local.timestamp_opt(0, 0).earliest().unwrap().naive_local()
    })
}

/// MONTHLY 同日钳制：为缺失 base_day 的月份补"该月最后一天同时间"的实例
fn clamp_monthly_same_day(start: NaiveDateTime, mut out: Vec<NaiveDateTime>) -> Vec<NaiveDateTime> {
    if out.is_empty() {
        return out;
    }
    let base_day = start.day();
    let last = *out.last().unwrap();
    // 现有月份集合
    let mut months: std::collections::BTreeSet<(i32, u32)> = out
        .iter()
        .map(|d| (d.year(), d.month()))
        .collect();
    let mut cur = start.date();
    while cur <= last.date() {
        let max = days_in_month(cur.year(), cur.month());
        let key = (cur.year(), cur.month());
        if base_day > max && !months.contains(&key) {
            let clamped = NaiveDate::from_ymd_opt(cur.year(), cur.month(), max)
                .unwrap()
                .and_time(start.time());
            if clamped >= start {
                out.push(clamped);
                months.insert(key);
            }
        }
        cur = next_month(cur);
    }
    out.sort_unstable();
    out
}

fn days_in_month(y: i32, m: u32) -> u32 {
    if m == 12 {
        NaiveDate::from_ymd_opt(y, 12, 31).unwrap().day()
    } else {
        NaiveDate::from_ymd_opt(y, m + 1, 1).unwrap().pred_opt().unwrap().day()
    }
}

fn next_month(date: NaiveDate) -> NaiveDate {
    let (y, m) = (date.year(), date.month());
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    NaiveDate::from_ymd_opt(ny, nm, 1).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    fn naive(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    #[test]
    fn weekly_byday_and_until() {
        // 每周一三五（起始周二，9/15）→ 首例应为 9/16 周三
        let weeks = expand(
            naive("2026-09-15 08:30"),
            "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260930T160000Z",
        );
        assert_eq!(weeks[0], naive("2026-09-16 08:30"));
        assert_eq!(weeks[1], naive("2026-09-18 08:30"));
        assert_eq!(weeks[2], naive("2026-09-21 08:30"));
        // UNTIL UTC 含界：9/30 08:30 本地 = 00:30Z ≤ 16:00Z → 包含；下一周 10/5 超出
        assert!(weeks.iter().all(|d| *d <= naive("2026-09-30 08:30")));
    }

    #[test]
    fn weekly_same_weekday_default() {
        let days = expand(naive("2026-09-15 08:30"), "FREQ=WEEKLY;UNTIL=20261015T160000Z");
        // 周二 9/15,9/22,9/29,10/6,10/13
        assert_eq!(days.len(), 5);
        assert_eq!(days[0], naive("2026-09-15 08:30"));
        assert_eq!(days[4].day(), 13);
    }

    #[test]
    fn daily_monthly_clamp_and_interval() {
        // 每天，UNTIL 为 UTC 零点 → 含 9/1~9/4（9/5 01:00Z 超界）
        assert_eq!(expand(naive("2026-09-01 09:00"), "FREQ=DAILY;UNTIL=20260905T000000Z").len(), 4);
        // 每月 31 日：crate 跳过不足月，钳制补 2/28、4/30
        let m = expand(naive("2026-01-31 10:00"), "FREQ=MONTHLY;UNTIL=20260601T000000Z");
        assert_eq!(m[0].day(), 31);
        assert_eq!(m[1].day(), 28); // 2026-02-28 钳制
        assert_eq!(m[2].day(), 31);
        assert_eq!(m[3].day(), 30); // 2026-04-30 钳制
        // 隔周（INTERVAL=2）由 crate 处理
        let bi = expand(naive("2026-09-01 08:00"), "FREQ=WEEKLY;INTERVAL=2;UNTIL=20261015T160000Z");
        assert!(bi.len() >= 2);
        assert_eq!(bi[1] - bi[0], chrono::Duration::days(14));
    }

    #[test]
    fn monthly_nth_weekday() {
        // 每月第一个周一，起始 2026-09-01：9/7,10/5,11/2
        let m = expand(naive("2026-09-01 09:00"), "FREQ=MONTHLY;BYDAY=1MO;UNTIL=20261115T160000Z");
        assert_eq!(m[0], naive("2026-09-07 09:00"));
        assert_eq!(m[1], naive("2026-10-05 09:00"));
    }

    #[test]
    fn count_supported_and_unsupported_freq() {
        // COUNT=3 由 crate 处理
        assert_eq!(expand(naive("2026-09-01 08:00"), "FREQ=DAILY;COUNT=3").len(), 3);
        // YEARLY 不在支持集 → 降级单次
        assert_eq!(expand(naive("2026-09-01 08:00"), "FREQ=YEARLY").len(), 1);
        assert!(parse_rule("FREQ=YEARLY").is_none());
    }
}