//! 表情模块 IPC 命令
use super::db::{CustomRow, Db};
use crate::modules::clipboard::{clipboard, dedup, monitor::base64_encode};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, State};

// 为满足 tauri::command 返回类型，直接返回 Result<T, String>
type R<T> = Result<T, String>;

fn module_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|d| d.join("emojis"))
        .unwrap_or_else(|_| PathBuf::from("emojis"))
}

/// 图片表情缩略图缓存（避免每次打开面板重复解码，上限 200 防内存膨胀）
static THUMB_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
const THUMB_CACHE_MAX: usize = 200;

fn thumb_png(path: &str) -> Option<String> {
    let cache = THUMB_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let map = cache.lock().unwrap();
        if let Some(v) = map.get(path) {
            return v.clone();
        }
    }
    let v = (|| {
        let img = image::open(path).ok()?;
        let thumb = img.thumbnail(96, 96);
        let mut buf = Vec::new();
        thumb
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .ok()?;
        Some(base64_encode(&buf))
    })();
    let mut map = cache.lock().unwrap();
    if map.len() >= THUMB_CACHE_MAX {
        if let Some(old) = map.keys().next().cloned() {
            map.remove(&old);
        }
    }
    map.insert(path.to_string(), v.clone());
    v
}

#[derive(Serialize, Clone)]
pub struct StaticEmojiDto {
    pub char: String,
    pub group: String,
    pub group_zh: String,
    pub name_en: String,
    pub keywords_zh: Vec<String>,
    /// Twemoji 图片文件名；None = 无图，前端回退字符渲染
    pub code: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct CustomDto {
    pub id: i64,
    pub name: String,
    pub group_id: Option<i64>,
    pub is_favorite: bool,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub thumb: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct GroupDto {
    pub id: i64,
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct UsageInfo {
    pub is_favorite: bool,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct DynamicData {
    pub usage: HashMap<String, UsageInfo>,
    pub groups: Vec<GroupDto>,
    pub customs: Vec<CustomDto>,
}

/// 静态 Emoji 列表（不含使用数据/图片表情，内容不变，前端可缓存）
#[tauri::command]
pub fn get_emoji_static(app: AppHandle) -> R<Vec<StaticEmojiDto>> {
    let dir = crate::modules::modules_dir(&app);
    let entries = super::data::load(&dir);
    Ok(entries
        .iter()
        .map(|e| StaticEmojiDto {
            char: e.char.clone(),
            group: e.group.clone(),
            group_zh: e.group_zh.clone(),
            name_en: e.name_en.clone(),
            keywords_zh: e.keywords_zh.clone(),
            code: e.code.clone(),
        })
        .collect())
}

/// 动态数据（收藏/使用统计 + 分组 + 图片表情）
#[tauri::command]
pub fn get_emoji_dynamic(state: State<'_, Db>) -> R<DynamicData> {
    let usage = state
        .usage_map()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(k, (fav, count, ts))| {
            (
                k,
                UsageInfo {
                    is_favorite: fav != 0,
                    use_count: count,
                    last_used_at: if ts != 0 { Some(ts) } else { None },
                },
            )
        })
        .collect();
    let groups = state
        .list_groups()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(id, name)| GroupDto { id, name })
        .collect();
    let customs = state
        .list_custom()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|c: CustomRow| CustomDto {
            id: c.id,
            name: c.name,
            group_id: c.group_id,
            is_favorite: c.is_favorite,
            use_count: c.use_count,
            last_used_at: c.last_used_at,
            thumb: thumb_png(&c.file_path),
        })
        .collect();
    Ok(DynamicData {
        usage,
        groups,
        customs,
    })
}

#[tauri::command]
pub fn get_groups(state: State<'_, Db>) -> R<Vec<GroupDto>> {
    let rows = state.list_groups().map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(id, name)| GroupDto { id, name })
        .collect())
}

/// 导入本地图片文件为表情：复制到 emojis/ 目录 + 入库；失败回滚已复制文件
#[tauri::command]
pub fn import_emoji_files(
    app: AppHandle,
    state: State<'_, Db>,
    paths: Vec<String>,
) -> R<Vec<i64>> {
    const EXTS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];
    let dir = module_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for p in paths {
        let src = Path::new(&p);
        let ext = src
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_lowercase)
            .unwrap_or_default();
        if !EXTS.contains(&ext.as_str()) {
            return Err(format!("不支持的文件类型: {p}"));
        }
        let name = src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("表情")
            .to_string();
        let id = state.insert_custom("", &name).map_err(|e| e.to_string())?;
        let dst = dir.join(format!("{id}.{ext}"));
        if std::fs::copy(&src, &dst).is_err() {
            let _ = state.delete_custom(id);
            return Err(format!("复制文件失败: {p}"));
        }
        state
            .set_custom_path(id, dst.to_string_lossy().as_ref())
            .map_err(|e| e.to_string())?;
        ids.push(id);
    }
    Ok(ids)
}

