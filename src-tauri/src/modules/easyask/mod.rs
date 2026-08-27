//! EasyAsk 模块：主窗口内嵌子 WebView，直连 AI 对话网页
//!
//! 架构：EasyAsk 模块页 = 壳 UI 顶栏（provider 标签切换）+ 容器区覆盖一个子
//! WebView（Tauri 多 webview 能力）加载 AI 对话网页（DeepSeek/Kimi/通义/豆包…）。
//! 切换 AI = 子 WebView navigate；切走模块 = 隐藏子 WebView（否则盖住其他页面）。
//! 登录态：Cookie 存应用自己的 WebView2 数据目录，独立于系统浏览器，登录一次长期有效。
//!
//! 注意：Windows 上 WebviewBuilder::build 在同步命令/事件处理器里会死锁，
//! 建窗必须走 Window::add_child（内部 run_on_main_thread）且命令声明为 async。

use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl};

pub const WEBVIEW_LABEL: &str = "easyask_webview";

/// 子 WebView 状态
pub struct EasyaskState {
    /// 建窗/导航串行化：防止并发 ensure 重复建窗
    pub ensure_lock: Mutex<()>,
    /// 当前加载的 URL（URL 未变化不重复导航，避免整页重载丢页面状态）
    pub last_url: Mutex<Option<String>>,
    /// 已创建的子 WebView（add_child 返回后存这里，后续命令直接取用）
    pub webview: Mutex<Option<tauri::Webview>>,
}

impl Default for EasyaskState {
    fn default() -> Self {
        Self {
            ensure_lock: Mutex::new(()),
            last_url: Mutex::new(None),
            webview: Mutex::new(None),
        }
    }
}

pub fn setup_from_handle(app: &AppHandle) -> tauri::Result<()> {
    app.manage(EasyaskState::default());
    log::info!("easyask module ready");
    Ok(())
}

fn child_webview(app: &AppHandle) -> Option<tauri::Webview> {
    app.state::<EasyaskState>().webview.lock().unwrap().clone()
}

/// 用户输入网址缺协议时补全 https（设置里可只填域名）
fn normalize_url(url: &str) -> String {
    let t = url.trim();
    if t.starts_with("http://") || t.starts_with("https://") {
        t.to_string()
    } else {
        format!("https://{t}")
    }
}

/// 确保子 WebView 存在并加载 url（幂等：URL 未变化不重复导航，保留页面状态）
fn ensure_webview(app: &AppHandle, url: &str) -> Result<(), String> {
    let url = normalize_url(url);
    let parsed = tauri::Url::parse(&url).map_err(|_| format!("网址无效：{url}"))?;
    let state = app.state::<EasyaskState>();
    let _guard = state.ensure_lock.lock().unwrap();
    match child_webview(app) {
        Some(wv) => {
            let mut last = state.last_url.lock().unwrap();
            if last.as_deref() != Some(url.as_str()) {
                wv.navigate(parsed).map_err(|e| format!("加载失败：{e}"))?;
                *last = Some(url);
            }
        }
        None => {
            let win = app.get_window(crate::MAIN_WINDOW_LABEL).ok_or("主窗口未就绪")?;
            let wv = win
                .add_child(
                    tauri::WebviewBuilder::new(WEBVIEW_LABEL, WebviewUrl::External(parsed))
                        .devtools(cfg!(debug_assertions)),
                    PhysicalPosition::new(0, 0),
                    PhysicalSize::new(1, 1),
                )
                .map_err(|e| e.to_string())?;
            // 先隐藏，等前端定位后再显示：避免建窗瞬间在窗口左上角闪现
            let _ = wv.hide();
            state.webview.lock().unwrap().replace(wv);
            // 建窗瞬间 WebView2 可能短暂激活其他窗口，把焦点交还主窗口，
            // 防止「失焦自动隐藏」把窗口关掉（面板模式的隐藏由 hide_after_blur_grace 判定）
            let _ = win.set_focus();
            log::info!("easyask: child webview created for {url}");
            *state.last_url.lock().unwrap() = Some(url);
        }
    }
    Ok(())
}

/// 创建/导航子 WebView（进入模块页或切换 AI 时调用）
#[tauri::command]
pub async fn easyask_ensure_webview(app: AppHandle, url: String) -> Result<(), String> {
    ensure_webview(&app, &url)
}

/// 把子 WebView 定位到模块页容器（物理像素，前端由 rect × devicePixelRatio 得出）
#[tauri::command]
pub async fn easyask_set_bounds(
    app: AppHandle,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<(), String> {
    if w < 10 || h < 10 {
        return Ok(()); // 容器尚未布局（0 尺寸）时忽略
    }
    let Some(wv) = child_webview(&app) else {
        return Ok(());
    };
    wv.set_position(PhysicalPosition::new(x, y))
        .and_then(|_| wv.set_size(PhysicalSize::new(w, h)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn easyask_show(app: AppHandle) -> Result<(), String> {
    let Some(wv) = child_webview(&app) else {
        return Ok(());
    };
    wv.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn easyask_hide(app: AppHandle) -> Result<(), String> {
    let Some(wv) = child_webview(&app) else {
        return Ok(());
    };
    wv.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn easyask_reload(app: AppHandle) -> Result<(), String> {
    let Some(wv) = child_webview(&app) else {
        return Err("对话窗口尚未打开，请先进入 EasyAsk".into());
    };
    wv.eval("location.reload()").map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_url_adds_https() {
        assert_eq!(
            normalize_url("chat.deepseek.com"),
            "https://chat.deepseek.com"
        );
        assert_eq!(
            normalize_url("https://kimi.moonshot.cn/"),
            "https://kimi.moonshot.cn/"
        );
        assert_eq!(normalize_url(" http://a.b "), "http://a.b");
    }
}
