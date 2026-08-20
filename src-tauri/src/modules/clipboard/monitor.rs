//! 剪贴板监听：事件驱动（AddClipboardFormatListener）+ 轮询兜底

use super::clipboard;
use super::db::{now_ms, DbError};
use super::dedup;
use super::models::{Item, ItemDto, ItemKind};
use super::state::AppState;
use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{HINSTANCE, HMODULE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::AddClipboardFormatListener;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassExW,
    TranslateMessage, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLIPBOARDUPDATE,
    WNDCLASSEXW,
};

/// 监听器线程持有的应用句柄
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// 轮询间隔（毫秒）
const POLL_INTERVAL_MS: u64 = 500;
/// 自身写入守卫窗口（毫秒）。
/// 覆盖「write 写剪贴板 → 模拟 Ctrl+V → 目标应用粘贴时可能改写剪贴板」的完整链路，
/// 避免表情/历史粘贴写入的内容被剪贴板监听记录；配合内容指纹精确比对（内容一致才跳过）。
const SELF_WRITE_GUARD_MS: i64 = 2000;
/// 缩略图最长边
const THUMB_MAX_SIZE: u32 = 256;

pub fn start(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
    std::thread::spawn(listener_thread);
    std::thread::spawn(poll_thread);
}

// ---------- 事件驱动监听（消息窗口 + WM_CLIPBOARDUPDATE） ----------

unsafe extern "system" fn listener_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_CLIPBOARDUPDATE {
        // wndproc 内不允许 panic（跨 FFI unwind 是未定义行为），异常时记录后继续
        let _ = std::panic::catch_unwind(process_clipboard_change);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

fn listener_thread() {
    unsafe {
        let class_name = widestr("EasyToolClipboardListener");
        let hmodule: HMODULE = GetModuleHandleW(None).expect("GetModuleHandleW failed");
        let hinstance = HINSTANCE(hmodule.0);
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(listener_proc),
            hInstance: hinstance,
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };
        if RegisterClassExW(&wc) == 0 {
            log::error!(
                "RegisterClassExW failed, err={}",
                std::io::Error::last_os_error()
            );
            return;
        }
        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE(0),
            PCWSTR(class_name.as_ptr()),
            PWSTR::null(),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(hinstance),
            None,
        ) {
            Ok(h) => h,
            Err(e) => {
                log::error!("CreateWindowExW failed: {e}");
                return;
            }
        };
        if AddClipboardFormatListener(hwnd).is_err() {
            log::error!("AddClipboardFormatListener failed");
            return;
        }
        log::info!("clipboard listener ready, hwnd={:?}", hwnd);

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            let _ = DispatchMessageW(&msg);
        }
    }
}

// ---------- 轮询兜底 ----------

fn poll_thread() {
    let mut last_signature: Option<String> = None;
    loop {
        std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));
        
        // 检查模块是否启用，禁用时跳过工作
        let Some(app) = APP_HANDLE.get() else {
            continue;
        };
        if !crate::clipboard_enabled(app) {
            last_signature = None;
            continue;
        }
        
        // 单次处理异常不得杀死线程（否则监听功能静默失效），记录后继续
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let signature = clipboard_signature();
            if signature.is_some() && signature != last_signature {
                process_clipboard_change();
            }
            last_signature = signature;
        }));
        if result.is_err() {
            log::error!("poll thread recovered from panic");
        }
    }
}

/// 剪贴板内容签名：格式名列表 + 文本内容（轮询用）
fn clipboard_signature() -> Option<String> {
    let mut parts = clipboard::format_names();
    parts.sort();
    let mut sig = parts.join("|");
    if let Some(text) = clipboard::read_text() {
        sig.push_str("::");
        sig.push_str(&dedup::hash_text(&text));
    }
    if sig.is_empty() {
        None
    } else {
        Some(sig)
    }
}

// ---------- 保存流水线（事件与轮询共用） ----------

