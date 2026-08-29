//! DeepSeek 余额 / OpenCode Go 套餐 / 自定义 Provider / 多厂商 Coding Plan API 客户端
//! （阻塞式，供轮询线程调用）。
//! 厂商适配矩阵与解析器逻辑借鉴 dsh-cost-meter（MIT），窗口键名统一归一化便于前端展示。

use serde::Deserialize;
use serde_json::Value;

use super::AccountKind;

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
    /// 赠送余额（granted_balance，0 表示接口未提供）
    pub granted: f64,
    /// 充值余额（topped_up_balance，0 表示接口未提供）
    pub topped_up: f64,
    pub available: bool,
}

/// 窗口用量（Go 三窗口 / 各 Coding Plan 厂商共用）。
/// `text` 为文本窗口（余额等无百分比的量，如 SiliconFlow/Kimi PAYG 余额）；
/// 有 text 时前端展示文本而非进度环。
#[derive(Debug, Clone)]
pub struct GoQuota {
    pub window: String,
    pub used_percent: i32,
    pub resets_at: Option<i64>,
    pub text: Option<String>,
}

const DEEPSEEK_ENDPOINT: &str = "https://api.deepseek.com/user/balance";
const GO_ENDPOINT: &str = "https://opencode.ai/zen/go/v1/usage";
const UA: &str = "EasyTool/0.8 (Windows toolbox)";

/// 进程级共享 HTTP 客户端：复用连接池，避免每次轮询重新 TLS 握手
fn client() -> &'static reqwest::blocking::Client {
    static CLIENT: std::sync::OnceLock<reqwest::blocking::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default()
    })
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

/// 带自定义头与 UA 的 GET（Coding Plan 厂商用）
fn do_get_hdrs(
    client: &reqwest::blocking::Client,
    url: &str,
    headers: &[(&str, &str)],
) -> QuotaResult<String> {
    let mut req = client
        .get(url)
        .header("Accept", "application/json")
        .header("User-Agent", UA);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let resp = req.send().map_err(|e| QuotaError::Network(e.to_string()))?;
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

// ---------- JSON 取值工具 ----------

/// 按点号路径取 JSON 值（如 "data.total_available"）
fn walk<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .filter(|s| !s.is_empty())
        .fold(Some(v), |acc, seg| acc.and_then(|cur| cur.get(seg)))
}

/// 数字（兼容字符串数字）
fn as_f64(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
}

/// 任意对象字段（大小写与别名容错）
fn pick<'a>(obj: &'a serde_json::Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    for k in keys {
        if let Some(v) = obj.get(*k) {
            if !v.is_null() {
                return Some(v);
            }
        }
    }
    None
}

/// 归一化百分比：0-1 视为小数×100，>=1 视为已是百分数；非法 → None
fn normalize_percent(v: Option<&Value>) -> Option<f64> {
    let n = as_f64(v?)?;
    if n < 0.0 {
        return None;
    }
    let pct = if n <= 1.0 { n * 100.0 } else { n };
    Some(pct.min(100.0))
}

/// 已用百分比取整钳制（0-100）
fn clamp_pct(p: f64) -> i32 {
    (p.round() as i32).clamp(0, 100)
}

/// 重置时刻归一化为 unix 秒（兼容 ISO 字符串 / unix 秒 / unix 毫秒）
fn norm_reset(v: Option<&Value>) -> Option<i64> {
    match v? {
        Value::String(s) => {
            if s.trim().is_empty() {
                return None;
            }
            chrono::DateTime::parse_from_rfc3339(s.trim())
                .ok()
                .map(|dt| dt.timestamp())
                .or_else(|| {
                    s.trim().parse::<f64>().ok().filter(|n| *n > 0.0).map(ts_to_unix)
                })
        }
        Value::Number(n) => n.as_f64().filter(|n| *n > 0.0).map(ts_to_unix),
        _ => None,
    }
}

/// 时间戳转 unix 秒（兼容秒与毫秒）
fn ts_to_unix(value: f64) -> i64 {
    if value < 20_000_000_000.0 {
        (value * 1000.0) as i64 / 1000
    } else {
        (value / 1000.0) as i64
    }
}

fn win(window: &str, percent: i32, resets_at: Option<i64>) -> GoQuota {
    GoQuota {
        window: window.into(),
        used_percent: percent,
        resets_at,
        text: None,
    }
}

fn text_win(window: &str, text: String) -> GoQuota {
    GoQuota {
        window: window.into(),
        used_percent: 0,
        resets_at: None,
        text: Some(text),
    }
}

// ---------- DeepSeek 余额 ----------

/// 查询 DeepSeek 余额（元）
pub fn fetch_balance(api_key: &str) -> QuotaResult<Balance> {
    if api_key.trim().is_empty() {
        return Err(QuotaError::AuthFailed("尚未设置 API 密钥".into()));
    }
    let client = client();
    let body = do_get(client, DEEPSEEK_ENDPOINT, api_key)?;
    parse_balance(&body)
}

fn parse_balance(body: &str) -> QuotaResult<Balance> {
    #[derive(Deserialize)]
    struct Info {
        currency: String,
        total_balance: String,
        #[serde(default)]
        granted_balance: Option<String>,
        #[serde(default)]
        topped_up_balance: Option<String>,
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
    let parse = |s: &Option<String>| s.as_deref().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
    Ok(Balance {
        amount,
        granted: parse(&picked.granted_balance),
        topped_up: parse(&picked.topped_up_balance),
        available: doc.is_available,
    })
}

// ---------- 自定义 Provider（任意 HTTP 端点 + 取值路径） ----------

/// 自定义 Provider 余额查询：GET url，请求头 JSON（`{{KEY}}` 替换为账户密钥），
/// 按点号路径取值 × scale。
pub fn fetch_custom(api_key: &str, query: &Option<super::CustomQuery>) -> QuotaResult<Balance> {
    let query = query.as_ref().ok_or_else(|| {
        QuotaError::ParseError("自定义 Provider 未配置查询参数（URL / 取值路径）".into())
    })?;
    if query.url.trim().is_empty() || query.path.trim().is_empty() {
        return Err(QuotaError::ParseError(
            "自定义 Provider 需配置 URL 与余额取值路径".into(),
        ));
    }
    let key = api_key.trim();
    let mut headers: Vec<(String, String)> = serde_json::from_str::<serde_json::Map<String, Value>>(
        query.headers.as_str(),
    )
    .unwrap_or_default()
    .into_iter()
    .filter_map(|(k, v)| {
        v.as_str()
            .map(|s| (k, if s.contains("{{KEY}}") { s.replace("{{KEY}}", key) } else { s.to_string() }))
    })
    .collect();
    if !headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("Authorization")) {
        headers.push(("Authorization".into(), format!("Bearer {}", key)));
    }
    let head_refs: Vec<(&str, &str)> = headers
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    let client = client();
    let body = do_get_hdrs(client, query.url.trim(), &head_refs)?;
    let doc: Value = serde_json::from_str(&body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    let remaining = walk(&doc, query.path.trim())
        .and_then(as_f64)
        .ok_or_else(|| {
            QuotaError::ParseError(format!(
                "取值路径「{}」未找到数字（响应结构可能与此路径不符）",
                query.path
            ))
        })?;
    let scale = if query.scale == 0.0 { 1.0 } else { query.scale };
    Ok(Balance {
        amount: remaining * scale,
        granted: 0.0,
        topped_up: 0.0,
        available: true,
    })
}

// ---------- OpenCode Go 套餐 ----------

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
    let body = do_get(client, GO_ENDPOINT, &key)?;
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
        out.push(win(kind, used_percent, resets_at));
    }
    if out.is_empty() {
        return Err(QuotaError::ParseError("响应中无有效窗口数据".into()));
    }
    Ok(out)
}

