//! DeepSeek 余额 / OpenCode Go 套餐 API 客户端（阻塞式，供轮询线程调用）

use serde::Deserialize;

#[derive(Debug)]
pub enum QuotaError {
    AuthFailed(String),
    Network(String),
    ParseError(String),
    RateLimited(String),
}

impl std::fmt::Display for QuotaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QuotaError::AuthFailed(m) => write!(f, "密钥无效或已失效：{m}"),
            QuotaError::Network(m) => write!(f, "网络错误：{m}"),
            QuotaError::ParseError(m) => write!(f, "数据解析失败（接口可能变更）：{m}"),
            QuotaError::RateLimited(m) => write!(f, "请求过于频繁：{m}"),
        }
    }
}

pub type QuotaResult<T> = Result<T, QuotaError>;

#[derive(Debug, Clone)]
pub struct Balance {
    pub amount: f64,
    pub available: bool,
}

#[derive(Debug, Clone)]
pub struct GoQuota {
    pub window: String,
    pub used_percent: i32,
    pub resets_at: Option<i64>,
}

const DEEPSEEK_ENDPOINT: &str = "https://api.deepseek.com/user/balance";
const GO_ENDPOINT: &str = "https://opencode.ai/zen/go/v1/usage";

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

fn do_get(client: &reqwest::blocking::Client, url: &str, api_key: &str) -> QuotaResult<String> {
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .header("Accept", "application/json")
        .send()
        .map_err(|e| QuotaError::Network(e.to_string()))?;
    let status = resp.status();
    let body = resp.text().unwrap_or_default();

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(QuotaError::AuthFailed(format!("HTTP {}", status.as_u16())));
    }
    if status.as_u16() == 429 {
        return Err(QuotaError::RateLimited("请稍后重试".into()));
    }
    if !status.is_success() {
        return Err(QuotaError::Network(format!("HTTP {}", status.as_u16())));
    }
    Ok(body)
}

/// 查询 DeepSeek 余额（元）
pub fn fetch_balance(api_key: &str) -> QuotaResult<Balance> {
    if api_key.trim().is_empty() {
        return Err(QuotaError::AuthFailed("尚未设置 API 密钥".into()));
    }
    let client = client();
    let body = do_get(&client, DEEPSEEK_ENDPOINT, api_key)?;
    parse_balance(&body)
}

fn parse_balance(body: &str) -> QuotaResult<Balance> {
    #[derive(Deserialize)]
    struct Info {
        currency: String,
        total_balance: String,
    }
    #[derive(Deserialize)]
    struct Doc {
        is_available: bool,
        balance_infos: Vec<Info>,
    }
    let doc: Doc = serde_json::from_str(body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    let picked = doc
        .balance_infos
        .iter()
        .find(|i| i.currency.eq_ignore_ascii_case("CNY"))
        .or_else(|| doc.balance_infos.first())
        .ok_or_else(|| QuotaError::ParseError("响应中无余额信息".into()))?;
    let amount = picked
        .total_balance
        .parse::<f64>()
        .map_err(|e| QuotaError::ParseError(e.to_string()))?;
    Ok(Balance {
        amount,
        available: doc.is_available,
    })
}

/// 尝试读取本机 opencode 登录凭据（~/.local/share/opencode/auth.json），复用 CLI 会话
pub fn load_local_go_key() -> String {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let path = std::path::Path::new(&home)
        .join(".local")
        .join("share")
        .join("opencode")
        .join("auth.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return String::new();
    };
    #[derive(Deserialize)]
    struct AuthEntry {
        #[serde(rename = "type")]
        kind: String,
        key: String,
    }
    let Ok(doc) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&text) else {
        return String::new();
    };
    for name in ["opencode-go", "opencode"] {
        if let Some(v) = doc.get(name) {
            if let Ok(entry) = serde_json::from_value::<AuthEntry>(v.clone()) {
                if entry.kind == "api" && !entry.key.trim().is_empty() {
                    return entry.key.trim().to_string();
                }
            }
        }
    }
    String::new()
}

/// 查询 OpenCode Go 套餐余量（5小时滚动/周/月三个窗口）
pub fn fetch_go_quota(api_key: &str) -> QuotaResult<Vec<GoQuota>> {
    let key = if api_key.trim().is_empty() {
        load_local_go_key()
    } else {
        api_key.trim().to_string()
    };
    if key.is_empty() {
        return Err(QuotaError::AuthFailed(
            "尚未设置 Go 密钥（也未找到本机 opencode 登录凭据）".into(),
        ));
    }
    let client = client();
    let body = do_get(&client, GO_ENDPOINT, &key)?;
    parse_usage(&body)
}

