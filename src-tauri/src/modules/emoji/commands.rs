//! 表情模块 IPC 命令
use super::db::{CustomRow, Db};
use crate::modules::clipboard::{clipboard, monitor::base64_encode};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

// 为满足 tauri::command 返回类型，直接返回 Result<T, String>
type R<T> = Result<T, String>;

fn module_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|d| d.join("emojis"))
        .unwrap_or_else(|_| PathBuf::from("emojis"))
}

fn thumb_png(path: &str) -> Option<String> {
    let img = image::open(path).ok()?;
    let thumb = img.thumbnail(96, 96);
    let mut buf = Vec::new();
    thumb
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .ok()?;
    Some(base64_encode(&buf))
}

#[derive(Serialize, Clone)]
pub struct EmojiDto {
    pub char: String,
    pub group: String,
    pub group_zh: String,
    pub name_en: String,
    pub keywords_zh: Vec<String>,
    pub is_favorite: bool,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
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
pub struct EmojiCatalog {
    pub emoji: Vec<EmojiDto>,
    pub groups: Vec<GroupDto>,
    pub customs: Vec<CustomDto>,
}

/// 获取全量数据（内置 emoji + 分组 + 图片表情），前端一次拉取
#[tauri::command]
pub fn get_emoji_all(app: AppHandle, state: State<'_, Db>) -> R<EmojiCatalog> {
    let dir = crate::modules::modules_dir(&app);
    let entries = super::data::load(&dir);
    let usage = state.usage_map().map_err(|e| e.to_string())?;
    let emoji: Vec<EmojiDto> = entries
        .iter()
        .map(|e| {
            let u = usage.get(&e.char).copied().unwrap_or((0, 0, 0));
            EmojiDto {
                char: e.char.clone(),
                group: e.group.clone(),
                group_zh: e.group_zh.clone(),
                name_en: e.name_en.clone(),
                keywords_zh: e.keywords_zh.clone(),
                is_favorite: u.0 != 0,
                use_count: u.1,
                last_used_at: if u.2 != 0 { Some(u.2) } else { None },
            }
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
    Ok(EmojiCatalog {
        emoji,
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

/// 从剪贴板添加图片为表情（读 CF_DIB → 存 PNG → 入库）
#[tauri::command]
pub fn add_emoji_from_clipboard(app: AppHandle, state: State<'_, Db>) -> R<i64> {
    let Some((rgba, w, h)) = clipboard::read_image_rgba() else {
        return Err("剪贴板中没有图片".into());
    };
    let png = clipboard::rgba_to_png(&rgba, w, h).map_err(|e| e.to_string())?;
    let dir = module_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = state
        .insert_custom("", "剪贴板图片")
        .map_err(|e| e.to_string())?;
    let dst = dir.join(format!("{id}.png"));
    std::fs::write(&dst, &png).map_err(|e| e.to_string())?;
    state
        .set_custom_path(id, dst.to_string_lossy().as_ref())
        .map_err(|e| e.to_string())?;
    Ok(id)
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
    let write: Box<dyn FnOnce() -> bool + Send> = if kind == "emoji" {
        let text = key.clone();
        Box::new(move || clipboard::write_text_rich(&text, None))
    } else {
        let id: i64 = key.parse::<i64>().map_err(|e| e.to_string())?;
        let path = state
            .get_custom(id)
            .map_err(|e| e.to_string())?
            .map(|(p, _)| p)
            .ok_or("表情不存在")?;
        Box::new(move || {
            std::fs::read(&path)
                .ok()
                .and_then(|b| image::load_from_memory(&b).ok())
                .map(|img| {
                    let rgba = img.to_rgba8();
                    clipboard::write_image_rgba(rgba.as_raw(), rgba.width(), rgba.height())
                })
                .unwrap_or(false)
        })
    };
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
