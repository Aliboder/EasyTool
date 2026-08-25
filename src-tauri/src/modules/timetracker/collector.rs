//! 数据采集器（ActivityWatch 心跳模型）：
//! - WinEventHook 回调只做轻量采集入队，绝不碰数据库（避免阻塞系统事件派发线程）
//! - 独立心跳线程：收到切换消息立即结算旧会话+开新会话；
//!   每 15s 超时心跳一次当前会话的 end/duration/active（关机/崩溃最多丢 15s 数据）
//! - AFK 检测用 GetLastInputInfo（与 ActivityWatch aw-watcher-afk Windows 实现一致，
//!   一行 API 同时覆盖键盘+鼠标，无需全局钩子）

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::{
    GetMessageW, GetWindowThreadProcessId, GetWindowTextW, EVENT_SYSTEM_FOREGROUND,
    WINEVENT_OUTOFCONTEXT, MSG,
};

use super::TimetrackerState;

static LAST_HWND: AtomicIsize = AtomicIsize::new(0);
/// 录制开关：命令层直接读写，采集循环每轮检查
pub static RECORDING: AtomicBool = AtomicBool::new(true);
/// AFK 判定阈值（秒），来自模块配置；0 = 关闭检测（全部记为活跃）
static AFK_THRESHOLD: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(120);
/// 是否记录窗口标题（关闭时 title 存空串，涉及隐私的场景可关）
static TRACK_TITLE: AtomicBool = AtomicBool::new(true);

/// 启动前应用配置（setup_from_handle 调用）
pub fn apply_config(app: &AppHandle) {
    let cfg = crate::config::module_cfg(app, "timetracker");
    let threshold = cfg
        .get("afkThresholdSec")
        .and_then(|v| v.as_u64())
        .unwrap_or(120)
        .min(u32::MAX as u64) as u32;
    AFK_THRESHOLD.store(threshold, Ordering::Relaxed);
    let track_title = cfg
        .get("trackWindowTitle")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    TRACK_TITLE.store(track_title, Ordering::Relaxed);
}

/// 心跳间隔（秒）：会话时长的结算粒度，也是异常退出的最大丢失窗口
const HEARTBEAT_SECS: u64 = 15;

static APP: OnceLock<AppHandle> = OnceLock::new();
static SWITCH_TX: OnceLock<Sender<SwitchMsg>> = OnceLock::new();

struct SwitchMsg {
    exe_path: String,
    app_name: String,
    window_title: String,
}

/// 启动采集器：挂前台钩子 + 心跳线程（阻塞式，需在专用线程调用）
pub fn start(app: AppHandle) {
    let _ = APP.set(app.clone());
    let _ = RECORDING.store(true, Ordering::Relaxed);

    let (tx, rx) = mpsc::channel::<SwitchMsg>();
    let _ = SWITCH_TX.set(tx);

    // 心跳线程：消费切换消息 + 周期结算
    std::thread::spawn(move || heartbeat_loop(app, rx));

    unsafe {
        let hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(on_foreground),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
        if hook.is_invalid() {
            log::error!("timetracker: SetWinEventHook failed");
            return;
        }
        log::info!("timetracker: foreground monitor ready");
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
    }
}

/// 系统最后一次键鼠输入距今的秒数（GetLastInputInfo：键盘鼠标统一覆盖）
fn idle_secs() -> u64 {
    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if !GetLastInputInfo(&mut info).as_bool() {
            return 0; // 查询失败宁可多记不算 AFK
        }
        let now = windows::Win32::System::SystemInformation::GetTickCount();
        ((now.wrapping_sub(info.dwTime)) / 1000) as u64
    }
}

