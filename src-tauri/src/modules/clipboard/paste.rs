//! 粘贴回上一窗口：写剪贴板 → 隐藏主窗口等焦点自然恢复 → 模拟 Ctrl+V

use super::clipboard;
use super::models::{Item, ItemKind};
use super::state::AppState;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    VK_CONTROL, VK_V,
};

use tauri::Manager;

/// 把条目内容写入剪贴板（粘贴与"复制"共用），成功返回 Ok(())
/// `plain_text` 为 true 时文本条目只写纯文本（跳过 CF_HTML 富文本）
pub fn write_item_clipboard(state: &AppState, item: &Item, plain_text: bool) -> Result<(), String> {
    // 按类型写剪贴板（文本含富文本时同时写 CF_HTML；纯文本模式下省略 HTML）
    let ok = match item.kind {
        ItemKind::Text => clipboard::write_text_rich(
            item.content.as_deref().unwrap_or_default(),
            if plain_text { None } else { item.html.as_deref() },
        ),
        ItemKind::Image => match &item.image_path {
            Some(path) => {
                let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
                let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
                let rgba = img.to_rgba8();
                clipboard::write_image_rgba(rgba.as_raw(), rgba.width(), rgba.height())
            }
            None => false,
        },
        ItemKind::Files => {
            let paths: Vec<String> =
                serde_json::from_str(item.file_paths.as_deref().unwrap_or("[]"))
                    .unwrap_or_default();
            if paths.is_empty() {
                return Err("empty file list".into());
            }
            clipboard::write_files(&paths)
        }
    };
    if !ok {
        return Err("failed to write clipboard".into());
    }
    // 标记自身写入（监听侧跳过）
    state.mark_self_write();
    // 登记本次写入的内容指纹：监听侧只跳过同内容的"回声"，
    // 窗口内用户复制的新内容（指纹不同）照常入历史
    state.set_pending_ignore(super::monitor::clipboard_signature().unwrap_or_default());
    Ok(())
}

/// 把条目写回剪贴板并粘贴到唤起前的窗口
pub fn paste_item(state: &AppState, app: &tauri::AppHandle, id: i64) -> Result<(), String> {
    // 1. 读取条目
    let item = {
        let db = state.db.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        db.get_item(id)
            .map_err(|e| e.to_string())?
            .ok_or("item not found")?
    };

    // 2. 写剪贴板（纯文本模式：不写富文本格式）
    let plain = crate::config::module_cfg(app, "clipboard")
        .get("paste_plain")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    write_item_clipboard(state, &item, plain)?;

    // 3. 隐藏主窗口（焦点自动返回到原窗口）
    if let Some(win) = app.get_webview_window(crate::MAIN_WINDOW_LABEL) {
        let _ = win.hide();
    }

    // 4. 等待窗口隐藏完成，焦点返回到原窗口
    std::thread::sleep(std::time::Duration::from_millis(100));

    // 5. 模拟 Ctrl+V
    send_ctrl_v();

    // 6. 使用过的条目记为最新（刷新时间戳 → 下次打开排序置顶）
    if let Ok(db) = state.db.lock() {
        let _ = db.touch_item(id, super::db::now_ms());
    }

    log::info!("pasted item {id}");
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
