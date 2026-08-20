//! 粘贴到唤起前窗口：文本 Emoji 用 SendInput 直接输入（不碰剪贴板）；图片走剪贴板 + 模拟 Ctrl+V
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::OnceLock;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, SetFocus, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, VIRTUAL_KEY, VK_CONTROL, VK_V,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, SendMessageW,
    SetForegroundWindow, GUITHREADINFO,
};

const EM_GETSEL: u32 = 0x00B0;
const EM_SETSEL: u32 = 0x00B1;

pub struct ForegroundState {
    pub hwnd: AtomicIsize,
    pub focus: AtomicIsize,
    pub sel_start: AtomicIsize,
    pub sel_end: AtomicIsize,
}

impl Default for ForegroundState {
    fn default() -> Self {
        ForegroundState {
            hwnd: AtomicIsize::new(0),
            focus: AtomicIsize::new(0),
            sel_start: AtomicIsize::new(0),
            sel_end: AtomicIsize::new(0),
        }
    }
}

static FOREGROUND: OnceLock<ForegroundState> = OnceLock::new();

fn record_foreground() -> (isize, isize, u32, u32) {
    unsafe {
        let hwnd = GetForegroundWindow().0 as isize;
        let focus = get_focus_control(HWND(hwnd as *mut core::ffi::c_void));
        let (s, e) = get_selection(focus);
        (hwnd, focus.0 as isize, s, e)
    }
}

fn get_selection(hwnd: HWND) -> (u32, u32) {
    if hwnd.0.is_null() {
        return (0, 0);
    }
    unsafe {
        let r = SendMessageW(hwnd, EM_GETSEL, Some(WPARAM(0)), Some(LPARAM(0)));
        ((r.0 >> 16) as u32, (r.0 & 0xFFFF) as u32)
    }
}

fn restore_selection(hwnd: HWND, start: u32, end: u32) {
    if hwnd.0.is_null() {
        return;
    }
    unsafe {
        let _ = SendMessageW(
            hwnd,
            EM_SETSEL,
            Some(WPARAM(start as usize)),
            Some(LPARAM(end as isize)),
        );
    }
}

fn get_focus_control(hwnd: HWND) -> HWND {
    unsafe {
        if hwnd.0.is_null() {
            return HWND(std::ptr::null_mut());
        }
        let thread_id = GetWindowThreadProcessId(hwnd, None);
        if thread_id == 0 {
            return HWND(std::ptr::null_mut());
        }
        let mut gui = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        if GetGUIThreadInfo(thread_id, &mut gui).is_ok() {
            gui.hwndFocus
        } else {
            HWND(std::ptr::null_mut())
        }
    }
}

fn restore_focus(target: HWND, focus_control: HWND) -> bool {
    unsafe {
        let activated = SetForegroundWindow(target).as_bool();
        let target_thread = GetWindowThreadProcessId(target, None);
        let current_thread = GetCurrentThreadId();
        let focus_ok = if !focus_control.0.is_null() {
            if target_thread != 0 && target_thread != current_thread {
                if AttachThreadInput(current_thread, target_thread, true).as_bool() {
                    let ok = SetFocus(Some(focus_control)).is_ok();
                    let _ = AttachThreadInput(current_thread, target_thread, false);
                    ok
                } else {
                    false
                }
            } else {
                SetFocus(Some(focus_control)).is_ok()
            }
        } else {
            activated
        };
        activated || focus_ok
    }
}

