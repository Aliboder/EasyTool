//! 额度监控命令层：前端 invoke 的入口

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use super::api::GoQuota;
use super::db::QuotaDb;
use super::{account_configs, find_account, history, AccountConfig, AccountKind, QuotaState};

#[derive(Debug, Serialize)]
pub struct GoQuotaPayload {
    pub window: String,
    pub used_percent: i32,
    pub resets_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

impl From<&GoQuota> for GoQuotaPayload {
    fn from(q: &GoQuota) -> Self {
        GoQuotaPayload {
            window: q.window.clone(),
            used_percent: q.used_percent,
            resets_at: q.resets_at,
            text: q.text.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AccountPayload {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub balance: Option<f64>,
    pub granted: f64,
    pub topped_up: f64,
    pub available: bool,
    pub error: Option<String>,
    pub go_windows: Vec<GoQuotaPayload>,
}

#[derive(Debug, Serialize)]
pub struct StatusPayload {
    pub accounts: Vec<AccountPayload>,
    /// 今日消费总额（DeepSeek 账户合计；预算条用）
    pub today_spend: f64,
    /// 每日预算（0 = 未设置）
    pub budget: f64,
    pub budget_warn_pct: f64,
    pub budget_critical_pct: f64,
}

/// 当前监控状态（前端轮询刷新）
#[tauri::command]
pub fn get_status(state: State<'_, Mutex<QuotaState>>, app: AppHandle) -> StatusPayload {
    let cfg = crate::config::module_cfg(&app, "quota");
    let get = |key: &str, default: f64| cfg.get(key).and_then(|v| v.as_f64()).unwrap_or(default);
    let st = state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    StatusPayload {
        today_spend: st.today_spend_total,
        budget: get("daily_budget", 0.0),
        budget_warn_pct: get("budget_warn_pct", 80.0),
        budget_critical_pct: get("budget_critical_pct", 100.0),
        accounts: st
            .accounts
            .iter()
            .map(|a| AccountPayload {
                id: a.id.clone(),
                kind: a.kind.as_str().into(),
                name: a.name.clone(),
                balance: a.balance,
                granted: a.granted,
                topped_up: a.topped_up,
                available: a.available,
                error: a.error.clone(),
                go_windows: a.go_windows.iter().map(GoQuotaPayload::from).collect(),
            })
            .collect(),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccountInfo {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub configured: bool,
    /// 自定义 Provider 查询参数（仅 custom 账户有值）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom: Option<super::CustomQuery>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuotaSettings {
    pub refresh_interval_sec: i64,
    pub warn_threshold: f64,
    pub critical_threshold: f64,
    pub notify_low: bool,
    pub notify_surge: bool,
    pub go_ring_remaining: bool,
    /// 每日预算（0 = 关闭）
    pub daily_budget: f64,
    pub budget_warn_pct: f64,
    pub budget_critical_pct: f64,
    pub notify_budget: bool,
    /// 余额三段进度条基准（0 = 自动：充值+赠送）
    pub balance_max: f64,
    /// 峰谷切换提醒
    pub peak_alert_enabled: bool,
    pub peak_alert_minutes: i64,
    pub peak_alert_mode: String,
    pub accounts: Vec<AccountInfo>,
}

/// 读设置（来自 config）
#[tauri::command]
pub fn get_settings(app: AppHandle) -> QuotaSettings {
    let cfg = crate::config::module_cfg(&app, "quota");
    let get = |key: &str, default: f64| cfg.get(key).and_then(|v| v.as_f64()).unwrap_or(default);
    let getb = |key: &str, default: bool| {
        cfg.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
    };
    let warn = get("warn_threshold", 10.0);
    let accounts = account_configs(&app)
        .into_iter()
        .map(|a| AccountInfo {
            id: a.id.clone(),
            kind: a.kind.as_str().into(),
            name: a.name.clone(),
            configured: !super::get_account_key(&a).is_empty(),
            custom: a.custom.clone(),
        })
        .collect();
    QuotaSettings {
        refresh_interval_sec: get("refresh_interval_sec", 30.0) as i64,
        warn_threshold: warn,
        critical_threshold: get("critical_threshold", warn / 2.0),
        notify_low: getb("notify_low", true),
        notify_surge: getb("notify_surge", true),
        go_ring_remaining: getb("go_ring_remaining", false),
        daily_budget: get("daily_budget", 0.0),
        budget_warn_pct: get("budget_warn_pct", 80.0),
        budget_critical_pct: get("budget_critical_pct", 100.0),
        notify_budget: getb("notify_budget", true),
        balance_max: get("balance_max", 0.0),
        peak_alert_enabled: getb("peak_alert_enabled", true),
        peak_alert_minutes: get("peak_alert_minutes", 2.0) as i64,
        peak_alert_mode: cfg
            .get("peak_alert_mode")
            .and_then(|v| v.as_str())
            .unwrap_or("both")
            .into(),
        accounts,
    }
}

/// 保存设置（写入 config）
#[tauri::command]
pub fn save_settings(app: AppHandle, settings: QuotaSettings) -> Result<(), String> {
    crate::config::update_module(&app, "quota", |v| {
        v["refresh_interval_sec"] = serde_json::json!(settings.refresh_interval_sec);
        v["warn_threshold"] = serde_json::json!(settings.warn_threshold);
        v["critical_threshold"] = serde_json::json!(settings.critical_threshold);
        v["notify_low"] = serde_json::json!(settings.notify_low);
        v["notify_surge"] = serde_json::json!(settings.notify_surge);
        v["go_ring_remaining"] = serde_json::json!(settings.go_ring_remaining);
        v["daily_budget"] = serde_json::json!(settings.daily_budget);
        v["budget_warn_pct"] = serde_json::json!(settings.budget_warn_pct);
        v["budget_critical_pct"] = serde_json::json!(settings.budget_critical_pct);
        v["notify_budget"] = serde_json::json!(settings.notify_budget);
        v["balance_max"] = serde_json::json!(settings.balance_max);
        v["peak_alert_enabled"] = serde_json::json!(settings.peak_alert_enabled);
        v["peak_alert_minutes"] = serde_json::json!(settings.peak_alert_minutes);
        v["peak_alert_mode"] = serde_json::json!(settings.peak_alert_mode);
        Ok(())
    })?;

    // 立即按新阈值在后台评估一次告警状态（锁已随 update_module 返回释放）
    if let Some(st_guard) = app.try_state::<Mutex<QuotaState>>() {
        let st = st_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if st.accounts.iter().any(|a| a.balance.is_some()) {
            drop(st);
            let app2 = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                super::fetch_once(&app2);
            });
            log::info!(
                "quota settings saved, threshold={}",
                settings.warn_threshold
            );
        }
    }
    Ok(())
}

/// 新增账户（kind: deepseek / go / custom / anthropic / zai / minimax / kimi / openrouter / siliconflow / command / volc）
#[tauri::command]
pub fn add_account(app: AppHandle, kind: String, name: String) -> Result<AccountConfig, String> {
    let kind = match AccountKind::from_str(&kind) {
        Some(k) => k,
        None => return Err("未知账户类型".into()),
    };
    // 用纳秒后 5 位作盐值防同一毫秒并发添加撞 id
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let id = format!(
        "{}-{}-{:05}",
        kind.as_str(),
        chrono::Utc::now().timestamp_millis(),
        nanos % 100000
    );
    // 名称留空时自动编号；用户自定义名直接使用
    let existing = account_configs(&app);
    let count = existing.iter().filter(|a| a.kind == kind).count() + 1;
    let name = if name.trim().is_empty() {
        default_account_name(kind, count)
    } else {
        name.trim().into()
    };
    // 每个账户独立密钥槽位，绝不复用旧槽位（避免多账户串号）
    let key_ref = format!("quota-{id}");
    let account = AccountConfig {
        id,
        kind,
        name,
        key_ref,
        custom: None,
    };

    crate::config::update_module(&app, "quota", |v| {
        let accounts = v
            .get_mut("accounts")
            .and_then(|a| a.as_array_mut())
            .ok_or_else(|| "配置中无账户列表".to_string())?;
        accounts.push(serde_json::to_value(&account).map_err(|e| e.to_string())?);
        Ok(())
    })?;

    // 立即在后台执行一次查询（新账户首次拉取）
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || super::fetch_once(&app2));
    Ok(account)
}

/// 删除账户
#[tauri::command]
pub fn remove_account(app: AppHandle, id: String) -> Result<(), String> {
    // 删除前先取出账户信息，用于清理凭据槽位
    let acc = crate::config::module_cfg(&app, "quota")
        .get("accounts")
        .and_then(|a| a.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|a| a.get("id").and_then(|i| i.as_str()) == Some(id.as_str()))
        })
        .cloned();

