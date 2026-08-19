pub mod alerts;
pub mod api;
pub mod commands;
pub mod history;

use std::sync::Mutex;
use std::time::Instant;

use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::config::ConfigState;
use api::GoQuota;

/// 账户类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    Deepseek,
    Go,
}

impl Default for AccountKind {
    fn default() -> Self {
        AccountKind::Deepseek
    }
}

impl AccountKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AccountKind::Deepseek => "deepseek",
            AccountKind::Go => "go",
        }
    }
}

/// 账户配置（存 config.json 的 quota 模块）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountConfig {
    pub id: String,
    pub kind: AccountKind,
    pub name: String,
    /// keyring 槽位名（密钥存储位置）；为空时按 kind 推导旧槽位名
    #[serde(default)]
    pub key_ref: String,
}

/// 单个账户的运行时状态
#[derive(Default)]
pub struct AccountStatus {
    pub id: String,
    pub kind: AccountKind,
    pub name: String,
    pub balance: Option<f64>,
    pub available: bool,
    pub error: Option<String>,
    pub go_windows: Vec<GoQuota>,
    pub last_balance: Option<f64>,
    pub was_low: bool,
    /// 是否已完成首次状态记录（首次不提醒）
    pub initialized: bool,
    /// 最近一次消费突增提醒的日期（每天最多一次）
    pub last_surge_day: Option<chrono::NaiveDate>,
}

/// 共享监控状态
#[derive(Default)]
pub struct QuotaState {
    pub accounts: Vec<AccountStatus>,
    pub last_fetch: Option<Instant>,
}

/// 读 quota 模块配置对象
pub fn module_config(app: &AppHandle) -> serde_json::Value {
    app.state::<ConfigState>()
        .0
        .lock()
        .unwrap()
        .modules
        .get("quota")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}))
}

