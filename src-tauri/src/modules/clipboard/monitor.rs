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

/// 图片落盘任务队列（监听线程 → 独立 worker 的单向通道）
static IMAGE_TX: OnceLock<std::sync::mpsc::Sender<(i64, Vec<u8>, u32, u32)>> = OnceLock::new();

/// 轮询间隔（毫秒）
const POLL_INTERVAL_MS: u64 = 500;
/// 自身写入守卫窗口（毫秒）。
/// 覆盖「write 写剪贴板 → 模拟 Ctrl+V → 目标应用粘贴时可能改写剪贴板」的完整链路，
/// 避免表情/历史粘贴写入的内容被剪贴板监听记录；配合内容指纹精确比对（内容一致才跳过）。
const SELF_WRITE_GUARD_MS: i64 = 2000;
/// 缩略图最长边
const THUMB_MAX_SIZE: u32 = 256;
/// 原图保存最长边：超过则降采样（截图等大图编码慢、占盘大；预览/粘贴按需用原图，
/// 2048 以内质量足够，磁盘与编码开销显著下降）
const ORIGINAL_MAX_EDGE: u32 = 2048;
/// 复制突发合并窗口（毫秒）：窗口内同类型文本连拷收敛为一条
const BURST_MERGE_MS: i64 = 300;