    crate::config::update_module(&app, "quota", |v| {
        if let Some(accounts) = v.get_mut("accounts").and_then(|a| a.as_array_mut()) {
            accounts.retain(|a| a.get("id").and_then(|i| i.as_str()) != Some(id.as_str()));
        }
        Ok(())
    })?;

    // 尽力清理 keyring 槽位与历史数据，失败不阻塞删除本身。
    // 槽位名兼容：独立槽位 quota-{id}；key_ref 缺失时回退旧 kind 共享槽位
    if let Some(acc) = acc {
        let key_ref = acc.get("key_ref").and_then(|v| v.as_str()).unwrap_or("");
        let kind = acc.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let mut users = vec![format!("quota-{id}")];
        if !key_ref.is_empty() {
            users.push(key_ref.to_string());
        } else if kind == "deepseek" || kind == "go" {
            users.push(if kind == "go" { "opencode-go".into() } else { "deepseek".into() });
        }
        for user in users {
            if let Ok(entry) = super::keyring_entry(&user) {
                let _ = entry.delete_credential();
            }
        }
    }
    if let Some(db_guard) = app.try_state::<Mutex<QuotaDb>>() {
        match db_guard.lock() {
            Ok(db) => {
                let _ = db.delete_account_data(&id);
            }
            Err(p) => {
                let _ = p.into_inner().delete_account_data(&id);
            }
        }
    }

    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || super::fetch_once(&app2));
    Ok(())
}

