//! 峰/谷计价时段数学（借鉴 dsh-cost-meter 的官方口径，纯函数便于测试）。
//!
//! 官方规则（2026-08 起，DeepSeek 开放平台）：
//! - 峰时段：UTC 01:00–04:00、06:00–10:00；其余为谷时段（谷价 = 峰价一半）
//! - 换算北京时间（UTC+8）：09:00–12:00、14:00–18:00 为峰时段
//! - 2026-08-23 起周末（周六/周日，按北京日历）全天按谷价计费
//!
//! 所有判定都锚定北京时区（FixedOffset +8），与用户机器时区无关，保证跨时区一致。

use chrono::{DateTime, Datelike, Duration, FixedOffset, NaiveDate, Timelike, Utc, Weekday};

pub const BEIJING_OFFSET: i32 = 8 * 3600;

fn bj(now: DateTime<Utc>) -> DateTime<FixedOffset> {
    now.with_timezone(&FixedOffset::east_opt(BEIJING_OFFSET).unwrap())
}

/// 计价档位
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PricingTier {
    /// 峰时段（高价）
    Peak,
    /// 谷时段（半价；含周末全天）
    Valley,
}

impl PricingTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            PricingTier::Peak => "peak",
            PricingTier::Valley => "valley",
        }
    }
}

/// 今天（北京日历）是否周末
pub fn is_weekend(date: NaiveDate) -> bool {
    matches!(date.weekday(), Weekday::Sat | Weekday::Sun)
}

/// 工作日的峰时段边界（北京时间分钟数，当日 0 点起）：09:00 / 12:00 / 14:00 / 18:00
const WEEKDAY_BOUNDARIES_MIN: [(u32, PricingTier); 4] = [
    (9 * 60, PricingTier::Peak),
    (12 * 60, PricingTier::Valley),
    (14 * 60, PricingTier::Peak),
    (18 * 60, PricingTier::Valley),
];

/// 当前计价档位（北京时间）
pub fn tier_at(now: DateTime<Utc>) -> PricingTier {
    let t = bj(now);
    if is_weekend(t.date_naive()) {
        return PricingTier::Valley;
    }
    let mins = t.hour() * 60 + t.minute();
    if (9 * 60..12 * 60).contains(&mins) || (14 * 60..18 * 60).contains(&mins) {
        PricingTier::Peak
    } else {
        PricingTier::Valley
    }
}

/// 下一次档位切换的时刻与切换后的档位（北京时间锚定）
pub fn next_boundary(now: DateTime<Utc>) -> (DateTime<Utc>, PricingTier) {
    let t = bj(now);
    let date = t.date_naive();
    let mins_now = t.hour() * 60 + t.minute();

    if !is_weekend(date) {
        // 工作日：找今天剩余的边界
        for (m, tier) in WEEKDAY_BOUNDARIES_MIN {
            if m > mins_now {
                return (at_minute(date, m), tier);
            }
        }
        // 今天已无边界：次日 09:00 或周一 09:00（若今天是周五）
        let next = next_workday(date, 1);
        return (at_minute(next, WEEKDAY_BOUNDARIES_MIN[0].0), PricingTier::Peak);
    }
    // 周末全天谷价：下一边界为下周一 09:00 进入峰时段
    let mut d = date + Duration::days(1);
    while is_weekend(d) {
        d = d + Duration::days(1);
    }
    (at_minute(d, WEEKDAY_BOUNDARIES_MIN[0].0), PricingTier::Peak)
}

/// 从今天起第 n 个工作日（n>=1）
fn next_workday(from: NaiveDate, mut n: i64) -> NaiveDate {
    let mut d = from;
    while n > 0 {
        d = d + Duration::days(1);
        if !is_weekend(d) {
            n -= 1;
        }
    }
    d
}

