//! 额度监控命令层：前端 invoke 的入口

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use super::api::GoQuota;
use super::{history, module_config, QuotaState};

#[derive(Debug, Serialize)]
pub struct GoQuotaPayload {
    pub window: String,
    pub used_percent: i32,
    pub resets_at: Option<i64>,
}

impl From<&GoQuota> for GoQuotaPayload {
    fn from(q: &GoQuota) -> Self {
        GoQuotaPayload {
            window: q.window.clone(),
            used_percent: q.used_percent,
            resets_at: q.resets_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StatusPayload {
    pub balance: Option<f64>,
    pub available: bool,
    pub error: Option<String>,
    pub go_windows: Vec<GoQuotaPayload>,
}

/// 当前监控状态（前端轮询刷新）
#[tauri::command]
pub fn get_status(state: State<'_, Mutex<QuotaState>>) -> StatusPayload {
    let st = state.lock().unwrap();
    StatusPayload {
        balance: st.balance,
        available: st.available,
        error: st.error.clone(),
        go_windows: st.go_windows.iter().map(GoQuotaPayload::from).collect(),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuotaSettings {
    pub refresh_interval_sec: i64,
    pub warn_threshold: f64,
    pub notify_low: bool,
    pub notify_surge: bool,
    /// 只读：DeepSeek 密钥是否已配置（来自系统密钥库）
    pub ds_configured: bool,
    /// 只读：OpenCode Go 密钥是否已配置
    pub go_configured: bool,
}

/// 读设置（来自 config）
#[tauri::command]
pub fn get_settings(app: AppHandle) -> QuotaSettings {
    let cfg = module_config(&app);
    let get = |key: &str, default: f64| cfg.get(key).and_then(|v| v.as_f64()).unwrap_or(default);
    let getb = |key: &str, default: bool| {
        cfg.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
    };
    QuotaSettings {
        refresh_interval_sec: get("refresh_interval_sec", 30.0) as i64,
        warn_threshold: get("warn_threshold", 10.0),
        notify_low: getb("notify_low", true),
        notify_surge: getb("notify_surge", true),
        ds_configured: !super::get_key("deepseek").is_empty(),
        go_configured: !super::get_key("opencode-go").is_empty(),
    }
}

/// 保存设置（写入 config）
#[tauri::command]
pub fn save_settings(app: AppHandle, settings: QuotaSettings) -> Result<(), String> {
    {
        let state = app.state::<crate::config::ConfigState>();
        let mut cfg = state.0.lock().unwrap();
        if let Some(v) = cfg.modules.get_mut("quota") {
            v["refresh_interval_sec"] = serde_json::json!(settings.refresh_interval_sec);
            v["warn_threshold"] = serde_json::json!(settings.warn_threshold);
            v["notify_low"] = serde_json::json!(settings.notify_low);
            v["notify_surge"] = serde_json::json!(settings.notify_surge);
        }
        crate::config::save_config(&app, &cfg)?;
    } // ConfigState 锁在此释放，避免 fetch_once 二次加锁死锁

    // 立即按新阈值在后台评估一次告警状态
    if let Some(st_guard) = app.try_state::<Mutex<QuotaState>>() {
        let st = st_guard.lock().unwrap();
        if let Some(b) = st.balance {
            drop(st);
            let app2 = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                super::fetch_once(&app2);
            });
            log::info!(
                "quota settings saved, balance={b} threshold={}",
                settings.warn_threshold
            );
        }
    }
    Ok(())
}

/// 面板卡片顺序（拖拽排序记忆）
#[tauri::command]
pub fn get_panel_order(app: AppHandle) -> Vec<String> {
    let cfg = module_config(&app);
    cfg.get("panel_order")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_else(|| vec!["stats".into(), "chart".into(), "go".into()])
}

/// 保存面板卡片顺序
#[tauri::command]
pub fn save_panel_order(app: AppHandle, order: Vec<String>) -> Result<(), String> {
    {
        let state = app.state::<crate::config::ConfigState>();
        let mut cfg = state.0.lock().unwrap();
        if let Some(v) = cfg.modules.get_mut("quota") {
            v["panel_order"] = serde_json::json!(order);
        }
        crate::config::save_config(&app, &cfg)?;
    }
    Ok(())
}

/// 设置 DeepSeek 密钥（keyring 加密存储）
#[tauri::command]
pub fn set_deepseek_key(app: AppHandle, key: String) -> Result<(), String> {
    super::set_key("deepseek", &key)?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || super::fetch_once(&app2));
    Ok(())
}

/// 设置 OpenCode Go 密钥
#[tauri::command]
pub fn set_go_key(app: AppHandle, key: String) -> Result<(), String> {
    super::set_key("opencode-go", &key)?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || super::fetch_once(&app2));
    Ok(())
}

/// 测试密钥有效性（kind: deepseek / go）
#[tauri::command]
pub async fn test_key(kind: String, key: String) -> Result<String, String> {
    let kind = kind.clone();
    let key = key.clone();
    tauri::async_runtime::spawn_blocking(move || match kind.as_str() {
        "deepseek" => match super::api::fetch_balance(&key) {
            Ok(b) => Ok(format!("有效，当前余额 ¥{:.2}", b.amount)),
            Err(e) => Err(e.to_string()),
        },
        "go" => match super::api::fetch_go_quota(&key) {
            Ok(w) => Ok(format!(
                "有效，{} 个套餐窗口可查询",
                w.len()
            )),
            Err(e) => Err(e.to_string()),
        },
        _ => Err("未知密钥类型".into()),
        })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

#[derive(Debug, Serialize)]
pub struct DailyPoint {
    pub date: String,
    pub amount: f64,
}

#[derive(Debug, Serialize)]
pub struct StatsData {
    pub today: f64,
    pub avg_7d: f64,
    pub daily: Vec<DailyPoint>,
}

/// 统计面板数据：今日消费 / 近7天日均 / 近14天每日序列
#[tauri::command]
pub fn get_stats_data(app: AppHandle) -> StatsData {
    use chrono::Local;
    let records = history::load(&history_path(&app));
    let today = Local::now().date_naive();
    let today_spend = history::today_spend(&records, today);
    let avg7 = history::avg_daily_spent(&records, 7, today);
    let daily = history::daily_series(&records, 14, today)
        .into_iter()
        .map(|(d, a)| DailyPoint { date: d, amount: a })
        .collect();
    StatsData {
        today: today_spend,
        avg_7d: avg7,
        daily,
    }
}

/// 完整消费历史（每日，最早记录日到今天），消费历史时间线用
#[tauri::command]
pub fn get_daily_history(app: AppHandle) -> Vec<DailyPoint> {
    use chrono::Local;
    let records = history::load(&history_path(&app));
    let today = Local::now().date_naive();
    history::daily_series_all(&records, today)
        .into_iter()
        .map(|(d, a)| DailyPoint { date: d, amount: a })
        .collect()
}

use super::history_path;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn go_quota_payload_convert() {
        let q = GoQuota {
            window: "weekly".into(),
            used_percent: 42,
            resets_at: Some(1700000000),
        };
        let p: GoQuotaPayload = (&q).into();
        assert_eq!(p.window, "weekly");
        assert_eq!(p.used_percent, 42);
        assert_eq!(p.resets_at, Some(1700000000));
    }
}