/// 清空全部额度消费历史（余额/Go 用量/周期；账户与密钥保留），返回清理行数
#[tauri::command]
pub fn quota_clear_history(app: AppHandle) -> Result<u32, String> {
    use tauri::Emitter;
    let total = {
        let db_guard = app.state::<Mutex<QuotaDb>>();
        let db = db_guard.lock().map_err(|e| e.to_string())?;
        db.clear_history().map_err(|e| e.to_string())?
    };
    // 前端监听 quota://updated 刷新卡片
    let _ = app.emit("quota://updated", serde_json::json!({}));
    let app2 = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || super::fetch_once(&app2));
    Ok(total)
}

/// 重命名账户
#[tauri::command]
pub fn rename_account(app: AppHandle, id: String, name: String) -> Result<(), String> {
    crate::config::update_module(&app, "quota", |v| {
        if let Some(accounts) = v.get_mut("accounts").and_then(|a| a.as_array_mut()) {
            if let Some(acc) = accounts
                .iter_mut()
                .find(|a| a.get("id").and_then(|i| i.as_str()) == Some(id.as_str()))
            {
                acc["name"] = serde_json::json!(name);
            }
        }
        Ok(())
    })?;

    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || super::fetch_once(&app2));
    Ok(())
}

/// 设置/清除账户密钥（keyring 加密存储）
#[tauri::command]
pub fn set_account_key(app: AppHandle, id: String, key: String) -> Result<(), String> {
    let account = find_account(&app, &id).ok_or_else(|| "账户不存在".to_string())?;
    super::set_account_key(&account, &key)?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || super::fetch_once(&app2));
    Ok(())
}

/// 读取账户密钥明文（设置页回显用：默认掩码展示、点「显示」切明文）。
/// 密钥仍只存 keyring，不落盘 config；仅本机 IPC 返回给设置页。
#[tauri::command]
pub fn get_account_key(app: AppHandle, id: String) -> String {
    let Some(account) = find_account(&app, &id) else {
        return String::new();
    };
    super::get_account_key(&account)
}