fn parse_usage(body: &str) -> QuotaResult<Vec<GoQuota>> {
    #[derive(Deserialize, Default)]
    struct WindowInfo {
        percent: Option<f64>,
        #[serde(rename = "usagePercent")]
        usage_percent: Option<f64>,
        #[serde(rename = "usedPercent")]
        used_percent: Option<f64>,
        #[serde(rename = "percentUsed")]
        percent_used: Option<f64>,
        percentage: Option<f64>,
        #[serde(rename = "resetsAt")]
        resets_at: Option<String>,
        #[serde(rename = "resetAt")]
        reset_at: Option<f64>,
        #[serde(rename = "resetInSec")]
        reset_in_sec: Option<f64>,
    }
    #[derive(Deserialize, Default)]
    struct UsageInfo {
        rolling: Option<WindowInfo>,
        weekly: Option<WindowInfo>,
        monthly: Option<WindowInfo>,
    }
    #[derive(Deserialize)]
    struct Doc {
        usage: Option<UsageInfo>,
    }

    let doc: Doc = serde_json::from_str(body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    let usage = doc
        .usage
        .ok_or_else(|| QuotaError::ParseError("响应中无 usage 信息".into()))?;

    let mut out = Vec::new();
    for (kind, info) in [
        ("session", usage.rolling),
        ("weekly", usage.weekly),
        ("monthly", usage.monthly),
    ] {
        let Some(info) = info else { continue };
        let Some(raw) = info
            .percent
            .or(info.usage_percent)
            .or(info.used_percent)
            .or(info.percent_used)
            .or(info.percentage)
        else {
            continue;
        };
        // percent 字段语义 0~100；其余 dashboard 风格字段 0~1 比例需放大
        let p = if info.percent.is_some() {
            raw
        } else if (0.0..=1.0).contains(&raw) {
            raw * 100.0
        } else {
            raw
        };
        let used_percent = (p.round() as i32).clamp(0, 100);

        let resets_at = info
            .resets_at
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.timestamp())
            .or_else(|| info.reset_at.map(ts_to_unix))
            .or_else(|| {
                info.reset_in_sec
                    .map(|s| chrono::Utc::now().timestamp() + s.max(0.0) as i64)
            });
        out.push(GoQuota {
            window: kind.into(),
            used_percent,
            resets_at,
        });
    }
    if out.is_empty() {
        return Err(QuotaError::ParseError("响应中无有效窗口数据".into()));
    }
    Ok(out)
}

/// 时间戳转 unix 秒（兼容秒与毫秒）
fn ts_to_unix(value: f64) -> i64 {
    if value < 20_000_000_000.0 {
        (value * 1000.0) as i64 / 1000
    } else {
        (value / 1000.0) as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_balance_cny() {
        let body = r#"{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"12.34"},{"currency":"USD","total_balance":"1.0"}]}"#;
        let b = parse_balance(body).unwrap();
        assert_eq!(b.amount, 12.34);
        assert!(b.available);
    }

    #[test]
    fn parse_balance_fallback_first() {
        let body = r#"{"is_available":false,"balance_infos":[{"currency":"USD","total_balance":"2.5"}]}"#;
        let b = parse_balance(body).unwrap();
        assert_eq!(b.amount, 2.5);
        assert!(!b.available);
    }

    #[test]
    fn parse_balance_empty_fails() {
        assert!(parse_balance("{}").is_err());
        assert!(parse_balance(r#"{"is_available":true,"balance_infos":[]}"#).is_err());
    }

    #[test]
    fn parse_usage_windows_and_percent_scale() {
        let body = r#"{"usage":{"rolling":{"percent":80,"resetsAt":"2026-08-19T12:00:00Z"},"weekly":{"usagePercent":0.25},"monthly":null}}"#;
        let q = parse_usage(body).unwrap();
        assert_eq!(q.len(), 2);
        assert_eq!(q[0].window, "session");
        assert_eq!(q[0].used_percent, 80);
        assert_eq!(q[1].window, "weekly");
        assert_eq!(q[1].used_percent, 25); // 0.25 -> 25%
        assert!(q[0].resets_at.is_some());
    }

    #[test]
    fn parse_usage_empty_fails() {
        assert!(parse_usage("{}").is_err());
        assert!(parse_usage(r#"{"usage":{"rolling":null,"weekly":null,"monthly":null}}"#).is_err());
    }
}