/// 读取账户列表配置
pub fn account_configs(app: &AppHandle) -> Vec<AccountConfig> {
    let cfg = module_config(app);
    cfg.get("accounts")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| serde_json::from_value::<AccountConfig>(a.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

/// 按 id 查找账户配置
pub fn find_account(app: &AppHandle, id: &str) -> Option<AccountConfig> {
    account_configs(app).into_iter().find(|a| a.id == id)
}

fn cfg_f64(cfg: &serde_json::Value, key: &str, default: f64) -> f64 {
    cfg.get(key).and_then(|v| v.as_f64()).unwrap_or(default)
}

fn cfg_bool(cfg: &serde_json::Value, key: &str, default: bool) -> bool {
    cfg.get(key)
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

/// 账户历史文件路径（按账户分开，消费统计互不干扰）
pub fn history_path(app: &AppHandle, account_id: &str) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap()
        .join(format!("balance_history_{account_id}.json"))
}

/// 兼容旧 keyring 槽位：key_ref 为空时按 kind 推导旧槽位名
fn keyring_user(account: &AccountConfig) -> String {
    if !account.key_ref.is_empty() {
        account.key_ref.clone()
    } else {
        match account.kind {
            AccountKind::Deepseek => "deepseek".into(),
            AccountKind::Go => "opencode-go".into(),
        }
    }
}

/// 迁移旧账户的密钥槽位：key_ref 为空的非默认账户迁移到独立槽位（quota-{id}），
/// 避免所有同类新增账户共用旧槽位导致数据串号。幂等（迁移后 key_ref 非空不再处理）
pub fn migrate_account_keyrefs(app: &AppHandle) {
    let accounts = account_configs(app);
    let mut updates: Vec<(String, String)> = Vec::new();
    for acc in &accounts {
        if !acc.key_ref.is_empty() {
            continue; // 已迁移或默认账户
        }
        // 读取旧槽位密钥（fallback 推导），写入独立槽位
        let legacy_key = get_account_key(acc);
        let new_ref = format!("quota-{}", acc.id);
        if !legacy_key.is_empty() {
            if let Ok(entry) = keyring_entry(&new_ref) {
                let _ = entry.set_password(&legacy_key);
            }
        }
        updates.push((acc.id.clone(), new_ref));
    }
    if updates.is_empty() {
        return;
    }
    let binding = app.state::<ConfigState>();
    let mut cfg = binding.0.lock().unwrap();
    if let Some(v) = cfg.modules.get_mut("quota") {
        if let Some(accounts) = v.get_mut("accounts").and_then(|a| a.as_array_mut()) {
            for (id, new_ref) in &updates {
                if let Some(a) = accounts
                    .iter_mut()
                    .find(|a| a.get("id").and_then(|i| i.as_str()) == Some(id.as_str()))
                {
                    a["key_ref"] = serde_json::json!(new_ref);
                }
            }
        }
    }
    let _ = crate::config::save_config(app, &cfg);
}

fn keyring_entry(user: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.aliboder.easytool", user)
        .map_err(|e| format!("初始化系统密钥库失败: {e}"))
}

/// 读取账户密钥
pub fn get_account_key(account: &AccountConfig) -> String {
    keyring_entry(&keyring_user(account))
        .and_then(|e| e.get_password().map_err(|err| format!("{err}")))
        .unwrap_or_default()
}

/// 保存/清除账户密钥（keyring 加密存储）
pub fn set_account_key(account: &AccountConfig, key: &str) -> Result<(), String> {
    let entry = keyring_entry(&keyring_user(account))?;
    if key.trim().is_empty() {
        entry
            .delete_credential()
            .map_err(|e| format!("清除密钥失败: {e}"))?;
        return Ok(());
    }
    entry
        .set_password(key.trim())
        .map_err(|e| format!("保存密钥失败: {e}"))
}

/// 发送系统通知
fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

/// 同步状态容器与配置账户列表（增删账户时保持一致）
fn sync_accounts(st_accounts: &mut Vec<AccountStatus>, configs: &[AccountConfig]) {
    st_accounts.retain(|s| configs.iter().any(|c| c.id == s.id));
    for c in configs {
        match st_accounts.iter_mut().find(|s| s.id == c.id) {
            Some(s) => {
                s.name = c.name.clone();
                s.kind = c.kind;
            }
            None => st_accounts.push(AccountStatus {
                id: c.id.clone(),
                kind: c.kind,
                name: c.name.clone(),
                ..Default::default()
            }),
        }
    }
}

/// 单次刷新：遍历所有账户查询并更新状态
pub fn fetch_once(app: &AppHandle) {
    let cfg = module_config(app);
    let threshold = cfg_f64(&cfg, "warn_threshold", 10.0);
    let notify_low = cfg_bool(&cfg, "notify_low", true);
    let notify_surge = cfg_bool(&cfg, "notify_surge", true);

    let accounts = account_configs(app);
    let st_guard = app.state::<Mutex<QuotaState>>();
    let mut st = st_guard.lock().unwrap();
    sync_accounts(&mut st.accounts, &accounts);

    for acc in &accounts {
        match acc.kind {
            AccountKind::Deepseek => {
                fetch_deepseek(app, &mut st, acc, threshold, notify_low, notify_surge)
            }
            AccountKind::Go => fetch_go(&mut st, acc, notify_surge),
        }
    }

    let _ = app.emit("quota://updated", serde_json::json!({}));
}

/// 查询单个 DeepSeek 账户余额 + 告警 + 历史
fn fetch_deepseek(
    app: &AppHandle,
    st: &mut QuotaState,
    acc: &AccountConfig,
    threshold: f64,
    notify_low: bool,
    notify_surge: bool,
) {
    let status = st.accounts.iter_mut().find(|s| s.id == acc.id).unwrap();
    let key = get_account_key(acc);
    let hpath = history_path(app, &acc.id);
    if key.trim().is_empty() {
        status.error = Some("未配置密钥".into());
        return;
    }

    match api::fetch_balance(&key) {
        Ok(b) => {
            let today = Local::now().date_naive();
            let warn = alerts::should_warn_balance(status.last_balance, b.amount, threshold);
            status.last_balance = Some(b.amount);
            status.balance = Some(b.amount);
            status.available = b.available;
            status.error = None;

            if status.initialized && warn && notify_low {
                let msg = format!(
                    "{} 余额仅剩 ¥{:.2}（预警阈值: ¥{:.2}）",
                    acc.name, b.amount, threshold
                );
                notify(app, "⚠ 余额不足", &msg);
                log::warn!("alert: balance low, {msg}");
            }
            status.was_low = b.amount < threshold;

            let records = history::load(&hpath);
            let today_spend = history::today_spend(&records, today);
            let avg7 = history::avg_daily_spent(&records, 7, today);
            if status.last_surge_day != Some(today)
                && notify_surge
                && alerts::is_spike(today_spend, avg7)
            {
                let msg = format!(
                    "{} 今日消费 ¥{:.2}，超过近 7 天日均消费（¥{:.2}）的 3 倍",
                    acc.name, today_spend, avg7
                );
                notify(app, "🔥 消费突增", &msg);
                log::warn!("alert: spend surge, {msg}");
                status.last_surge_day = Some(today);
            }
            status.initialized = true;

            history::append(&hpath, b.amount, chrono::Utc::now());
        }
        Err(e) => {
            status.error = Some(format!("{e}"));
            log::warn!("{} balance query failed: {e}", acc.name);
        }
    }
}

/// 查询单个 OpenCode Go 账户套餐用量
fn fetch_go(st: &mut QuotaState, acc: &AccountConfig, notify_surge: bool) {
    let status = st.accounts.iter_mut().find(|s| s.id == acc.id).unwrap();
    let _ = notify_surge; // Go 套餐无消费突增概念，仅 DeepSeek 统计消费
    let key = get_account_key(acc);
    if key.trim().is_empty() {
        status.error = Some("未配置密钥".into());
        return;
    }

    match api::fetch_go_quota(&key) {
        Ok(windows) => {
            status.go_windows = windows;
            status.error = None;
        }
        Err(e) => {
            log::warn!("{} go quota query failed: {e}", acc.name);
            if status.go_windows.is_empty() {
                status.error = Some(format!("{e}"));
            }
        }
    }
}

fn poll_loop(app: AppHandle) {
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));

        // 检查模块是否启用，禁用时跳过工作
        if !crate::quota_enabled(&app) {
            continue;
        }

        let interval = {
            let cfg = module_config(&app);
            cfg_f64(&cfg, "refresh_interval_sec", 30.0).max(5.0) as u64
        };
        let due = {
            let st_guard = app.state::<Mutex<QuotaState>>();
            let st = st_guard.lock().unwrap();
            match st.last_fetch {
                Some(t) => t.elapsed().as_secs() >= interval,
                None => true,
            }
        };
        if due {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                fetch_once(&app);
                let st_guard = app.state::<Mutex<QuotaState>>();
                let mut st = st_guard.lock().unwrap();
                st.last_fetch = Some(Instant::now());
            }));
        }
    }
}

/// 初始化额度监控模块：共享状态 + 轮询线程
pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let handle = app.handle().clone();
    app.manage(Mutex::new(QuotaState::default()));
    std::thread::spawn(move || poll_loop(handle));
    log::info!("quota module ready");
    Ok(())
}

/// 从 AppHandle 初始化额度监控模块（用于并行初始化）
pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    // 迁移旧账户密钥槽位（多账户支持：旧账户独立槽位，避免串号）
    migrate_account_keyrefs(app);
    let handle = app.clone();
    app.manage(Mutex::new(QuotaState::default()));
    std::thread::spawn(move || poll_loop(handle));
    log::info!("quota module ready");
    Ok(())
}