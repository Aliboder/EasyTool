//! 前台窗口监测：SetWinEventHook 事件驱动（零轮询），
//! 应用被切到前台时为其目标累计使用次数（供「应用」Tab 频率排序）

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    GetMessageW, GetWindowThreadProcessId, EVENT_SYSTEM_FOREGROUND,
    WINEVENT_OUTOFCONTEXT, MSG,
};

use super::apps::{resolve_target, AppsState};

static APP: OnceLock<AppHandle> = OnceLock::new();
static LAST_HWND: AtomicIsize = AtomicIsize::new(0);
static FIRST_COUNT_LOGGED: AtomicIsize = AtomicIsize::new(0);

struct ForegroundState {
    target: String,
    since: Instant,
    counted: bool,
}
static FOREGROUND: OnceLock<Mutex<ForegroundState>> = OnceLock::new();

/// 阻塞式启动：挂钩子后泵消息循环（在专用线程调用）
pub fn start(app: AppHandle) {
    let _ = APP.set(app);
    let _ = FOREGROUND.set(Mutex::new(ForegroundState {
        target: String::new(),
        since: Instant::now(),
        counted: true, // 初始无目标，不触发计数
    }));
    // 计时线程：每秒检查当前前台应用是否已停留 ≥10 秒
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(1));
        let Some(app) = APP.get() else { continue };
        let Some(state) = app.try_state::<Mutex<AppsState>>() else {
            continue;
        };
        // 读取并判断：无目标 / 已计数 / 未满 10 秒 → 跳过
        let target = {
            let fg = FOREGROUND
                .get()
                .unwrap()
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            if fg.target.is_empty() || fg.counted {
                continue;
            }
            if fg.since.elapsed() < Duration::from_secs(10) {
                continue;
            }
            fg.target.clone()
        };
        // 判断通过：累计 +1（不再持有 FOREGROUND 锁）
        let res = {
            let st = state
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            st.db.increment(&target)
        };
        if let Ok(()) = res {
            if FIRST_COUNT_LOGGED.swap(1, Ordering::Relaxed) == 0 {
                log::info!("foreground monitor first count recorded: {target}");
            }
            let _ = app.emit("search://apps_dirty", ());
            // 标记本次前台会话已计数（同一会话只 +1，切走再来重新计时）
            if let Some(fg) = FOREGROUND.get() {
                let mut guard = fg.lock().unwrap_or_else(|p| p.into_inner());
                if guard.target == target && !guard.counted {
                    guard.counted = true;
                }
            }
        }
    });
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
            log::error!("foreground monitor: SetWinEventHook failed");
            return;
        }
        log::info!("foreground monitor ready (event hook)");
        let mut msg = MSG::default();
        // 钩子事件经由本线程的消息循环派发；线程生命周期内持续泵
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
    }
}

unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: windows::Win32::Foundation::HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    let h = hwnd.0 as isize;
    if h == 0 || LAST_HWND.swap(h, Ordering::Relaxed) == h {
        return; // 同一窗口重复激活不计数
    }

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

    let target = resolve_target(&exe_path);
    // 更新共享状态：新目标重置计时（不立即计数，计时线程在 10 秒后决定是否 +1）
    let Some(fg) = FOREGROUND.get() else { return };
    let mut guard = fg.lock().unwrap_or_else(|p| p.into_inner());
    guard.target = target;
    guard.since = Instant::now();
    guard.counted = false;
}