/// 把剪贴板历史中的一张图片条目存为表情（image 类型用原图路径，files 图片用文件路径）
#[tauri::command]
pub fn add_clipboard_item_as_emoji(app: AppHandle, state: State<'_, Db>, id: i64) -> R<i64> {
    use crate::modules::clipboard::models::ItemKind;
    let clip = app.state::<crate::modules::clipboard::state::AppState>();
    let item = {
        let db = clip.db.lock().unwrap();
        db.get_item(id).map_err(|e| e.to_string())?.ok_or("条目不存在")?
    };
    // 确定源文件路径：image 类型取原图，files 类型取列表首个文件
    let src = match item.kind {
        ItemKind::Image => item.image_path.ok_or("图片文件缺失")?,
        ItemKind::Files => {
            let paths: Vec<String> =
                serde_json::from_str(item.file_paths.as_deref().unwrap_or("[]"))
                    .unwrap_or_default();
            paths.into_iter().next().ok_or("文件列表为空")?
        }
        ItemKind::Text => return Err("该条目不是图片".into()),
    };
    let src_path = Path::new(&src);
    let ext = src_path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_else(|| "png".into());
    const EXTS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];
    if !EXTS.contains(&ext.as_str()) {
        return Err(format!("不支持的图片类型: {ext}"));
    }
    let dir = module_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = src_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("表情")
        .to_string();
    let eid = state.insert_custom("", &name).map_err(|e| e.to_string())?;
    let dst = dir.join(format!("{eid}.{ext}"));
    if std::fs::copy(&src_path, &dst).is_err() {
        let _ = state.delete_custom(eid);
        return Err("复制文件失败".into());
    }
    state
        .set_custom_path(eid, dst.to_string_lossy().as_ref())
        .map_err(|e| e.to_string())?;
    Ok(eid)
}

#[tauri::command]
pub fn delete_custom_emoji(state: State<'_, Db>, id: i64) -> R<()> {
    let path = state
        .get_custom(id)
        .map_err(|e| e.to_string())?
        .map(|(p, _)| p);
    state.delete_custom(id).map_err(|e| e.to_string())?;
    if let Some(p) = path {
        let _ = std::fs::remove_file(&p);
    }
    Ok(())
}