// ---------- Coding Plan 多厂商（借鉴 dsh-cost-meter 适配矩阵） ----------

/// Anthropic OAuth token 自动读取：~/.claude/.credentials.json
/// （宽松递归找 sk-ant- 开头的字符串；找不到返回空，用户可手动粘贴）
pub fn load_local_anthropic_token() -> String {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let path = std::path::Path::new(&home)
        .join(".claude")
        .join(".credentials.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let Ok(doc) = serde_json::from_str::<Value>(&text) else {
        return String::new();
    };
    find_oauth_token(&doc).unwrap_or_default()
}

/// 递归找 sk-ant- 开头的令牌字符串（测试用纯函数）
pub fn find_oauth_token(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if s.starts_with("sk-ant-") && s.len() > 20 => Some(s.clone()),
        Value::Object(m) => m.values().find_map(find_oauth_token),
        Value::Array(a) => a.iter().find_map(find_oauth_token),
        _ => None,
    }
}

/// 多厂商 Coding Plan 查询入口（kind 决定端点/鉴权/解析）
pub fn fetch_coding_windows(kind: AccountKind, key: &str) -> QuotaResult<Vec<GoQuota>> {
    match kind {
        AccountKind::Anthropic => {
            let key = if key.trim().is_empty() { load_local_anthropic_token() } else { key.trim().to_string() };
            if key.is_empty() {
                return Err(QuotaError::AuthFailed(
                    "未配置 Claude 密钥（也未找到 ~/.claude/.credentials.json OAuth token）".into(),
                ));
            }
            let client = client();
            let body = do_get_hdrs(
                client,
                "https://api.anthropic.com/api/oauth/usage",
                &[("Authorization", &format!("Bearer {}", key.trim()))],
            )?;
            parse_anthropic(&body)
        }
        AccountKind::Zai => fetch_multi(
            key,
            &[
                "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
                "https://api.z.ai/api/monitor/usage/quota/limit",
                "https://api.z.ai/api/coding/paas/v3/dashboard/billing/coding_plan/usage",
                "https://open.bigmodel.cn/api/coding/paas/v3/dashboard/billing/coding_plan/usage",
            ],
            parse_zai,
        ),
        AccountKind::Minimax => fetch_multi(
            key,
            &[
                "https://www.minimaxi.com/v1/token_plan/remains",
                "https://www.minimax.io/v1/token_plan/remains",
                "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
            ],
            parse_minimax,
        ),
        AccountKind::Kimi => {
            // 订阅配额端点需专用 UA；404 回退；最终回落 PAYG 余额端点
            let mut last = QuotaError::AuthFailed("未配置 Kimi 密钥".into());
            for (url, ua, parser) in [
                ("https://api.kimi.com/coding/v1/usages", "KimiCLI/1.6", parse_kimi_usage as fn(&str) -> QuotaResult<Vec<GoQuota>>),
                ("https://api.kimi.com/coding/v1/usage", "KimiCLI/1.6", parse_kimi_usage),
                ("https://api.moonshot.cn/v1/users/me/balance", UA, parse_kimi_balance),
            ] {
                match fetch_json(key, url, ua) {
                    Ok(body) => match parser(&body) {
                        Ok(w) => return Ok(w),
                        Err(e) => last = e,
                    },
                    Err(e) => last = e,
                }
            }
            Err(last)
        }
        AccountKind::Openrouter => {
            let client = client();
            let body = do_get_hdrs(
                client,
                "https://openrouter.ai/api/v1/credits",
                &[("Authorization", &format!("Bearer {}", key.trim()))],
            )?;
            parse_openrouter(&body)
        }
        AccountKind::Siliconflow => {
            let client = client();
            let body = do_get_hdrs(
                client,
                "https://api.siliconflow.cn/v1/user/info",
                &[("Authorization", &format!("Bearer {}", key.trim()))],
            )?;
            parse_siliconflow(&body)
        }
        AccountKind::Command => {
            let client = client();
            let body = do_get_hdrs(
                client,
                "https://api.commandcode.ai/alpha/billing/credits",
                &[("Authorization", &format!("Bearer {}", key.trim()))],
            )?;
            parse_commandcode(&body)
        }
        AccountKind::Volc => fetch_volc(key),
        _ => Err(QuotaError::ParseError("该账户类型不支持窗口查询".into())),
    }
}

