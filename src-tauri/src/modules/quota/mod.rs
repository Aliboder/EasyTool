pub mod alerts;
pub mod api;
pub mod commands;
pub mod history;

use std::sync::Mutex;
use std::time::Instant;

use chrono::Local;
use tauri::{AppHandle, Emitter, Manager};

use crate::config::ConfigState;
use api::GoQuota;

/// 共享监控状态
#[derive(Default)]
pub struct QuotaState {
    pub balance: Option<f64>,
    pub available: bool,
    pub error: Option<String>,
    pub go_windows: Vec<GoQuota>,
    /// 上次成功余额（告警临界检测用）
    pub last_balance: Option<f64>,
    /// 上次是否处于不足状态（临界点一次提醒）
    pub was_low: bool,
    /// 是否已完成首次状态记录（首次不提醒）
    pub initialized: bool,
    /// 最近一次消费突增提醒的日期（每天最多一次）
    pub last_surge_day: Option<chrono::NaiveDate>,
    /// 上次刷新时间
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

fn cfg_f64(cfg: &serde_json::Value, key: &str, default: f64) -> f64 {
    cfg.get(key).and_then(|v| v.as_f64()).unwrap_or(default)
}

fn cfg_bool(cfg: &serde_json::Value, key: &str, default: bool) -> bool {
    cfg.get(key)
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

pub fn history_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap()
        .join("balance_history.json")
}

fn keyring_entry(user: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.aliboder.easytool", user)
        .map_err(|e| format!("初始化系统密钥库失败: {e}"))
}

pub fn get_key(user: &str) -> String {
    keyring_entry(user)
        .and_then(|e| e.get_password().map_err(|err| format!("{err}")))
        .unwrap_or_default()
}

pub fn set_key(user: &str, key: &str) -> Result<(), String> {
    let entry = keyring_entry(user)?;
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

/// 单次刷新：查询余额 + Go 套餐，更新状态并触发告警
pub fn fetch_once(app: &AppHandle) {
    let cfg = module_config(app);
    let threshold = cfg_f64(&cfg, "warn_threshold", 10.0);
    let notify_low = cfg_bool(&cfg, "notify_low", true);
    let notify_surge = cfg_bool(&cfg, "notify_surge", true);
    let deepseek_key = get_key("deepseek");
    let go_key = get_key("opencode-go");

    let hpath = history_path(app);

    // ---- DeepSeek 余额 ----
    if !deepseek_key.trim().is_empty() {
        match api::fetch_balance(&deepseek_key) {
            Ok(b) => {
                let today = Local::now().date_naive();
                let st_guard = app.state::<Mutex<QuotaState>>();
                let mut st = st_guard.lock().unwrap();
                let warn = alerts::should_warn_balance(st.last_balance, b.amount, threshold);
                st.last_balance = Some(b.amount);
                st.balance = Some(b.amount);
                st.available = b.available;
                st.error = None;

                if st.initialized && warn && notify_low {
                    let msg = format!(
                        "DeepSeek 余额仅剩 ¥{:.2}（预警阈值: ¥{:.2}）",
                        b.amount, threshold
                    );
                    notify(app, "⚠ 余额不足", &msg);
                    log::warn!("alert: balance low, {msg}");
                }
                st.was_low = b.amount < threshold;

                // 消费突增
                let records = history::load(&hpath);
                let today_spend = history::today_spend(&records, today);
                let avg7 = history::avg_daily_spent(&records, 7, today);
                if st.last_surge_day != Some(today)
                    && notify_surge
                    && alerts::is_spike(today_spend, avg7)
                {
                    let msg = format!(
                        "今日消费 ¥{:.2}，超过近 7 天日均消费（¥{:.2}）的 3 倍",
                        today_spend, avg7
                    );
                    notify(app, "🔥 消费突增", &msg);
                    log::warn!("alert: spend surge, {msg}");
                    st.last_surge_day = Some(today);
                }
                st.initialized = true;
                drop(st);

                history::append(&hpath, b.amount, chrono::Utc::now());
            }
            Err(e) => {
                let st_guard = app.state::<Mutex<QuotaState>>();
                let mut st = st_guard.lock().unwrap();
                st.error = Some(format!("DeepSeek: {e}"));
                log::warn!("balance query failed: {e}");
            }
        }
    }

    // ---- OpenCode Go 套餐 ----
    if !go_key.trim().is_empty() {
        match api::fetch_go_quota(&go_key) {
            Ok(windows) => {
                let st_guard = app.state::<Mutex<QuotaState>>();
                let mut st = st_guard.lock().unwrap();
                st.go_windows = windows;
                st.error = None;
            }
            Err(e) => {
                log::warn!("go quota query failed: {e}");
                let st_guard = app.state::<Mutex<QuotaState>>();
                let mut st = st_guard.lock().unwrap();
                if st.go_windows.is_empty() {
                    st.error = Some(format!("Go 套餐: {e}"));
                }
            }
        }
    }

    let _ = app.emit("quota://updated", serde_json::json!({}));
}

fn poll_loop(app: AppHandle) {
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
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