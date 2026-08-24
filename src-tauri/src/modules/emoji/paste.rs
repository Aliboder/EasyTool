//! 粘贴到唤起前窗口：与剪贴板模块对齐的简化流程
//! 隐藏弹窗/主窗口 → 等待 Windows 自然恢复焦点 → 直接发送键盘事件
use tauri::Manager;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    VIRTUAL_KEY, VK_CONTROL, VK_V,
};

/// 记录唤起前窗口上下文（当前为 no-op，保留接口供 mod.rs 调用）
pub fn record_foreground_state(_app: &tauri::AppHandle) {}

/// 隐藏窗口并等待焦点恢复（与剪贴板模块 paste_item 完全对齐）
fn hide_and_wait(app: &tauri::AppHandle) {
    // 与剪贴板模块一致：隐藏弹窗或主窗口，焦点自动返回到唤起前窗口
    let popup_win = app.get_webview_window(super::POPUP_WINDOW_LABEL);
    let main_win = app.get_webview_window(crate::MAIN_WINDOW_LABEL);
    if let Some(win) = popup_win {
        let _ = win.hide();
    } else if let Some(win) = main_win {
        let _ = win.hide();
    }
    // 与剪贴板模块一致：100ms 等待 Windows 自然把焦点还给上一个窗口
    std::thread::sleep(std::time::Duration::from_millis(100));
}

/// 写剪贴板并粘贴到唤起前窗口（图片表情用）
pub fn apply_to_foreground(
    app: &tauri::AppHandle,
    write: impl FnOnce() -> bool,
) -> Result<(), String> {
    if !write() {
        return Err("写入剪贴板失败".into());
    }
    hide_and_wait(app);
    send_ctrl_v();
    log::info!("pasted emoji via clipboard");
    Ok(())
}

/// 文本 Emoji 直接输入到唤起前窗口（不碰剪贴板）
pub fn apply_text_to_foreground(app: &tauri::AppHandle, text: &str) -> Result<(), String> {
    hide_and_wait(app);
    send_unicode_text(text);
    log::info!("typed emoji");
    Ok(())
}

/// 模拟 Ctrl+V
fn send_ctrl_v() {
    let inputs = [
        key_input(VK_CONTROL, false),
        key_input(VK_V, false),
        key_input(VK_V, true),
        key_input(VK_CONTROL, true),
    ];
    unsafe {
        let _ = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

/// 直接输入 Unicode 文本（不写剪贴板）：逐 UTF-16 单元发送 KEYEVENTF_UNICODE
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