/// 多端点回退：认证失败/解析成功即返回；其余错误尝试下一端点
fn fetch_multi(
    key: &str,
    urls: &[&str],
    parser: fn(&str) -> QuotaResult<Vec<GoQuota>>,
) -> QuotaResult<Vec<GoQuota>> {
    if key.trim().is_empty() {
        return Err(QuotaError::AuthFailed("未配置密钥".into()));
    }
    let key = format!("Bearer {}", key.trim());
    let mut last = QuotaError::AuthFailed("未配置密钥".into());
    for url in urls {
        match fetch_json(key.trim(), url, UA) {
            Ok(body) => match parser(&body) {
                Ok(w) => return Ok(w),
                Err(e) => last = e,
            },
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// Bearer 请求并返回文本
fn fetch_json(key: &str, url: &str, ua: &str) -> QuotaResult<String> {
    let client = client();
    do_get_hdrs(
        client,
        url,
        &[("Authorization", key), ("User-Agent", ua)],
    )
}

/// 解析 200 但业务失败的错误信封（{code,msg}）为错误信息
fn envelope_err(doc: &Value, provider: &str) -> Option<QuotaError> {
    let obj = doc.as_object()?;
    let code = obj.get("code").and_then(|v| v.as_i64())?;
    if code == 0 {
        return None;
    }
    let msg = obj
        .get("msg")
        .or_else(|| obj.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or("未知错误");
    Some(QuotaError::ParseError(format!("{provider}: {msg}")))
}

// ---- Anthropic ----

/// Anthropic 子配额窗口（five_hour_sonnet / seven_day_opus 等）只描述单一模型系列，丢弃
fn is_sub_quota(name: &str) -> bool {
    let lower = name.to_lowercase();
    if let Some(rest) = lower
        .strip_prefix("five")
        .and_then(|r| r.strip_prefix("_hour").or_else(|| r.strip_prefix("-hour")).or_else(|| r.strip_prefix("hour")))
    {
        return rest.starts_with('_') || rest.starts_with('-');
    }
    if let Some(rest) = lower
        .strip_prefix("seven")
        .and_then(|r| r.strip_prefix("_day").or_else(|| r.strip_prefix("-day")).or_else(|| r.strip_prefix("day")))
    {
        return rest.starts_with('_') || rest.starts_with('-');
    }
    false
}

/// { five_hour: { utilization, resets_at }, seven_day: {...} ... }；子配额窗口丢弃
fn parse_anthropic(body: &str) -> QuotaResult<Vec<GoQuota>> {
    let doc: Value = serde_json::from_str(body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    let mut out = Vec::new();
    let Some(obj) = doc.as_object() else {
        return Err(envelope_err(&doc, "Anthropic").unwrap_or(QuotaError::ParseError("响应非对象".into())));
    };
    for (name, raw) in obj {
        if is_sub_quota(name) {
            continue;
        }
        let Some(r) = raw.as_object() else { continue };
        let Some(pct) = normalize_percent(pick(r, &["utilization", "used_percentage"])) else {
            continue;
        };
        let resets_at = norm_reset(pick(r, &["resets_at", "reset_at"]));
        let key = match name {
            n if n.starts_with("five_hour") || n.starts_with("fiveHour") => "5h",
            n if n.starts_with("seven_day") || n.starts_with("sevenDay") => "7d",
            other => other,
        };
        out.push(win(key, clamp_pct(pct), resets_at));
    }
    if out.is_empty() {
        return Err(QuotaError::ParseError("Anthropic: 响应中无可用窗口".into()));
    }
    Ok(out)
}

// ---- Z.ai / 智谱 ----

/// 兼容三种形态：{data:{limits:[{type,unit,percentage,nextResetTime,usage,currentValue}]}} /
/// {plans:[{total_units,used_units,period_end}]} / 平铺窗口对象
fn parse_zai(body: &str) -> QuotaResult<Vec<GoQuota>> {
    let doc: Value = serde_json::from_str(body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    if let Some(e) = envelope_err(&doc, "Z.ai") {
        return Err(e);
    }
    let mut out: Vec<GoQuota> = Vec::new();
    // 形态零：监控端点 quota/limit
    if let Some(limits) = doc
        .get("data")
        .and_then(|d| d.get("limits"))
        .and_then(|l| l.as_array())
    {
        let mut five_hour: Option<(i32, Option<i64>)> = None;
        let mut weekly: Option<(i32, Option<i64>)> = None;
        let mut rest: Vec<(f64, Option<i64>, i64)> = Vec::new();
        for limit in limits {
            let Some(l) = limit.as_object() else { continue };
            let ty = l.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if ty != "TOKENS_LIMIT" && ty != "CREDIT_LIMIT" {
                continue;
            }
            let pct = l
                .get("percentage")
                .and_then(|v| v.as_f64())
                .or_else(|| {
                    let used = l.get("usage").and_then(|v| v.as_f64())?;
                    let cur = l.get("currentValue").and_then(|v| v.as_f64())?;
                    if used > 0.0 { Some(cur / used * 100.0) } else { None }
                });
            let Some(pct) = pct else { continue };
            let reset = norm_reset(l.get("nextResetTime"));
            let reset_ms = l
                .get("nextResetTime")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            match l.get("unit").and_then(|v| v.as_i64()) {
                Some(3) if five_hour.is_none() => five_hour = Some((clamp_pct(pct), reset)),
                Some(6) if weekly.is_none() => weekly = Some((clamp_pct(pct), reset)),
                _ => rest.push((pct, reset, reset_ms)),
            }
        }
        rest.sort_by(|a, b| a.2.cmp(&b.2));
        for (pct, reset, _) in rest {
            if five_hour.is_none() {
                five_hour = Some((clamp_pct(pct), reset));
            } else if weekly.is_none() {
                weekly = Some((clamp_pct(pct), reset));
            }
        }
        if let Some((p, r)) = five_hour {
            out.push(win("5h", p, r));
        }
        if let Some((p, r)) = weekly {
            out.push(win("weekly", p, r));
        }
        if !out.is_empty() {
            return Ok(out);
        }
    }
    // 形态一：plans 数组
    if let Some(plans) = doc.get("plans").and_then(|p| p.as_array()) {
        for plan in plans {
            let Some(p) = plan.as_object() else { continue };
            let total = p.get("total_units").and_then(as_f64);
            let used = p.get("used_units").and_then(as_f64);
            let pct = match (total, used) {
                (Some(t), Some(u)) if t > 0.0 => Some(u / t * 100.0),
                _ => normalize_percent(pick(p, &["utilization", "percent", "used_percentage"])),
            };
            let Some(pct) = pct else { continue };
            let period_end = p.get("period_end").and_then(as_f64);
            let span_ms = period_end.map(|e| e * 1000.0 - chrono::Utc::now().timestamp_millis() as f64);
            let key = if span_ms.is_some_and(|s| s > 24.0 * 3600_000.0) { "weekly" } else { "5h" };
            // period_end 为 unix 秒
            let reset = match period_end {
                Some(e) if e > 0.0 => Some(ts_to_unix(e)),
                _ => None,
            };
            out.push(win(key, clamp_pct(pct), reset));
        }
    }
    // 形态二：平铺窗口对象
    if let Some(obj) = doc.as_object() {
        for (name, raw) in obj {
            if name == "plans" || name == "data" {
                continue;
            }
            let Some(r) = raw.as_object() else { continue };
            let Some(pct) = normalize_percent(pick(r, &["utilization", "percent", "used_percentage"]))
            else {
                continue;
            };
            let reset = norm_reset(pick(r, &["resets_at", "reset_at", "resetsAt"]));
            let key = match name.as_str() {
                "fiveHour" | "five_hour" | "5h" => "5h",
                "weekly" | "week" | "seven_day" => "weekly",
                other => other,
            };
            out.push(win(key, clamp_pct(pct), reset));
        }
    }
    if out.is_empty() {
        return Err(QuotaError::ParseError("Z.ai: 响应中无可用窗口".into()));
    }
    Ok(out)
}

// ---- MiniMax ----

/// 单条记录的 5h/7d 剩余百分比 → 已用%
fn minimax_from_row(row: &Value) -> Vec<GoQuota> {
    let mut out = Vec::new();
    let Some(r) = row.as_object() else { return out };
    let remaining_percent = |keys: &[&str]| -> Option<f64> {
        for k in keys {
            if let Some(v) = r.get(*k).and_then(as_f64) {
                let v = if v <= 1.0 { v * 100.0 } else { v };
                return Some(v.clamp(0.0, 100.0));
            }
        }
        None
    };
    // 5h 窗口（status=3 表示不限量）
    if r.get("current_interval_status").and_then(|v| v.as_i64()) != Some(3) {
        if let Some(remain) = remaining_percent(&["current_interval_remaining_percent"])
            .or_else(|| {
                let total = r.get("current_interval_total_count").and_then(as_f64)?;
                let remain = r.get("current_interval_remain_count").and_then(as_f64);
                let used = r.get("current_interval_usage_count").and_then(as_f64);
                if total > 0.0 {
                    remain.map(|re| re / total * 100.0)
                        .or_else(|| used.map(|u| (total - u) / total * 100.0))
                } else {
                    None
                }
            })
        {
            out.push(win(
                "5h",
                clamp_pct(100.0 - remain),
                norm_reset(pick(r, &["end_time", "reset_time", "next_reset_time"])),
            ));
        }
    }
    // 7d 窗口
    if r.get("current_weekly_status").and_then(|v| v.as_i64()) != Some(3) {
        if let Some(remain) = remaining_percent(&["current_weekly_remaining_percent"])
            .or_else(|| {
                let total = r.get("current_weekly_total_count").and_then(as_f64)?;
                let remain = r.get("current_weekly_remain_count").and_then(as_f64);
                if total > 0.0 {
                    remain.map(|re| re / total * 100.0)
                } else {
                    None
                }
            })
        {
            out.push(win(
                "7d",
                clamp_pct(100.0 - remain),
                norm_reset(r.get("weekly_end_time")),
            ));
        }
    }
    out
}

/// 首选 general / MiniMax-M* 行
fn minimax_pick_row(rows: &[Value]) -> Option<&Value> {
    for row in rows {
        if let Some(name) = row.get("model_name").and_then(|v| v.as_str()) {
            if name.eq_ignore_ascii_case("general") {
                return Some(row);
            }
        }
    }
    rows.iter()
        .find(|r| {
            r.get("model_name")
                .and_then(|v| v.as_str())
                .is_some_and(|n| n.to_lowercase().starts_with("minimax-m"))
        })
        .or_else(|| rows.iter().find(|r| !minimax_from_row(r).is_empty()))
        .or_else(|| rows.first())
}

fn parse_minimax(body: &str) -> QuotaResult<Vec<GoQuota>> {
    let doc: Value = serde_json::from_str(body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    if let Some(e) = envelope_err(&doc, "MiniMax") {
        return Err(e);
    }
    let payload = if doc.get("data").is_some_and(|d| d.is_object()) {
        doc.get("data").unwrap()
    } else {
        &doc
    };
    // 现行 Token Plan：model_remains
    if let Some(rows) = doc
        .get("model_remains")
        .or_else(|| payload.get("model_remains"))
        .and_then(|v| v.as_array())
    {
        if let Some(row) = minimax_pick_row(rows) {
            let w = minimax_from_row(row);
            if !w.is_empty() {
                return Ok(w);
            }
        }
        // 旧计数制：无 remaining_percent、靠 total>0 汇总
        let mut total = 0.0;
        let mut used = 0.0;
        let mut found = false;
        for row in rows {
            let t = row
                .get("current_interval_total_count")
                .or_else(|| row.get("total"))
                .and_then(as_f64);
            let u = row
                .get("current_interval_usage_count")
                .or_else(|| row.get("used"))
                .and_then(as_f64);
            if let Some(t) = t {
                if t > 0.0 {
                    found = true;
                    total += t;
                    used += u.unwrap_or(0.0);
                }
            }
        }
        if found && total > 0.0 {
            return Ok(vec![win("current", clamp_pct(used / total * 100.0), None)]);
        }
    }
    // 平铺形态
    let flat = minimax_from_row(payload);
    if !flat.is_empty() {
        return Ok(flat);
    }
    // 窗口数组形态
    for key in ["token_plan_remains", "plan_remains", "remains", "windows"] {
        if let Some(rows) = doc.get(key).and_then(|v| v.as_array()) {
            let mut out = Vec::new();
            for (i, row) in rows.iter().enumerate() {
                let Some(r) = row.as_object() else { continue };
                let total = pick(r, &["current_interval_total_count", "total_count", "total", "limit"]).and_then(as_f64);
                let used = pick(r, &["current_interval_usage_count", "used_count", "usage_count", "used"]).and_then(as_f64);
                let remain = pick(r, &["current_interval_remain_count", "remain_count", "remain", "remaining"]).and_then(as_f64);
                let pct = match (total, used) {
                    (Some(t), Some(u)) if t > 0.0 => Some(u / t * 100.0),
                    _ => match (total, remain) {
                        (Some(t), Some(re)) if t > 0.0 => Some((t - re) / t * 100.0),
                        _ => normalize_percent(pick(r, &["utilization", "percent", "used_percentage"])),
                    },
                };
                let Some(pct) = pct else { continue };
                let label = pick(r, &["interval", "interval_type", "window_type", "type", "name"])
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("window{}", i + 1));
                out.push(win(&label, clamp_pct(pct), norm_reset(pick(r, &["reset_time", "resets_at", "next_reset_time", "reset_at"]))));
            }
            if !out.is_empty() {
                return Ok(out);
            }
        }
    }
    Err(QuotaError::ParseError("MiniMax: 响应中无可用窗口".into()))
}

// ---- Kimi ----

/// Kimi Code 订阅配额：{ usage:{limit,used,remaining,resetTime} weekly, limits:[{window,detail}] }
fn parse_kimi_usage(body: &str) -> QuotaResult<Vec<GoQuota>> {
    let doc: Value = serde_json::from_str(body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    if let Some(e) = envelope_err(&doc, "Kimi") {
        return Err(e);
    }
    let mut out = Vec::new();
    if let Some(usage) = doc.get("usage").and_then(|u| u.as_object()) {
        let total = usage.get("limit").and_then(as_f64);
        let used = usage.get("used").and_then(as_f64);
        let remain = usage.get("remaining").and_then(as_f64);
        let pct = match (total, used) {
            (Some(t), Some(u)) if t > 0.0 => Some(u / t * 100.0),
            _ => match (total, remain) {
                (Some(t), Some(re)) if t > 0.0 => Some((t - re) / t * 100.0),
                _ => None,
            },
        };
        if let Some(pct) = pct {
            out.push(win(
                "weekly",
                clamp_pct(pct),
                norm_reset(usage.get("resetTime")),
            ));
        }
    }
    if let Some(limits) = doc.get("limits").and_then(|l| l.as_array()) {
        for (i, row) in limits.iter().enumerate() {
            let Some(r) = row.as_object() else { continue };
            let detail = match r.get("detail") {
                Some(Value::Object(d)) => d,
                _ => continue,
            };
            let total = detail.get("limit").and_then(as_f64);
            let used = detail.get("used").and_then(as_f64);
            let remain = detail.get("remaining").and_then(as_f64);
            let pct = match (total, used) {
                (Some(t), Some(u)) if t > 0.0 => Some(u / t * 100.0),
                _ => match (total, remain) {
                    (Some(t), Some(re)) if t > 0.0 => Some((t - re) / t * 100.0),
                    _ => None,
                },
            };
            let Some(pct) = pct else { continue };
            // 窗口名：duration + 单位（5h / 7d）
            let duration = r
                .get("window")
                .and_then(|w| w.get("duration"))
                .and_then(as_f64);
            let unit = r
                .get("window")
                .and_then(|w| w.get("timeUnit"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let unit_c = if unit.to_lowercase().starts_with("hour") {
                "h"
            } else if unit.to_lowercase().starts_with("day") {
                "d"
            } else if unit.to_lowercase().starts_with("week") {
                "w"
            } else if unit.to_lowercase().starts_with("minute") {
                "m"
            } else if unit.to_lowercase().starts_with("month") {
                "mo"
            } else {
                unit
            };
            let name = match (duration, unit_c.is_empty()) {
                (Some(d), false) if d > 0.0 => format!("{}{}", d, unit_c),
                _ => format!("window{}", i + 1),
            };
            out.push(win(&name, clamp_pct(pct), norm_reset(pick(detail, &["resetTime", "reset_at", "resetsAt"]))));
        }
    }
    if out.is_empty() {
        return Err(QuotaError::ParseError("Kimi: 响应中无可用窗口".into()));
    }
    Ok(out)
}

/// Kimi PAYG 余额（人民币分 → 元；文本窗口）
fn parse_kimi_balance(body: &str) -> QuotaResult<Vec<GoQuota>> {
    let doc: Value = serde_json::from_str(body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    let raw = doc
        .get("available_balance")
        .or_else(|| doc.get("balance"))
        .or_else(|| doc.get("cash_balance"))
        .or_else(|| doc.get("data").and_then(|d| d.get("available_balance")))
        .and_then(as_f64);
    let Some(n) = raw else {
        return Err(QuotaError::ParseError("Kimi: 响应中无余额".into()));
    };
    if n < 0.0 {
        return Err(QuotaError::ParseError("Kimi: 余额非法".into()));
    }
    let cny = if n >= 100.0 { n / 100.0 } else { n };
    Ok(vec![text_win("balance", format!("余额 ¥{:.2}", cny))])
}

// ---- OpenRouter ----

/// { data: { total_credits, total_usage } } → 已用%
fn parse_openrouter(body: &str) -> QuotaResult<Vec<GoQuota>> {
    let doc: Value = serde_json::from_str(body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    let d = doc.get("data").filter(|v| v.is_object()).unwrap_or(&doc);
    let total = d.get("total_credits").or_else(|| d.get("credits")).and_then(as_f64);
    let used = d.get("total_usage").or_else(|| d.get("usage")).and_then(as_f64);
    match (total, used) {
        (Some(t), Some(u)) if t > 0.0 && u >= 0.0 => Ok(vec![win(
            "credits",
            clamp_pct(u / t * 100.0),
            norm_reset(d.get("resets_at").or_else(|| d.get("next_reset_time"))),
        )]),
        _ => Err(QuotaError::ParseError("OpenRouter: 响应中无有效额度数据".into())),
    }
}

// ---- SiliconFlow ----

/// 账户余额文本窗口
fn parse_siliconflow(body: &str) -> QuotaResult<Vec<GoQuota>> {
    let doc: Value = serde_json::from_str(body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    let d = doc.get("data").filter(|v| v.is_object()).unwrap_or(&doc);
    let raw = d
        .get("balance")
        .or_else(|| d.get("amount"))
        .or_else(|| d.get("remain"))
        .or_else(|| d.get("remaining"))
        .and_then(as_f64);
    match raw {
        Some(n) if n >= 0.0 => Ok(vec![text_win("balance", format!("余额 ¥{:.2}", n))]),
        _ => Err(QuotaError::ParseError("SiliconFlow: 响应中无余额".into())),
    }
}

// ---- CommandCode ----

/// { windowLimits: { fiveHour: {used,cap,resetAt}, weekly: {...} }, credits: { monthlyCredits } }
fn parse_commandcode(body: &str) -> QuotaResult<Vec<GoQuota>> {
    let doc: Value = serde_json::from_str(body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    if let Some(e) = envelope_err(&doc, "CommandCode") {
        return Err(e);
    }
    let mut out = Vec::new();
    if let Some(limits) = doc.get("windowLimits").and_then(|l| l.as_object()) {
        for (name, raw) in limits {
            let Some(r) = raw.as_object() else { continue };
            let used = r.get("used").and_then(as_f64);
            let cap = r.get("cap").and_then(as_f64);
            if let (Some(u), Some(c)) = (used, cap) {
                if c > 0.0 && u >= 0.0 {
                    let key = match name.as_str() {
                        "fiveHour" | "five_hour" | "5h" => "5h",
                        "weekly" | "week" => "weekly",
                        other => other,
                    };
                    out.push(win(
                        key,
                        clamp_pct(u / c * 100.0),
                        norm_reset(r.get("resetAt")),
                    ));
                }
            }
        }
    }
    if let Some(monthly) = doc
        .get("credits")
        .and_then(|c| c.get("monthlyCredits"))
        .and_then(as_f64)
    {
        if monthly >= 0.0 {
            out.push(text_win("monthly", format!("余额 ${:.2}", monthly)));
        }
    }
    if out.is_empty() {
        return Err(QuotaError::ParseError("CommandCode: 响应中无可用数据".into()));
    }
    Ok(out)
}

// ---- 火山方舟 Volcano Ark（AK/SK HMAC 签名） ----

const VOLC_HOST: &str = "open.volcengineapi.com";
const VOLC_REGION: &str = "cn-beijing";
const VOLC_SERVICE: &str = "ark";
const VOLC_ACTIONS: [&str; 4] = [
    "GetCodingPlanUsage",
    "GetAFPUsage",
    "GetUsageDetails",
    "GetPersonalPlan",
];

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    use hmac::{Hmac, Mac};
    let mut mac: Hmac<sha2::Sha256> = Hmac::new_from_slice(key).expect("hmac accepts any key");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(data);
    h.finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// 火山引擎 OpenAPI HMAC-SHA256 签名头（提炼自 dsh-cost-meter / CCswitch 实现）
pub fn volc_authorization(
    access_key_id: &str,
    secret_access_key: &str,
    query: &[(&str, &str)],
    x_date: &str,
) -> Vec<(&'static str, String)> {
    let date = &x_date[..8];
    let body_sha = sha256_hex(b"");
    // query 参数排序编码（Action/Version 均为字母数字，简化转义）
    let mut qs: Vec<String> = query
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect();
    qs.sort();
    let qs = qs.join("&");
    let signed_headers = "host;x-content-sha256;x-date";
    let canonical_headers =
        format!("host:{}\nx-content-sha256:{}\nx-date:{}", VOLC_HOST, body_sha, x_date);
    let canonical_request = format!(
        "GET\n/\n{}\n{}\n\n{}\n{}",
        qs, canonical_headers, signed_headers, body_sha
    );
    let credential_scope = format!("{}/{}/{}/request", date, VOLC_REGION, VOLC_SERVICE);
    let string_to_sign = format!(
        "HMAC-SHA256\n{}\n{}\n{}",
        x_date,
        credential_scope,
        sha256_hex(canonical_request.as_bytes())
    );
    let k_date = hmac_sha256(secret_access_key.as_bytes(), date.as_bytes());
    let k_region = hmac_sha256(&k_date, VOLC_REGION.as_bytes());
    let k_service = hmac_sha256(&k_region, VOLC_SERVICE.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"request");
    let signature = hmac_sha256(&k_signing, string_to_sign.as_bytes())
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    let authorization = format!(
        "HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        access_key_id, credential_scope, signed_headers, signature
    );
    vec![
        ("Host", VOLC_HOST.to_string()),
        ("X-Date", x_date.to_string()),
        ("X-Content-Sha256", body_sha),
        ("Authorization", authorization),
    ]
}

/// 按 Action 白名单依次尝试（签名错误/解析失败换下一 Action）
fn fetch_volc(key: &str) -> QuotaResult<Vec<GoQuota>> {
    let (ak, sk) = split_volc_key(key)?;
    let mut last = QuotaError::AuthFailed("火山方舟凭据无效".into());
    let client = client();
    for action in VOLC_ACTIONS {
        let x_date = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let query = [("Action", action), ("Version", "2024-01-01")];
        let headers = volc_authorization(&ak, &sk, &query, &x_date);
        let refs: Vec<(&str, &str)> = headers.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let url = format!(
            "https://{}?Action={}&Version=2024-01-01",
            VOLC_HOST, action
        );
        match do_get_hdrs(client, &url, &refs) {
            Ok(body) => match parse_volc(&body) {
                Ok(w) => return Ok(w),
                Err(e) => last = e,
            },
            Err(e) => {
                // 401/403 属预期（该 Action 不可用或无权限），继续尝试下一 Action
                last = e;
            }
        }
    }
    Err(last)
}

/// 火山的 Key 为 "AK:SK" 或 "AK SK"
fn split_volc_key(key: &str) -> Result<(String, String), QuotaError> {
    let key = key.trim();
    let parts: Vec<&str> = if key.contains(':') {
        key.splitn(2, ':').collect()
    } else {
        key.split_whitespace().collect()
    };
    if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
        Ok((parts[0].to_string(), parts[1].to_string()))
    } else {
        Err(QuotaError::AuthFailed(
            "火山方舟凭据格式应为 AccessKey:SecretKey".into(),
        ))
    }
}

fn parse_volc(body: &str) -> QuotaResult<Vec<GoQuota>> {
    let doc: Value = serde_json::from_str(body).map_err(|e| QuotaError::ParseError(e.to_string()))?;
    // 业务信封错误
    if let Some(err) = doc
        .get("ResponseMetadata")
        .and_then(|m| m.get("Error"))
        .and_then(|e| e.get("Message"))
        .and_then(|v| v.as_str())
    {
        return Err(QuotaError::ParseError(format!("火山方舟: {err}")));
    }
    let mut out = Vec::new();
    // 形态：arkcli items → periods
    if let Some(items) = doc.get("items").and_then(|v| v.as_array()) {
        let item = items
            .iter()
            .find(|i| {
                i.get("product")
                    .and_then(|p| p.as_str())
                    .is_some_and(|s| s.to_lowercase().contains("coding"))
            })
            .or_else(|| items.iter().find(|i| i.get("periods").is_some_and(|p| p.is_array())));
        if let Some(item) = item {
            if let Some(periods) = item.get("periods").and_then(|p| p.as_array()) {
                for p in periods {
                    if let Some(entry) = volc_entry(p, &["percent"], &["label", "name", "type", "quotaType", "window"]) {
                        out.push(entry);
                    }
                }
            }
        }
    }
    // 形态：Result.QuotaUsage / UsageDetails 数组
    let result = doc
        .get("Result")
        .or_else(|| doc.get("result"))
        .or_else(|| doc.get("data"));
    let quota_list = result
        .and_then(|r| r.get("QuotaUsage").or_else(|| r.get("UsageDetails")))
        .and_then(|v| v.as_array())
        .or_else(|| result.filter(|r| r.is_array()).and_then(|r| r.as_array()));
    if let Some(list) = quota_list {
        for entry in list {
            if let Some(e) = volc_entry(
                entry,
                &["Percent", "percent", "percentage", "UsedPercent", "usedPercent"],
                &["Level", "level", "QuotaType", "quotaType", "Type", "type", "Label", "label", "Period", "period", "Name", "name"],
            ) {
                out.push(e);
            }
        }
    }
    if out.is_empty() {
        // 兜底：平铺窗口对象
        if let Some(root) = result {
            for (name, raw) in root.as_object().unwrap_or(&serde_json::Map::new()) {
                if name == "ResponseMetadata" {
                    continue;
                }
                if raw.is_object() {
                    if let Some(r) = raw.as_object() {
                        if let Some(pct) = normalize_percent(pick(r, &["utilization", "percent", "used_percentage", "Percent"])) {
                            out.push(win(
                                &norm_volc_window(name),
                                clamp_pct(pct),
                                norm_reset(pick(r, &["resets_at", "reset_at", "resetsAt", "resetAt", "resetTime"])),
                            ));
                        }
                    }
                }
            }
        }
    }
    if out.is_empty() {
        return Err(QuotaError::ParseError("火山方舟: 响应中无可用窗口".into()));
    }
    Ok(out)
}

/// 单条火山窗口条目 → GoQuota（percent 直取，或 used/total / remaining 反推）
fn volc_entry(entry: &Value, pct_keys: &[&str], name_keys: &[&str]) -> Option<GoQuota> {
    let e = entry.as_object()?;
    let pct = normalize_percent(pick(e, pct_keys))
        .or_else(|| {
            let total = pick(e, &["Total", "total", "Limit", "limit", "Quota", "quota", "Capacity", "capacity", "Max", "max", "TotalQuota", "totalQuota"]).and_then(as_f64)?;
            let used = pick(e, &["Used", "used", "Usage", "usage", "Consumed", "consumed", "CurrentValue", "currentValue", "UsedQuota", "usedQuota"]).and_then(as_f64)?;
            if total > 0.0 {
                Some(used / total * 100.0)
            } else {
                None
            }
        });
    let pct = pct?;
    let name = pick(e, name_keys)?.as_str()?;
    Some(win(
        &norm_volc_window(name),
        clamp_pct(pct),
        norm_reset(pick(e, &["ResetTime", "resetTime", "ResetAt", "resetAt", "NextResetTime", "nextResetTime", "ExpiresAt", "expiresAt", "EndTime", "endTime", "ResetTimestamp", "resetTimestamp"])),
    ))
}

fn norm_volc_window(raw: &str) -> String {
    let s: String = raw.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if s.contains("5h") || s.contains("fivehour") || s == "fiveh" || s == "session" || s == "rolling" {
        "5h".into()
    } else if s.contains("daily") || s == "day" || s == "1d" || s == "afpdaily" {
        "daily".into()
    } else if s.contains("week") || s == "7d" || s == "seven" {
        "weekly".into()
    } else if s.contains("month") || s == "30d" {
        "monthly".into()
    } else if raw.contains('小') || raw.contains('时') {
        "5h".into()
    } else if raw.contains('日') {
        "daily".into()
    } else if raw.contains('周') {
        "weekly".into()
    } else if raw.contains('月') {
        "monthly".into()
    } else {
        raw.trim().replace(' ', "_")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_balance_cny() {
        let body = r#"{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"12.34","granted_balance":"2.00","topped_up_balance":"10.34"},{"currency":"USD","total_balance":"1.0"}]}"#;
        let b = parse_balance(body).unwrap();
        assert_eq!(b.amount, 12.34);
        assert_eq!(b.granted, 2.0);
        assert_eq!(b.topped_up, 10.34);
        assert!(b.available);
    }

    #[test]
    fn parse_balance_fallback_first() {
        let body = r#"{"is_available":false,"balance_infos":[{"currency":"USD","total_balance":"2.5"}]}"#;
        let b = parse_balance(body).unwrap();
        assert_eq!(b.amount, 2.5);
        assert_eq!(b.granted, 0.0);
        assert_eq!(b.topped_up, 0.0);
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
        assert_eq!(q[1].used_percent, 25);
        assert!(q[0].resets_at.is_some());
    }

    #[test]
    fn parse_usage_empty_fails() {
        assert!(parse_usage("{}").is_err());
        assert!(parse_usage(r#"{"usage":{"rolling":null,"weekly":null,"monthly":null}}"#).is_err());
    }

    // ---------- 通用工具 ----------

    #[test]
    fn walk_path_nested() {
        let v: Value = serde_json::from_str(r#"{"data":{"quota":{"remaining": "12.5"}}}"#).unwrap();
        assert_eq!(walk(&v, "data.quota.remaining").and_then(as_f64), Some(12.5));
        assert_eq!(walk(&v, "data.missing"), None);
        assert_eq!(walk(&v, "data.quota.remaining.x"), None);
    }

    #[test]
    fn percent_normalization() {
        assert_eq!(normalize_percent(Some(&Value::from(0.25))), Some(25.0));
        assert_eq!(normalize_percent(Some(&Value::from(80.0))), Some(80.0));
        assert_eq!(normalize_percent(Some(&Value::from(200.0))), Some(100.0));
        assert_eq!(normalize_percent(Some(&Value::String("45".into()))), Some(45.0));
        assert_eq!(normalize_percent(Some(&Value::from(-1))), None);
    }

    #[test]
    fn reset_normalization() {
        let iso = Value::String("2026-08-19T12:00:00Z".into());
        let secs = norm_reset(Some(&iso)).unwrap();
        assert_eq!(secs, 1787140800);
        let raw_sec = norm_reset(Some(&Value::from(1787140800f64)));
        assert_eq!(raw_sec, Some(1787140800));
        let raw_ms = norm_reset(Some(&Value::from(1787140800000f64)));
        assert_eq!(raw_ms, Some(1787140800));
        assert_eq!(norm_reset(Some(&Value::from(0f64))), None);
        assert_eq!(norm_reset(None), None);
    }

    #[test]
    fn find_token_recursive() {
        let v: Value = serde_json::from_str(
            r#"{"user":{"tokens":[{"token":"sk-ant-oat01abcdefghijklmnopqrstuvwxyz123456"}]}}"#,
        )
        .unwrap();
        assert_eq!(
            find_oauth_token(&v).unwrap(),
            "sk-ant-oat01abcdefghijklmnopqrstuvwxyz123456"
        );
        assert!(find_oauth_token(&Value::Null).is_none());
        let no: Value = serde_json::from_str(r#"{"a":1,"b":"hello"}"#).unwrap();
        assert!(find_oauth_token(&no).is_none());
    }

    // ---------- Custom Provider ----------

    #[test]
    fn custom_fetch_without_network_fails_cleanly() {
        // 无 query 配置 → 明确报错而非 panic
        let e = fetch_custom("k", &None).unwrap_err();
        assert!(e.to_string().contains("未配置查询参数"));
    }

    // ---------- Anthropic ----------

    #[test]
    fn anthropic_parses_windows_and_skips_subquotas() {
        let body = r#"{"five_hour":{"utilization":42.5,"resets_at":1784433600},"seven_day":{"utilization":10,"resets_at":1785038400},"seven_day_sonnet":{"utilization":3}}"#;
        let w = parse_anthropic(body).unwrap();
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].window, "5h");
        assert_eq!(w[0].used_percent, 43); // 42.5 → 43
        assert_eq!(w[1].window, "7d");
        assert_eq!(w[1].used_percent, 10);
    }

    #[test]
    fn anthropic_empty_fails() {
        assert!(parse_anthropic("{}").is_err());
        assert!(parse_anthropic(r#"{"five_hour":{}}"#).is_err());
    }

    // ---------- Z.ai ----------

    #[test]
    fn zai_monitor_limits_form() {
        let body = r#"{"data":{"limits":[
            {"type":"TOKENS_LIMIT","unit":3,"percentage":60,"nextResetTime":"2026-08-19T08:00:00Z"},
            {"type":"TOKENS_LIMIT","unit":6,"percentage":20,"nextResetTime":"2026-08-23T16:00:00Z"}
        ]}}"#;
        let w = parse_zai(body).unwrap();
        assert_eq!(w[0].window, "5h");
        assert_eq!(w[0].used_percent, 60);
        assert_eq!(w[1].window, "weekly");
        assert_eq!(w[1].used_percent, 20);
    }

    #[test]
    fn zai_plans_form() {
        let body = r#"{"plans":[{"total_units":1000,"used_units":250,"period_end":1784433600}]}"#;
        let w = parse_zai(body).unwrap();
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].window, "5h");
        assert_eq!(w[0].used_percent, 25);
    }

    #[test]
    fn zai_flat_form() {
        let body = r#"{"five_hour":{"utilization":30,"resets_at":1784433600},"weekly":{"percent":5}}"#;
        let w = parse_zai(body).unwrap();
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].window, "5h");
        assert_eq!(w[1].window, "weekly");
        assert_eq!(w[1].used_percent, 5);
    }

    // ---------- MiniMax ----------

    #[test]
    fn minimax_token_plan_remains() {
        let body = r#"{"model_remains":[
            {"model_name":"general","current_interval_remaining_percent":70,"current_interval_status":1,"current_weekly_remaining_percent":40,"current_weekly_status":1,"weekly_end_time":"2026-08-23T16:00:00Z"}
        ]}"#;
        let w = parse_minimax(body).unwrap();
        // 剩余 70% → 已用 30%（5h）；周剩余 40% → 已用 60%（7d）
        assert_eq!(w[0].window, "5h");
        assert_eq!(w[0].used_percent, 30);
        assert_eq!(w[1].window, "7d");
        assert_eq!(w[1].used_percent, 60);
    }

    // ---------- Kimi ----------

    #[test]
    fn kimi_coding_usage() {
        let body = r#"{
            "usage":{"limit":1000000,"used":120000,"remaining":880000,"resetTime":"2026-08-23T16:00:00Z"},
            "limits":[{"window":{"duration":5,"timeUnit":"hours"},"detail":{"limit":50000,"used":5000,"remaining":45000,"resetTime":"2026-08-19T08:00:00Z"}}]
        }"#;
        let w = parse_kimi_usage(body).unwrap();
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].window, "weekly");
        assert_eq!(w[0].used_percent, 12);
        assert_eq!(w[1].window, "5h");
        assert_eq!(w[1].used_percent, 10);
    }

    #[test]
    fn kimi_balance_text() {
        let body = r#"{"available_balance":12345}"#; // 分
        let w = parse_kimi_balance(body).unwrap();
        assert_eq!(w[0].window, "balance");
        assert_eq!(w[0].text.as_deref(), Some("余额 ¥123.45"));
    }

    // ---------- OpenRouter / SiliconFlow / CommandCode ----------

    #[test]
    fn openrouter_credits_percent() {
        let body = r#"{"data":{"total_credits":10.0,"total_usage":3.5}}"#;
        let w = parse_openrouter(body).unwrap();
        assert_eq!(w[0].window, "credits");
        assert_eq!(w[0].used_percent, 35);
    }

    #[test]
    fn siliconflow_balance_text() {
        let body = r#"{"data":{"balance":"25.60"}}"#;
        let w = parse_siliconflow(body).unwrap();
        assert_eq!(w[0].text.as_deref(), Some("余额 ¥25.60"));
    }

    #[test]
    fn commandcode_windows_and_monthly() {
        let body = r#"{"windowLimits":{"fiveHour":{"used":120,"cap":200,"resetAt":1784433600000},"weekly":{"used":1000,"cap":10000,"resetAt":1785038400000}},"credits":{"monthlyCredits":88.5}}"#;
        let w = parse_commandcode(body).unwrap();
        assert_eq!(w.len(), 3);
        assert_eq!(w[0].window, "5h");
        assert_eq!(w[0].used_percent, 60);
        assert_eq!(w[1].window, "weekly");
        assert_eq!(w[1].used_percent, 10);
        assert_eq!(w[2].window, "monthly");
        assert_eq!(w[2].text.as_deref(), Some("余额 $88.50"));
    }

    // ---------- 火山方舟 ----------

    #[test]
    fn volc_signature_matches_reference() {
        // 期望值由 dsh-cost-meter 同款算法（node crypto）对固定参数生成
        let headers = volc_authorization(
            "AKLTtestkey",
            "testsecretkey",
            &[("Action", "GetCodingPlanUsage"), ("Version", "2024-01-01")],
            "20260819T100000Z",
        );
        let auth = headers
            .iter()
            .find(|(k, _)| *k == "Authorization")
            .map(|(_, v)| v.clone())
            .unwrap();
        assert_eq!(
            auth,
            "HMAC-SHA256 Credential=AKLTtestkey/20260819/cn-beijing/ark/request, SignedHeaders=host;x-content-sha256;x-date, Signature=ba4bbf8452b3d7d19e166f4c5979f3e8fdcc97a82a913f00658dd8697b9c5cb8"
        );
        let sha = headers
            .iter()
            .find(|(k, _)| *k == "X-Content-Sha256")
            .map(|(_, v)| v.clone())
            .unwrap();
        assert_eq!(sha, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }

    #[test]
    fn volc_parse_quota_usage() {
        let body = r#"{"ResponseMetadata":{"RequestId":"x"},"Result":{"QuotaUsage":[
            {"Level":"session","Percent":35,"ResetTimestamp":1784433600},
            {"Level":"weekly","Percent":12,"ResetTimestamp":1785038400},
            {"Level":"monthly","Percent":3,"ResetTimestamp":1787616000}
        ]}}"#;
        let w = parse_volc(body).unwrap();
        assert_eq!(w.len(), 3);
        assert_eq!(w[0].window, "5h");
        assert_eq!(w[0].used_percent, 35);
        assert_eq!(w[1].window, "weekly");
        assert_eq!(w[2].window, "monthly");
    }

    #[test]
    fn volc_parse_api_error() {
        let body = r#"{"ResponseMetadata":{"Error":{"Code":"SignatureDoesNotMatch","Message":"签名不匹配"}}}"#;
        let e = parse_volc(body).unwrap_err();
        assert!(e.to_string().contains("签名不匹配"));
    }

    #[test]
    fn volc_key_split_forms() {
        let (ak, sk) = split_volc_key("AKLTfoo:secret1").unwrap();
        assert_eq!((ak.as_str(), sk.as_str()), ("AKLTfoo", "secret1"));
        let (ak2, sk2) = split_volc_key("AKLTfoo secret2").unwrap();
        assert_eq!((ak2.as_str(), sk2.as_str()), ("AKLTfoo", "secret2"));
        assert!(split_volc_key("AKLTfoo").is_err());
        assert!(split_volc_key("").is_err());
    }
}