/// 测试密钥有效性（kind 任意账户类型）
#[tauri::command]
pub async fn test_key(kind: String, key: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(kind) = AccountKind::from_str(&kind) else {
            return Err("未知密钥类型".into());
        };
        match kind {
            AccountKind::Deepseek => match super::api::fetch_balance(&key) {
                Ok(b) => Ok(format!("有效，当前余额 ¥{:.2}", b.amount)),
                Err(e) => Err(e.to_string()),
            },
            AccountKind::Custom => Err(
                "自定义 Provider 密钥随「保存查询配置」一起测试（此处仅校验网络层，请直接保存后看卡片状态）".into(),
            ),
            AccountKind::Go => match super::api::fetch_go_quota(&key) {
                Ok(w) => Ok(format!("有效，{} 个套餐窗口可查询", w.len())),
                Err(e) => Err(e.to_string()),
            },
            vendor => match super::api::fetch_coding_windows(vendor, &key) {
                Ok(w) => {
                    let text_count = w.iter().filter(|q| q.text.is_some()).count();
                    let win_count = w.len() - text_count;
                    Ok(format!(
                        "有效，{} 个用量窗口 + {} 个余额数据",
                        win_count, text_count
                    ))
                }
                Err(e) => Err(e.to_string()),
            },
        }
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 保存自定义 Provider 查询配置（仅 custom 账户）
#[tauri::command]
pub fn set_account_custom(
    app: AppHandle,
    id: String,
    custom: super::CustomQuery,
) -> Result<(), String> {
    crate::config::update_module(&app, "quota", |v| {
        if let Some(accounts) = v.get_mut("accounts").and_then(|a| a.as_array_mut()) {
            if let Some(acc) = accounts
                .iter_mut()
                .find(|a| a.get("id").and_then(|i| i.as_str()) == Some(id.as_str()))
            {
                acc["custom"] = serde_json::to_value(&custom).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || super::fetch_once(&app2));
    Ok(())
}

/// 保存账户展示顺序（按传入的 id 列表重排 config.accounts 数组）。
/// 拖拽排序后由前端一次性提交完整顺序；未列出的账户保持原相对顺序追加在末尾（容错）。
#[tauri::command]
pub fn save_account_order(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    crate::config::update_module(&app, "quota", |v| {
        if let Some(accounts) = v.get_mut("accounts").and_then(|a| a.as_array_mut()) {
            let mut rest = accounts.clone();
            let mut order: Vec<serde_json::Value> = Vec::with_capacity(ids.len());
            for id in &ids {
                if let Some(pos) = rest
                    .iter()
                    .position(|a| a.get("id").and_then(|i| i.as_str()) == Some(id.as_str()))
                {
                    order.push(rest.remove(pos));
                }
            }
            order.extend(rest);
            *accounts = order;
        }
        Ok(())
    })
}

/// 各账户类型的默认展示名
pub fn default_account_name(kind: AccountKind, count: usize) -> String {
    let base = match kind {
        AccountKind::Deepseek => "DeepSeek",
        AccountKind::Go => "OpenCode Go",
        AccountKind::Custom => "自定义 Provider",
        AccountKind::Anthropic => "Anthropic",
        AccountKind::Zai => "Z.ai 智谱",
        AccountKind::Minimax => "MiniMax",
        AccountKind::Kimi => "Kimi",
        AccountKind::Openrouter => "OpenRouter",
        AccountKind::Siliconflow => "SiliconFlow",
        AccountKind::Command => "CommandCode",
        AccountKind::Volc => "火山方舟",
    };
    if count <= 1 {
        base.into()
    } else {
        format!("{base} {count}")
    }
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

/// 统计面板数据：今日消费 / 近7天日均 / 近14天每日序列（按账户）
#[tauri::command]
pub fn get_stats_data(app: AppHandle, account_id: String) -> StatsData {
    use chrono::Local;
    let db_guard = app.state::<Mutex<QuotaDb>>();
    let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let records = history::load(&db, &account_id);
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

/// 完整消费历史（每日，最早记录日到今天），消费历史时间线用（按账户）
#[tauri::command]
pub fn get_daily_history(app: AppHandle, account_id: String) -> Vec<DailyPoint> {
    use chrono::Local;
    let db_guard = app.state::<Mutex<QuotaDb>>();
    let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let records = history::load(&db, &account_id);
    let today = Local::now().date_naive();
    history::daily_series_all(&records, today)
        .into_iter()
        .map(|(d, a)| DailyPoint { date: d, amount: a })
        .collect()
}

#[derive(Debug, Serialize)]
pub struct GoCyclePayload {
    pub cycle_start: i64,
    pub cycle_end: Option<i64>,
    pub peak_utilization: f64,
    pub total_delta: f64,
}

/// Go 窗口重置周期历史（每窗口峰值/总消耗）
#[tauri::command]
pub fn get_go_cycles(app: AppHandle, account_id: String, window: String) -> Vec<GoCyclePayload> {
    let db_guard = app.state::<Mutex<QuotaDb>>();
    let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    db.cycle_history(&account_id, &window, 20)
        .unwrap_or_default()
        .into_iter()
        .map(|c| GoCyclePayload {
            cycle_start: c.cycle_start,
            cycle_end: c.cycle_end,
            peak_utilization: c.peak_utilization,
            total_delta: c.total_delta,
        })
        .collect()
}