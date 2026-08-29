//! 智能告警判定（纯函数，便于测试）：
//! 1. 余额不足 —— 余额从充足跌到预警线以下时提醒一次，恢复后自动重置
//! 2. 消费突增 —— 今日消费超过近 7 天日均消费 3 倍时提醒，每天最多一次

/// 是否触发余额不足提醒：仅当上次余额不低于阈值、本次跌破阈值时返回 true
/// （prev=None 表示首次查询，不提醒，避免启动轰炸）
pub fn should_warn_balance(prev: Option<f64>, cur: f64, threshold: f64) -> bool {
    match prev {
        Some(p) => p >= threshold && cur < threshold,
        None => false,
    }
}

/// 是否触发余额恢复提醒：仅当上次余额低于阈值、本次回升到阈值及以上时返回 true
/// （prev=None 表示首次查询，不提醒，避免启动轰炸）
pub fn should_recover(prev: Option<f64>, cur: f64, threshold: f64) -> bool {
    match prev {
        Some(p) => p < threshold && cur >= threshold,
        None => false,
    }
}

/// 是否触发消费突增提醒：今日消费 > 近 7 天日均 * 3
/// （无历史基线或今日无消费时不判断）
pub fn is_spike(today_spend: f64, avg_7d: f64) -> bool {
    avg_7d > 0.0 && today_spend > 0.0 && today_spend > avg_7d * 3.0
}

// ---------- 每日预算（借鉴 dsh-cost-meter 的预算图框口径） ----------

/// 预算消耗档位：未达预警 / 达预警 / 超支
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd)]
pub enum BudgetStage {
    None = 0,
    Warn = 1,
    Critical = 2,
}

/// 按今日消费额与预算/阈值百分比计算当前档位
pub fn budget_stage(today_spend: f64, budget: f64, warn_pct: f64, critical_pct: f64) -> BudgetStage {
    if budget <= 0.0 || today_spend < 0.0 {
        return BudgetStage::None;
    }
    let pct = if budget > 0.0 { today_spend / budget * 100.0 } else { 0.0 };
    if critical_pct > 0.0 && pct >= critical_pct {
        BudgetStage::Critical
    } else if warn_pct > 0.0 && pct >= warn_pct {
        BudgetStage::Warn
    } else {
        BudgetStage::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warn_only_at_crossing() {
        assert!(!should_warn_balance(Some(20.0), 15.0, 10.0)); // 未低于阈值
        assert!(should_warn_balance(Some(20.0), 8.0, 10.0)); // 临界
        assert!(!should_warn_balance(Some(8.0), 5.0, 10.0)); // 已在下方，不重复
        assert!(!should_warn_balance(Some(5.0), 12.0, 10.0)); // 恢复后不提醒
        assert!(!should_warn_balance(None, 5.0, 10.0)); // 首次不提醒
    }

    #[test]
    fn spike_detection() {
        assert!(is_spike(10.0, 3.0)); // 10 > 3*3
        assert!(!is_spike(9.0, 3.0)); // 9 == 3*3 不算
        assert!(!is_spike(5.0, 0.0)); // 无历史不算
        assert!(!is_spike(0.0, 3.0)); // 今日无消费不算
        assert!(!is_spike(1.0, 1.0));
    }

    #[test]
    fn recover_only_at_crossing() {
        assert!(should_recover(Some(8.0), 12.0, 10.0)); // 临界恢复
        assert!(!should_recover(Some(20.0), 15.0, 10.0)); // 从未低于阈值
        assert!(!should_recover(Some(12.0), 8.0, 10.0)); // 从上方跌落，不算恢复
        assert!(!should_recover(Some(5.0), 8.0, 10.0)); // 仍低于阈值，不重复
        assert!(!should_recover(None, 12.0, 10.0)); // 首次不提醒
    }

    #[test]
    fn budget_stage_levels() {
        // 未达预警
        assert_eq!(budget_stage(5.0, 100.0, 80.0, 100.0), BudgetStage::None);
        // 临界处（>=）：80% 整
        assert_eq!(budget_stage(80.0, 100.0, 80.0, 100.0), BudgetStage::Warn);
        // 超支：100% 与 120%
        assert_eq!(budget_stage(100.0, 100.0, 80.0, 100.0), BudgetStage::Critical);
        assert_eq!(budget_stage(120.0, 100.0, 80.0, 100.0), BudgetStage::Critical);
        // 预算未设置（0）恒为 None
        assert_eq!(budget_stage(50.0, 0.0, 80.0, 100.0), BudgetStage::None);
        // 无消费
        assert_eq!(budget_stage(0.0, 100.0, 80.0, 100.0), BudgetStage::None);
    }
}