fn now_local() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// 结算当前会话并开启新会话（切换窗口时调用）
fn switch_session(exe_path: &str, app_name: &str, title: &str) {
    let Some(app) = APP.get() else { return };
    let Some(state) = app.try_state::<std::sync::Mutex<TimetrackerState>>() else {
        return;
    };
    let Ok(s) = state.lock() else { return };
    let _ = s.db.roll_cross_day_event();
    // 同应用的不同窗口不算真实切换：不切分会话（避免出现「离开A 打开A」的假切换），
    // 让同一应用的使用在「一次应用切换」内持续累计
    if s.db.active_event_app_path().ok().flatten().as_deref() == Some(exe_path) {
        return;
    }
    let _ = s.db.close_current_event(&now_local());
    let category = s.db.categorize(app_name, exe_path, title);
    if let Ok(app_id) = s.db.upsert_app(exe_path, app_name, &category) {
        let _ = s.db.start_event(app_id, title, &now_local());
    }
}

/// 心跳主循环：recv_timeout 兼顾「切换即时响应」与「周期结算」
fn heartbeat_loop(app: AppHandle, rx: mpsc::Receiver<SwitchMsg>) {
    loop {
        match rx.recv_timeout(Duration::from_secs(HEARTBEAT_SECS)) {
            Ok(msg) => {
                if RECORDING.load(Ordering::Relaxed) {
                    switch_session(&msg.exe_path, &msg.app_name, &msg.window_title);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !RECORDING.load(Ordering::Relaxed) {
                    continue;
                }
                // 心跳结算：即使一直停在同一个应用也持续累计时长，
                // is_active 按「最近输入是否在阈值内」刷新
                let threshold = AFK_THRESHOLD.load(Ordering::Relaxed) as u64;
                let active = threshold == 0 || idle_secs() < threshold;
                if let Some(state) = app.try_state::<std::sync::Mutex<TimetrackerState>>() {
                    if let Ok(s) = state.lock() {
                        // 先滚动跨天会话（0 点后第一次心跳触发），再正常结算
                        let _ = s.db.roll_cross_day_event();
                        let _ = s.db.update_current_event(&now_local(), active);
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// WinEventHook 回调：只做 Win32 API 采集 + 入队，零数据库操作
unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    // hwnd=0：UAC 提示/锁屏等安全桌面场景，跳过本轮
    let h = hwnd.0 as isize;
    if h == 0 || LAST_HWND.swap(h, Ordering::Relaxed) == h {
        return;
    }
    if !RECORDING.load(Ordering::Relaxed) {
        return;
    }
    let Some(tx) = SWITCH_TX.get() else { return };

    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
        return;
    }
    let Ok(proc) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
        return;
    };
    let exe_path: Option<String> = 'blk: {
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        if QueryFullProcessImageNameW(
            proc,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_err()
        {
            break 'blk None;
        }
        Some(String::from_utf16_lossy(&buf[..len as usize]).to_lowercase())
    };
    let _ = CloseHandle(HANDLE(proc.0));
    let Some(exe_path) = exe_path else { return };

    let mut title_buf = [0u16; 2048];
    let title_len = GetWindowTextW(hwnd, &mut title_buf);
    // 关闭「记录窗口标题」时不采集，涉及隐私的场景由用户掌控
    let window_title = if TRACK_TITLE.load(Ordering::Relaxed) && title_len > 0 {
        String::from_utf16_lossy(&title_buf[..title_len as usize])
    } else {
        String::new()
    };

    // 应用名取 exe 文件名并去掉扩展名（qq.exe → qq），避免展示带 .exe 后缀
    let app_name = std::path::Path::new(&exe_path)
        .file_stem()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    let _ = tx.send(SwitchMsg {
        exe_path,
        app_name,
        window_title,
    });
}

/// 暂停/恢复录制（托盘菜单与设置命令共用入口）：
/// 暂停瞬间立即结算当前会话，避免暂停期间时长继续累计
pub fn set_recording(enabled: bool) {
    RECORDING.store(enabled, Ordering::Relaxed);
    if !enabled {
        if let Some(app) = APP.get() {
            if let Some(state) = app.try_state::<std::sync::Mutex<TimetrackerState>>() {
                if let Ok(s) = state.lock() {
                    let _ = s.db.close_current_event(&now_local());
                }
            }
        }
    }
}

/// 当前是否录制中
pub fn is_recording() -> bool {
    RECORDING.load(Ordering::Relaxed)
}
