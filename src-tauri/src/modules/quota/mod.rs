pub mod alerts;
pub mod api;
pub mod commands;
pub mod db;
pub mod history;

use std::sync::Mutex;
use std::time::Instant;

use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use api::GoQuota;
use db::{now_ms, GoSnapshot, QuotaDb};

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
    pub granted: f64,
    pub topped_up: f64,
    pub available: bool,
    pub error: Option<String>,
    pub go_windows: Vec<GoQuota>,
    pub last_balance: Option<f64>,
    /// 是否处于告警状态（首次不算，避免误报）
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

/// 读取账户列表配置
pub fn account_configs(app: &AppHandle) -> Vec<AccountConfig> {
    let cfg = crate::config::module_cfg(app, "quota");
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
    let _ = crate::config::update_module(app, "quota", |v| {
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
        Ok(())
    });
}

pub(crate) fn keyring_entry(user: &str) -> Result<keyring::Entry, String> {
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

/// 单次刷新：遍历所有账户查询并更新状态。
/// 网络请求（可能耗时数秒）在 QuotaState 锁外执行，锁内只做状态更新与快速 DB 写入，
/// 避免长时间持有状态锁导致前端 get_status / save_settings 被阻塞。
pub fn fetch_once(app: &AppHandle) {
    let cfg = crate::config::module_cfg(app, "quota");
    let threshold = cfg_f64(&cfg, "warn_threshold", 10.0);
    let critical = cfg_f64(&cfg, "critical_threshold", threshold / 2.0);
    let notify_low = cfg_bool(&cfg, "notify_low", true);
    let notify_surge = cfg_bool(&cfg, "notify_surge", true);

    let accounts = account_configs(app);

    // 阶段 1：并行执行网络请求（每个账户独立，坏账户不再拖慢全部）
    let outcomes: Vec<(AccountConfig, FetchOutcome)> = std::thread::scope(|s| {
        let handles: Vec<_> = accounts
            .iter()
            .map(|acc| {
                let acc = acc.clone();
                s.spawn(move || {
                    let key = get_account_key(&acc);
                    let outcome = if key.trim().is_empty() {
                        FetchOutcome::Failed("未配置密钥".into())
                    } else {
                        match acc.kind {
                            AccountKind::Deepseek => match api::fetch_balance(&key) {
                                Ok(b) => FetchOutcome::Deepseek(b),
                                Err(e) => FetchOutcome::Failed(e.to_string()),
                            },
                            AccountKind::Go => match api::fetch_go_quota(&key) {
                                Ok(w) => FetchOutcome::Go(w),
                                Err(e) => FetchOutcome::Failed(e.to_string()),
                            },
                        }
                    };
                    (acc, outcome)
                })
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .collect()
    });

    // 阶段 2：锁内应用结果
    let st_guard = app.state::<Mutex<QuotaState>>();
    let mut st = st_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    sync_accounts(&mut st.accounts, &accounts);
    for (acc, outcome) in outcomes {
        match outcome {
            FetchOutcome::Deepseek(b) => apply_deepseek(
                app, &mut st, &acc, b, threshold, critical, notify_low, notify_surge,
            ),
            FetchOutcome::Go(windows) => apply_go(app, &mut st, &acc, &windows),
            FetchOutcome::Failed(msg) => {
                log::warn!("{} query failed: {msg}", acc.name);
                if let Some(status) = st.accounts.iter_mut().find(|s| s.id == acc.id) {
                    // 失败必须写入 error（Go 账户保留旧 go_windows 数据用于展示，
                    // 但错误状态不能吞——否则密钥失效/断网时用户看到的是无标记的陈旧额度）
                    status.error = Some(msg);
                }
            }
        }
    }

    let _ = app.emit("quota://updated", serde_json::json!({}));
}

/// 单账户网络查询结果
enum FetchOutcome {
    Deepseek(api::Balance),
    Go(Vec<GoQuota>),
    Failed(String),
}

/// 应用 DeepSeek 余额结果：更新状态 + 告警 + 历史（锁内，仅 DB/内存操作）
fn apply_deepseek(
    app: &AppHandle,
    st: &mut QuotaState,
    acc: &AccountConfig,
    b: api::Balance,
    threshold: f64,
    critical_threshold: f64,
    notify_low: bool,
    notify_surge: bool,
) {
    let status = st.accounts.iter_mut().find(|s| s.id == acc.id).unwrap();
    let today = Local::now().date_naive();
    let prev = status.last_balance;
    let warn = alerts::should_warn_balance(prev, b.amount, threshold);
    let critical = alerts::should_warn_balance(prev, b.amount, critical_threshold);
    let recover = alerts::should_recover(prev, b.amount, threshold);
    status.last_balance = Some(b.amount);
    status.balance = Some(b.amount);
    status.granted = b.granted;
    status.topped_up = b.topped_up;
    status.available = b.available;
    status.error = None;

    if status.initialized && critical && notify_low {
        let msg = format!(
            "{} 余额已跌破紧急线 ¥{:.2}（当前 ¥{:.2}）",
            acc.name, critical_threshold, b.amount
        );
        notify(app, "🚨 余额告急", &msg);
        log::warn!("alert: balance critical, {msg}");
    }
    if status.initialized && warn && !critical && notify_low {
        let msg = format!(
            "{} 余额仅剩 ¥{:.2}（预警阈值: ¥{:.2}）",
            acc.name, b.amount, threshold
        );
        notify(app, "⚠ 余额不足", &msg);
        log::warn!("alert: balance low, {msg}");
    }
    if status.initialized && recover && notify_low {
        let msg = format!(
            "{} 余额已恢复至 ¥{:.2}（阈值: ¥{:.2}）",
            acc.name, b.amount, threshold
        );
        notify(app, "✅ 余额恢复", &msg);
        log::info!("alert: balance recovered, {msg}");
    }

    let db_guard = app.state::<Mutex<QuotaDb>>();
    let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let records = history::load(&db, &acc.id);
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

    history::append(&db, &acc.id, b.amount, b.granted, b.topped_up, chrono::Utc::now());
    let _ = db.prune_balance(&acc.id, 5000);
}

/// 应用 OpenCode Go 套餐用量结果（锁内，仅 DB 写入）
fn apply_go(app: &AppHandle, st: &mut QuotaState, acc: &AccountConfig, windows: &[GoQuota]) {
    let status = st.accounts.iter_mut().find(|s| s.id == acc.id).unwrap();
    status.go_windows = windows.to_vec();
    status.error = None;
    persist_go(app, &acc.id, windows);
}

/// 写入 Go 快照 + 重置周期检测
fn persist_go(app: &AppHandle, account_id: &str, windows: &[GoQuota]) {
    let db_guard = app.state::<Mutex<QuotaDb>>();
    let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let now = now_ms();
    for w in windows {
        let snap = GoSnapshot {
            captured_at: now,
            window: w.window.clone(),
            used_percent: w.used_percent,
            resets_at: w.resets_at,
        };
        let _ = db.insert_go_snapshot(account_id, &snap);
        track_go_cycle(&db, account_id, &w.window, &snap);
    }
}

/// 周期跟踪：窗口重置（用量骤降或 resetsAt 已过）时关闭旧周期、开新周期。
/// peak = 周期内最高用量；total_delta = 周期内相邻快照正增量之和（总消耗）
fn track_go_cycle(db: &QuotaDb, account_id: &str, window: &str, snap: &GoSnapshot) {
    let prev = db.prev_go_snapshot(account_id, window, snap.captured_at).unwrap_or(None);
    let reset = match &prev {
        Some(p) => {
            let dropped = p.used_percent > snap.used_percent;
            let resets_passed = p
                .resets_at
                .map(|r| r <= snap.captured_at / 1000)
                .unwrap_or(false);
            dropped || resets_passed
        }
        None => false,
    };
    let has_active = db.active_cycle(account_id, window).unwrap_or(None).is_some();
    if reset && has_active {
        let _ = db.close_active_cycle(account_id, window, snap.captured_at);
    }
    if !has_active || reset {
        let _ = db.start_cycle(account_id, window, snap.captured_at);
    }
    let prev_used = prev.map(|p| p.used_percent as f64).unwrap_or(0.0);
    let delta = if reset {
        0.0
    } else {
        (snap.used_percent as f64 - prev_used).max(0.0)
    };
    if let Some(c) = db.active_cycle(account_id, window).unwrap_or(None) {
        let _ = db.update_active_cycle(
            account_id,
            window,
            c.peak_utilization.max(snap.used_percent as f64),
            c.total_delta + delta,
        );
    }
}

fn poll_loop(app: AppHandle) {
    let mut cached_interval: u64 = 30;
    let mut cfg_tick: u32 = 0;
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));

        // 检查模块是否启用，禁用时跳过工作
        if !crate::quota_enabled(&app) {
            continue;
        }

        // 每 5 秒重读一次配置（替代原来每秒都读，减少无谓的 JSON clone/查找）
        cfg_tick += 1;
        if cfg_tick % 5 == 0 {
            let cfg = crate::config::module_cfg(&app, "quota");
            cached_interval = cfg_f64(&cfg, "refresh_interval_sec", 30.0).max(5.0) as u64;
        }
        let due = {
            let st_guard = app.state::<Mutex<QuotaState>>();
            let st = st_guard.lock().unwrap_or_else(|p| p.into_inner());
            match st.last_fetch {
                Some(t) => t.elapsed().as_secs() >= cached_interval,
                None => true,
            }
        };
        if due {
            // 先推进时间戳再拉取：即使 fetch_once panic 也不会形成秒级重试环
            {
                let st_guard = app.state::<Mutex<QuotaState>>();
                let mut st = st_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                st.last_fetch = Some(Instant::now());
            }
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                fetch_once(&app);
            }));
        }
    }
}