/// 某日某分钟（0 点起）转 UTC 时刻
fn at_minute(date: NaiveDate, minutes: u32) -> DateTime<Utc> {
    let naive = date
        .and_hms_opt(minutes / 60, minutes % 60, 0)
        .expect("valid hms");
    naive
        .and_local_timezone(FixedOffset::east_opt(BEIJING_OFFSET).unwrap())
        .earliest()
        .expect("valid offset datetime")
        .with_timezone(&Utc)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
        // 入参为北京时间，转 UTC 测试
        let naive = chrono::NaiveDate::from_ymd_opt(y, mo, d)
            .unwrap()
            .and_hms_opt(h, mi, 0)
            .unwrap();
        naive
            .and_local_timezone(FixedOffset::east_opt(BEIJING_OFFSET).unwrap())
            .earliest()
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn tier_weekday_peak_windows() {
        // 周三 10:00 北京 = 峰
        assert_eq!(tier_at(utc(2026, 8, 19, 10, 0)), PricingTier::Peak);
        // 周三 08:00 北京 = 谷
        assert_eq!(tier_at(utc(2026, 8, 19, 8, 0)), PricingTier::Valley);
        // 周三 12:30 北京 = 谷
        assert_eq!(tier_at(utc(2026, 8, 19, 12, 30)), PricingTier::Valley);
        // 周三 15:00 北京 = 峰
        assert_eq!(tier_at(utc(2026, 8, 19, 15, 0)), PricingTier::Peak);
        // 周三 18:30 北京 = 谷
        assert_eq!(tier_at(utc(2026, 8, 19, 18, 30)), PricingTier::Valley);
    }

    #[test]
    fn tier_weekend_all_valley() {
        // 2026-08-22 是周六：14:00 北京仍在峰窗口内，但周末全天谷价
        let sat = chrono::NaiveDate::from_ymd_opt(2026, 8, 22).unwrap();
        assert_eq!(sat.weekday(), Weekday::Sat);
        assert!(is_weekend(sat));
        assert_eq!(tier_at(utc(2026, 8, 22, 14, 0)), PricingTier::Valley);
        // 周日同理
        assert_eq!(tier_at(utc(2026, 8, 23, 10, 0)), PricingTier::Valley);
    }

    #[test]
    fn next_boundary_weekday() {
        // 周三 10:00 → 12:00 谷
        let (t, tier) = next_boundary(utc(2026, 8, 19, 10, 0));
        assert_eq!(tier, PricingTier::Valley);
        assert_eq!(t, utc(2026, 8, 19, 12, 0));
        // 周三 15:00 → 18:00 谷
        let (t, tier) = next_boundary(utc(2026, 8, 19, 15, 0));
        assert_eq!(tier, PricingTier::Valley);
        assert_eq!(t, utc(2026, 8, 19, 18, 0));
        // 周三 18:30 → 周四 09:00 峰
        let (t, tier) = next_boundary(utc(2026, 8, 19, 18, 30));
        assert_eq!(tier, PricingTier::Peak);
        assert_eq!(t, utc(2026, 8, 20, 9, 0));
    }

    #[test]
    fn next_boundary_friday_jumps_monday() {
        // 2026-08-21 是周五：18:30 后越过周末，直接到周一 09:00 峰
        let fri = chrono::NaiveDate::from_ymd_opt(2026, 8, 21).unwrap();
        assert_eq!(fri.weekday(), Weekday::Fri);
        let (t, tier) = next_boundary(utc(2026, 8, 21, 18, 30));
        assert_eq!(tier, PricingTier::Peak);
        assert_eq!(t, utc(2026, 8, 24, 9, 0));
    }

    #[test]
    fn next_boundary_weekend_to_monday() {
        // 周六任意时刻 → 周一 09:00 峰
        let (t, tier) = next_boundary(utc(2026, 8, 22, 20, 0));
        assert_eq!(tier, PricingTier::Peak);
        assert_eq!(t, utc(2026, 8, 24, 9, 0));
    }
}