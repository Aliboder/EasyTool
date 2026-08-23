//! 前台窗口监测：SetWinEventHook 事件驱动（零轮询），
//! 应用被切到前台时为其目标累计使用次数（供「应用」Tab 频率排序）

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};
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

/// 阻塞式启动：挂钩子后泵消息循环（在专用线程调用）
pub fn start(app: AppHandle) {
    let _ = APP.set(app);
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
    let Some(app) = APP.get() else { return };
    let Some(state) = app.try_state::<Mutex<AppsState>>() else {
        return;
    };
    let res = {
        let st = state.lock().unwrap();
        st.db.increment(&target)
    };
    if let Err(e) = res {
        log::warn!("app usage increment failed: {e}");
    }
}