/// 打开并托管 QuotaDb（幂等：重复调用直接跳过管理）
fn setup_db(app: &tauri::AppHandle) -> tauri::Result<()> {
    if app.try_state::<Mutex<QuotaDb>>().is_some() {
        return Ok(());
    }
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db = QuotaDb::open(&data_dir.join("quota.db"))
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    app.manage(Mutex::new(db));
    Ok(())
}

/// 旧 JSON 余额历史一次性导入 SQLite（幂等：每账户导入后写标记；旧文件保留不删）
fn import_json_history(app: &AppHandle) {
    let data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let accounts = account_configs(app);
    let db_guard = app.state::<Mutex<QuotaDb>>();
    let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    for acc in accounts {
        let flag = format!("json_imported_{}", acc.id);
        if db.get_setting(&flag).is_some() {
            continue;
        }
        let path = data_dir.join(format!("balance_history_{}.json", acc.id));
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(doc) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(records) = doc.get("records").and_then(|r| r.as_array()) {
                    for r in records {
                        let t = r
                            .get("time")
                            .and_then(|v| v.as_str())
                            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                            .map(|dt| dt.timestamp_millis());
                        let b = r.get("balance").and_then(|v| v.as_f64());
                        if let (Some(t), Some(b)) = (t, b) {
                            let _ = db.append_balance(&acc.id, b, 0.0, 0.0, t);
                        }
                    }
                    let _ = db.prune_balance(&acc.id, 5000);
                    log::info!("quota: JSON history imported for {}", acc.id);
                }
            }
        }
        let _ = db.set_setting(&flag, "1");
    }
}