pub fn start(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = IMAGE_TX.set(tx);
    spawn_image_worker(rx);
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

/// 剪贴板内容签名：格式名列表 + 文本内容 hash（轮询与自写守卫共用）
pub(crate) fn clipboard_signature() -> Option<String> {
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

    // 自身写入守卫：写入剪贴板后窗口内、且内容指纹与登记的自身写入一致才跳过。
    // 指纹不同 = 粘贴后用户又复制了新内容，必须照常记录
    // （旧逻辑按时间一刀切，2s 内的真实复制被吞且轮询签名已推进、永不补录）
    if state.self_write.load(Ordering::SeqCst) {
        let recent = now_ms() - state.last_self_write_ms.load(Ordering::SeqCst) < SELF_WRITE_GUARD_MS;
        let sig = clipboard_signature().unwrap_or_default();
        if recent && state.check_pending_ignore(&sig, SELF_WRITE_GUARD_MS, now_ms()) {
            log::debug!("skip self write (fingerprint match)");
            return;
        }
        // 窗口已过或出现非自身的新内容：清除标记，正常记录
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
    let cfg = crate::config::module_cfg(app, "clipboard");
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
        let db = state.db.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
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

        // 2.75 复制突发合并（防抖）：短窗口内文本连拷，仅在「新内容包含旧内容」（如
        //      逐步扩大选区/补全文本）时更新最新一条，避免历史刷屏；
        //      两条无关/等长改写不合并——否则会导致前一条内容丢失
        if kind == ItemKind::Text {
            if let Some((last_id, last_ts)) = db.latest_unpinned()? {
                if now.saturating_sub(last_ts) <= BURST_MERGE_MS {
                    if let Some(last_item) = db.get_item(last_id)? {
                        if last_item.kind == ItemKind::Text && !last_item.pinned {
                            let new_text = content.as_deref().unwrap_or_default();
                            let old_text = last_item.content.as_deref().unwrap_or_default();
                            let extends_old = !old_text.is_empty()
                                && !new_text.is_empty()
                                && new_text.contains(old_text);
                            if extends_old {
                                db.replace_text_content(
                                    last_id,
                                    new_text,
                                    html.as_deref(),
                                    &hash,
                                    now,
                                )?;
                                let item = db
                                    .get_item(last_id)?
                                    .ok_or_else(|| {
                                        DbError::Sql(rusqlite::Error::QueryReturnedNoRows)
                                    })?;
                                log::debug!("burst merge: updated item {last_id}");
                                drop(db);
                                return Ok(Some((item, false)));
                            }
                        }
                    }
                }
            }
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
            note: None,
        };
        let Some(id) = db.insert_item(&item)? else {
            return Ok(None);
        };
        log::info!("saved clipboard item id={id} kind={}", item.kind);
        drop(db);

        // 4. 图片落盘（原图降采样 + 缩略图编码 + 磁盘写入）移入独立 worker 线程，
        //    大图复制时不再阻塞剪贴板监听 / 轮询线程
        if let Some((rgba, w, h)) = image_data {
            if let Some(tx) = IMAGE_TX.get() {
                let _ = tx.send((id, rgba, w, h));
            }
        }

        // 5. 上限清理
        let db = state.db.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
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
    let db = state.db.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
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
            note: None,
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
    Some(item.to_dto())
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

// ---------- 图片落盘 worker ----------

/// 图片落盘 worker：接收 (id, rgba, w, h)，负责原图降采样 + 缩略图编码 + 磁盘写入，
/// 并短锁回填 image_path/thumb_path。与监听线程解耦，大图 PNG 编解码不再阻塞剪贴板监听。
fn spawn_image_worker(rx: std::sync::mpsc::Receiver<(i64, Vec<u8>, u32, u32)>) {
    std::thread::spawn(move || {
        while let Ok((id, rgba, w, h)) = rx.recv() {
            let Some(app) = APP_HANDLE.get() else {
                continue;
            };
            if let Err(e) = save_image_files(app, id, &rgba, w, h) {
                log::warn!("failed to save image files for item {id}: {e}");
            }
        }
    });
}

fn save_image_files(
    app: &tauri::AppHandle,
    id: i64,
    rgba: &[u8],
    w: u32,
    h: u32,
) -> Result<(), String> {
    // 原图降采样：最长边超过 ORIGINAL_MAX_EDGE 时等比例缩小（编码与磁盘双省）
    let (out_w, out_h, out_rgba) = if w.max(h) > ORIGINAL_MAX_EDGE {
        let scale = ORIGINAL_MAX_EDGE as f64 / w.max(h) as f64;
        let nw = ((w as f64) * scale).round().max(1.0) as u32;
        let nh = ((h as f64) * scale).round().max(1.0) as u32;
        let img = image::RgbaImage::from_raw(w, h, rgba.to_vec()).ok_or("invalid rgba buffer")?;
        let resized = image::DynamicImage::ImageRgba8(img)
            .resize(nw, nh, image::imageops::FilterType::Triangle)
            .to_rgba8();
        (nw, nh, resized.into_raw())
    } else {
        (w, h, rgba.to_vec())
    };

    let (ext, encoded) = encode_image(&out_rgba, out_w, out_h)?;
    // 缩略图基于原始像素生成（避免先降采样再缩放的二次质量损失）
    let thumb_png = super::store::FileStore::make_thumb_png(rgba, w, h, THUMB_MAX_SIZE);

    let state = app.state::<AppState>();
    let img_path = state.store.save_media(id, &ext, &encoded).map_err(|e| e.to_string())?;
    let thumb_path = match &thumb_png {
        Ok(tp) => state.store.save_thumb(id, tp).unwrap_or_default(),
        Err(_) => std::path::PathBuf::new(),
    };
    let db = state.db.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let _ = db.set_image_paths(
        id,
        Some(img_path.to_string_lossy().into_owned()),
        Some(thumb_path.to_string_lossy().into_owned()),
    );
    Ok(())
}

/// 图片编码自适应：有透明通道 → PNG 无损；无透明且颜色丰富（照片/渐变）→ JPEG q90，
/// 体积可省数倍；纯色块/截图 → PNG（避免 JPEG 压缩噪点）。返回 (扩展名, 编码字节)
fn encode_image(rgba: &[u8], w: u32, h: u32) -> Result<(String, Vec<u8>), String> {
    let has_alpha = rgba.chunks_exact(4).step_by(509).any(|p| p[3] < 250);
    if has_alpha {
        return Ok(("png".into(), clipboard::rgba_to_png(rgba, w, h)?));
    }
    // 颜色丰富度采样：超过阈值判定为照片类，用 JPEG 省空间
    let mut colors: std::collections::HashSet<u32> = std::collections::HashSet::new();
    let mut n = 0u32;
    for px in rgba.chunks_exact(4).step_by(509) {
        colors.insert((px[0] as u32) << 16 | (px[1] as u32) << 8 | px[2] as u32);
        n += 1;
    }
    let photo = n > 128 && (colors.len() as f64 / n as f64) > 0.45;
    if !photo {
        return Ok(("png".into(), clipboard::rgba_to_png(rgba, w, h)?));
    }
    let img =
        image::RgbaImage::from_raw(w, h, rgba.to_vec()).ok_or("invalid rgba buffer")?;
    let rgb = image::DynamicImage::ImageRgba8(img).to_rgb8();
    let mut buf = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90);
    enc.encode(
        rgb.as_raw(),
        rgb.width(),
        rgb.height(),
        image::ExtendedColorType::Rgb8,
    )
    .map_err(|e| format!("jpeg encode failed: {e}"))?;
    Ok(("jpg".into(), buf))
}