#[tauri::command]
pub fn rename_custom_emoji(state: State<'_, Db>, id: i64, name: String) -> R<()> {
    state.rename_custom(id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_custom_emoji(state: State<'_, Db>, id: i64, group_id: Option<i64>) -> R<()> {
    state.move_custom(id, group_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_group(state: State<'_, Db>, name: String) -> R<i64> {
    state.create_group(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_group(state: State<'_, Db>, id: i64, name: String) -> R<()> {
    state.rename_group(id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_group(state: State<'_, Db>, id: i64) -> R<()> {
    state.delete_group(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_use(state: State<'_, Db>, kind: String, key: String) -> R<()> {
    match kind.as_str() {
        "emoji" => state.record_use_builtin(&key).map_err(|e| e.to_string()),
        "custom" => {
            let id = key.parse::<i64>().map_err(|e| e.to_string())?;
            state.record_use_custom(id).map_err(|e| e.to_string())
        }
        _ => Err("未知类型".into()),
    }
}

#[tauri::command]
pub fn toggle_favorite(state: State<'_, Db>, kind: String, key: String, fav: bool) -> R<()> {
    match kind.as_str() {
        "emoji" => state
            .toggle_fav_builtin(&key, fav)
            .map_err(|e| e.to_string()),
        "custom" => {
            let id = key.parse::<i64>().map_err(|e| e.to_string())?;
            state.toggle_fav_custom(id, fav).map_err(|e| e.to_string())
        }
        _ => Err("未知类型".into()),
    }
}

#[tauri::command]
pub fn get_emoji_thumb(state: State<'_, Db>, id: i64) -> R<Option<String>> {
    let path = state
        .get_custom(id)
        .map_err(|e| e.to_string())?
        .map(|(p, _)| p);
    Ok(path.and_then(|p| thumb_png(&p)))
}

/// 应用表情：记录使用 → 按配置粘贴到唤起前窗口或复制到剪贴板
#[tauri::command]
pub fn apply_emoji(app: AppHandle, state: State<'_, Db>, kind: String, key: String) -> R<()> {
    let click_action = super::module_config(&app)
        .get("click_action")
        .and_then(|v| v.as_str())
        .unwrap_or("paste")
        .to_string();
    // 先记录使用
    if kind == "emoji" {
        let _ = state.record_use_builtin(&key);
    } else if let Ok(id) = key.parse::<i64>() {
        let _ = state.record_use_custom(id);
    }
    // 写剪贴板成功后：标记自身写入 + 登记内容指纹（供剪贴板监听比对跳过记录）
    // 仅图片表情需要（图片必须经剪贴板发送）；文本 Emoji 走 SendInput 直接输入，不碰剪贴板
    fn mark_self_write(app: &AppHandle, signature: Option<String>) {
        if let Some(clip) = app.try_state::<crate::modules::clipboard::state::AppState>() {
            clip.mark_self_write();
            if let Some(sig) = signature {
                clip.set_pending_ignore(sig);
            }
        }
    }
    // 文本 Emoji：粘贴 = SendInput 直接输入（不写剪贴板）；复制 = 写入剪贴板
    if kind == "emoji" {
        if click_action == "paste" {
            return super::paste::apply_text_to_foreground(&key).map_err(|e| e.to_string());
        }
        if clipboard::write_text_rich(&key, None) {
            mark_self_write(&app, Some(dedup::hash_text(&key)));
            return Ok(());
        }
        return Err("写入剪贴板失败".into());
    }
    // 图片表情：写剪贴板（CF_DIB）+ Ctrl+V 直接发送到唤起前窗口（与剪贴板模块选图粘贴一致）
    let id: i64 = key.parse::<i64>().map_err(|e| e.to_string())?;
    let path = state
        .get_custom(id)
        .map_err(|e| e.to_string())?
        .map(|(p, _)| p)
        .ok_or("表情不存在")?;
    let app2 = app.clone();
    let write: Box<dyn FnOnce() -> bool + Send> = Box::new(move || {
        let ok = std::fs::read(&path)
            .ok()
            .and_then(|b| image::load_from_memory(&b).ok())
            .map(|img| {
                let rgba = img.to_rgba8();
                let ok = clipboard::write_image_rgba(rgba.as_raw(), rgba.width(), rgba.height());
                if ok {
                    let sig = dedup::hash_image_rgba(rgba.as_raw(), rgba.width(), rgba.height());
                    mark_self_write(&app2, sig);
                }
                ok
            })
            .unwrap_or(false);
        ok
    });
    if click_action == "paste" {
        super::paste::apply_to_foreground(write).map_err(|e| e.to_string())
    } else if write() {
        Ok(())
    } else {
        Err("写入剪贴板失败".into())
    }
}

/// 保存模块配置（热键/点击行为）
#[tauri::command]
pub fn save_emoji_settings(
    app: AppHandle,
    hotkey: String,
    click_action: String,
    follow_mouse: bool,
) -> R<()> {
    let cfg = {
        let state = app.state::<crate::config::ConfigState>();
        let mut cfg = state.0.lock().unwrap();
        let m = cfg.modules.entry("emoji".into()).or_default();
        m["hotkey"] = serde_json::json!(hotkey);
        m["click_action"] = serde_json::json!(click_action);
        m["follow_mouse"] = serde_json::json!(follow_mouse);
        cfg.clone()
    };
    crate::config::save_config(&app, &cfg).map_err(|e| e.to_string())?;
    crate::reapply_hotkeys(&app);
    Ok(())
}

// ---- 单元测试 ----

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumb_png_resizes() {
        let dir = std::env::temp_dir().join(format!("emoji-thumb-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let rgba = vec![255u8, 0, 0, 255].repeat(200 * 100);
        let png = clipboard::rgba_to_png(&rgba, 200, 100).unwrap();
        let p = dir.join("t.png");
        std::fs::write(&p, &png).unwrap();
        let b64 = thumb_png(p.to_str().unwrap()).expect("缩略图应生成");
        assert!(b64.len() > 100);
        // PNG base64 魔数（PNG 文件头 \x89PNG 的 base64 前缀）
        assert!(b64.starts_with("iVBOR"), "应输出 PNG base64");
        std::fs::remove_dir_all(dir).ok();
    }
}