/// 启动时从 SQLite 回填最新余额/Go 快照，避免等首次轮询才有数字
fn restore_from_db(app: &AppHandle) {
    let accounts = account_configs(app);
    let st_guard = app.state::<Mutex<QuotaState>>();
    let mut st = st_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    sync_accounts(&mut st.accounts, &accounts);
    let db_guard = app.state::<Mutex<QuotaDb>>();
    let db = db_guard.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    for s in st.accounts.iter_mut() {
        if let Some((_t, balance, granted, topped_up)) = db.latest_balance(&s.id).unwrap_or(None) {
            s.balance = Some(balance);
            s.last_balance = Some(balance);
            s.granted = granted;
            s.topped_up = topped_up;
        }
        if s.kind == AccountKind::Go {
            let latest = db.latest_go_snapshots(&s.id).unwrap_or_default();
            if !latest.is_empty() {
                s.go_windows = latest
                    .into_iter()
                    .map(|sn| GoQuota {
                        window: sn.window,
                        used_percent: sn.used_percent,
                        resets_at: sn.resets_at,
                    })
                    .collect();
            }
        }
    }
}

/// 从 AppHandle 初始化额度监控模块（用于并行初始化）
pub fn setup_from_handle(app: &tauri::AppHandle) -> tauri::Result<()> {
    // 迁移旧账户密钥槽位（多账户支持：旧账户独立槽位，避免串号）
    migrate_account_keyrefs(app);
    setup_db(app)?;
    import_json_history(app);
    app.manage(Mutex::new(QuotaState::default()));
    restore_from_db(app);
    let handle = app.clone();
    std::thread::spawn(move || poll_loop(handle));
    log::info!("quota module ready");
    Ok(())
}