fn process_clipboard_change() {
    let Some(app) = APP_HANDLE.get() else {
        return;
    };
    
    // 检查模块是否启用，禁用时跳过处理
    if !crate::clipboard_enabled(app) {
        return;
    }
    
    let state = app.state::<AppState>();

    // 自身写入守卫：写入剪贴板后 300ms 内的变化跳过。
    // 注意：事件路径与轮询路径都会走到这里，标记不能 swap(false) 一次性消费，
    // 否则事件路径跳过、轮询路径会再次进入而误记录。改为按时间窗口判断，超时后清除。
    if state.self_write.load(Ordering::SeqCst) {
        let recent = now_ms() - state.last_self_write_ms.load(Ordering::SeqCst) < SELF_WRITE_GUARD_MS;
        if recent {
            log::debug!("skip self write");
            return;
        }
        // 窗口已过，清除残留标记（下次正常记录）
        state.self_write.store(false, Ordering::SeqCst);
    }

    match save_from_clipboard(&state, app) {
        Ok(Some((item, changed))) => {
            if let Some(dto) = item_dto(&state, &item) {
                let payload = serde_json::json!({ "id": item.id, "kind": item.kind.to_string(), "changed": changed, "item": dto });
                let _ = app.emit("clipboard://changed", payload);
            }
        }
        Ok(None) => {}
        Err(e) => log::warn!("failed to save clipboard: {e}"),
    }
}

/// 读取剪贴板并入库；返回 (条目, 是否新增)。重复内容仅刷新时间（changed=false）
fn save_from_clipboard(state: &AppState, app: &AppHandle) -> Result<Option<(Item, bool)>, DbError> {
    // 记录规则：按类型过滤 + 忽略短文本
    let cfg = super::module_config(app);
    let record_files = cfg.get("record_files").and_then(|v| v.as_bool()).unwrap_or(true);
    let record_image = cfg.get("record_image").and_then(|v| v.as_bool()).unwrap_or(true);
    let record_text = cfg.get("record_text").and_then(|v| v.as_bool()).unwrap_or(true);
    let min_text_len = cfg.get("min_text_len").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

    // 0. 文件列表：每个文件单独入库（不再合并成一条），整批处理完后统一通知前端
    if let Some(files) = clipboard::read_files() {
        if !files.is_empty() && record_files {
            save_files_batch(state, app, &files)?;
        }
        return Ok(None);
    }

    // 1. 类型判定：图片 > 文本（文本附带富文本 HTML）
    let (kind, content, html, file_paths, image_data, hash) =
        if let Some((rgba, w, h)) = clipboard::read_image_rgba() {
            if !record_image {
                return Ok(None);
            }
            let Some(hash) = dedup::hash_image_rgba(&rgba, w, h) else {
                return Ok(None);
            };
            (ItemKind::Image, None, None, None, Some((rgba, w, h)), hash)
        } else if let Some(text) = clipboard::read_text() {
            if !record_text {
                return Ok(None);
            }
            if text.trim().is_empty() {
                return Ok(None);
            }
            if min_text_len > 0 && text.chars().count() < min_text_len {
                return Ok(None);
            }
            let text_hash = dedup::hash_text(&text);
            let html = clipboard::read_html();
            (ItemKind::Text, Some(text), html, None, None, text_hash)
        } else {
            return Ok(None);
        };

    let now = now_ms();

    // 2.5 内容指纹比对：与表情/粘贴登记的"待忽略指纹"一致且在窗口内则跳过记录
    if state.check_pending_ignore(&hash, SELF_WRITE_GUARD_MS, now) {
        log::debug!("skip by content fingerprint");
        return Ok(None);
    }

    // 2. 去重：命中则顶到最前；若旧条目无富文本而新捕获有，则升级回填
    {
        let db = state.db.lock().unwrap();
        if let Some(existing_id) = db.find_by_hash(&hash)? {
            db.touch_item(existing_id, now)?;
            if let Some(h) = html {
                let existing = db
                    .get_item(existing_id)?
                    .ok_or_else(|| DbError::Sql(rusqlite::Error::QueryReturnedNoRows))?;
                if existing.html.is_none() {
                    db.set_html(existing_id, Some(h))?;
                    log::info!("upgraded item {existing_id} with html");
                }
            }
            let item = db
                .get_item(existing_id)?
                .ok_or_else(|| DbError::Sql(rusqlite::Error::QueryReturnedNoRows))?;
            log::debug!("dedup: touch item {}", existing_id);
            return Ok(Some((item, false)));
        }

        // 3. 新增（仅入库拿 id；图片文件编码/落盘在锁外执行，避免阻塞前端 DB 查询）
        let item = Item {
            id: 0,
            kind: kind.clone(),
            content,
            html,
            file_paths,
            image_path: None,
            thumb_path: None,
            hash,
            pinned: false,
            created_at: now,
        };
        let Some(id) = db.insert_item(&item)? else {
            return Ok(None);
        };
        log::info!("saved clipboard item id={id} kind={}", item.kind);
        drop(db);

        // 4. 图片落盘（原图 + 缩略图）——锁外执行
        if let Some((rgba, w, h)) = image_data {
            if let Ok(png) = clipboard::rgba_to_png(&rgba, w, h) {
                let thumb_png = super::store::FileStore::make_thumb_png(&rgba, w, h, THUMB_MAX_SIZE);
                if let Ok(img_path) = state.store.save_image(id, &png) {
                    let thumb_path = match &thumb_png {
                        Ok(tp) => state.store.save_thumb(id, tp).unwrap_or_default(),
                        Err(_) => std::path::PathBuf::new(),
                    };
                    let db = state.db.lock().unwrap();
                    let _ = db.set_image_paths(
                        id,
                        Some(img_path.to_string_lossy().into_owned()),
                        Some(thumb_path.to_string_lossy().into_owned()),
                    );
                } else {
                    log::warn!("failed to save image files for item {id}");
                }
            } else {
                log::warn!("failed to encode png for item {id}");
            }
        }

        // 5. 上限清理
        let db = state.db.lock().unwrap();
        let removed = db.prune(state.max_items.load(Ordering::SeqCst) as i64)?;
        if !removed.is_empty() {
            let ids: Vec<i64> = removed.iter().map(|r| r.id).collect();
            let _ = app.emit("clipboard://pruned", serde_json::json!(ids));
            for r in removed {
                state.store.remove_files(&r);
            }
        }

        let item = db
            .get_item(id)?
            .ok_or_else(|| DbError::Sql(rusqlite::Error::QueryReturnedNoRows))?;
        Ok(Some((item, true)))
    }
}