fn send_ctrl_v() {
    unsafe {
        let inputs = [
            key_input(VK_CONTROL, false),
            key_input(VK_V, false),
            key_input(VK_V, true),
            key_input(VK_CONTROL, true),
        ];
        let _ = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

/// 直接向目标窗口输入 Unicode 文本（不写剪贴板）：逐 UTF-16 单元发送 KEYEVENTF_UNICODE
fn send_unicode_text(text: &str) {
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut inputs: Vec<INPUT> = Vec::with_capacity(units.len() * 2);
    for unit in units {
        inputs.push(unicode_input(unit, false));
        inputs.push(unicode_input(unit, true));
    }
    unsafe {
        let _ = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn unicode_input(unit: u16, keyup: bool) -> INPUT {
    let mut flags = KEYEVENTF_UNICODE;
    if keyup {
        flags |= KEYEVENTF_KEYUP;
    }
    let ki = KEYBDINPUT {
        wVk: VIRTUAL_KEY(0),
        wScan: unit,
        dwFlags: flags,
        ..Default::default()
    };
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki },
    }
}

fn key_input(key: VIRTUAL_KEY, keyup: bool) -> INPUT {
    let mut ki = KEYBDINPUT {
        wVk: key,
        ..Default::default()
    };
    if keyup {
        ki.dwFlags = KEYEVENTF_KEYUP;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki },
    }
}

/// 记录唤起前窗口上下文（呼出悬浮面板前调用）
pub fn record_foreground_state(_app: &tauri::AppHandle) {
    let (hwnd, focus, s, e) = record_foreground();
    let st = FOREGROUND.get_or_init(ForegroundState::default);
    st.hwnd.store(hwnd, Ordering::SeqCst);
    st.focus.store(focus, Ordering::SeqCst);
    st.sel_start.store(s as isize, Ordering::SeqCst);
    st.sel_end.store(e as isize, Ordering::SeqCst);
}

/// 写剪贴板内容并粘贴到唤起前窗口；write 为写入剪贴板的闭包（返回是否成功）
pub fn apply_to_foreground(write: impl FnOnce() -> bool) -> Result<(), String> {
    if !write() {
        return Err("写入剪贴板失败".into());
    }
    let st = FOREGROUND.get_or_init(ForegroundState::default);
    let win_hwnd = st.hwnd.load(Ordering::SeqCst);
    let focus_hwnd = st.focus.load(Ordering::SeqCst);
    let sel_start = st.sel_start.load(Ordering::SeqCst) as u32;
    let sel_end = st.sel_end.load(Ordering::SeqCst) as u32;
    if win_hwnd == 0 {
        log::warn!("no previous foreground window, only copied to clipboard");
        return Err("未找到唤起前窗口，表情已复制到剪贴板".into());
    }
    let focus = HWND(focus_hwnd as *mut core::ffi::c_void);
    let restored = restore_focus(HWND(win_hwnd as *mut core::ffi::c_void), focus);
    if !restored {
        return Err("无法还原原窗口焦点，内容已复制到剪贴板，请手动粘贴".into());
    }
    restore_selection(focus, sel_start, sel_end);
    std::thread::sleep(std::time::Duration::from_millis(60));
    send_ctrl_v();
    log::info!("pasted emoji to hwnd={win_hwnd}");
    Ok(())
}

/// 文本 Emoji 直达：还原唤起前窗口焦点后直接输入文本，全程不写剪贴板
pub fn apply_text_to_foreground(text: &str) -> Result<(), String> {
    let st = FOREGROUND.get_or_init(ForegroundState::default);
    let win_hwnd = st.hwnd.load(Ordering::SeqCst);
    let focus_hwnd = st.focus.load(Ordering::SeqCst);
    let sel_start = st.sel_start.load(Ordering::SeqCst) as u32;
    let sel_end = st.sel_end.load(Ordering::SeqCst) as u32;
    if win_hwnd == 0 {
        return Err("未找到唤起前窗口".into());
    }
    let focus = HWND(focus_hwnd as *mut core::ffi::c_void);
    let restored = restore_focus(HWND(win_hwnd as *mut core::ffi::c_void), focus);
    if !restored {
        return Err("无法还原原窗口焦点".into());
    }
    restore_selection(focus, sel_start, sel_end);
    std::thread::sleep(std::time::Duration::from_millis(60));
    send_unicode_text(text);
    log::info!("typed emoji to hwnd={win_hwnd}");
    Ok(())
}