/// 文件列表逐文件入库：每条记录一个文件（图片 Tab 依赖"首文件为图片"逻辑自动归类）；
/// 批次内按用户复制顺序显示（created_at 依次递减 1ms 保序）；去重命中仅刷新时间
pub(crate) fn save_files_batch(
    state: &AppState,
    app: &AppHandle,
    files: &[String],
) -> Result<(), DbError> {
    let db = state.db.lock().unwrap();
    let now = now_ms();
    for (i, path) in files.iter().enumerate() {
        let ts = now - (files.len() as i64 - 1 - i as i64);
        let hash = dedup::hash_files(std::slice::from_ref(path));
        if let Some(existing_id) = db.find_by_hash(&hash)? {
            db.touch_item(existing_id, ts)?;
            log::debug!("dedup: touch file item {existing_id}");
            continue;
        }
        let file_paths =
            serde_json::to_string(std::slice::from_ref(path)).unwrap_or_else(|_| "[]".into());
        let item = Item {
            id: 0,
            kind: ItemKind::Files,
            content: None,
            html: None,
            file_paths: Some(file_paths),
            image_path: None,
            thumb_path: None,
            hash,
            pinned: false,
            created_at: ts,
        };
        let Some(id) = db.insert_item(&item)? else {
            continue;
        };
        log::info!("saved clipboard file item id={id} path={path}");
    }

    // 上限清理
    let removed = db.prune(state.max_items.load(Ordering::SeqCst) as i64)?;
    if !removed.is_empty() {
        let ids: Vec<i64> = removed.iter().map(|r| r.id).collect();
        let _ = app.emit("clipboard://pruned", serde_json::json!(ids));
        for r in removed {
            state.store.remove_files(&r);
        }
    }
    // 通知前端刷新（批量入库，payload 被忽略）
    let _ = app.emit("clipboard://changed", serde_json::json!({}));
    Ok(())
}

/// 组装前端视图；图片缩略图读取后转 base64
/// 组装前端视图（缩略图由前端按需加载）
fn item_dto(_state: &AppState, item: &Item) -> Option<ItemDto> {
    Some(item.to_dto(None))
}

pub fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        out.push(TABLE[(b[0] >> 2) as usize] as char);
        out.push(TABLE[((b[0] & 0x03) << 4 | b[1] >> 4) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((b[1] & 0x0F) << 2 | b[2] >> 6) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(b[2] & 0x3F) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn widestr(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
