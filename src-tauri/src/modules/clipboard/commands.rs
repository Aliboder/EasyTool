//! Tauri 命令层：前端 invoke 的入口，仅做编排

use super::models::{Item, ItemDto, ItemKind};
use super::state::AppState;
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Serialize)]
pub struct CommandError {
    pub message: String,
}

impl From<rusqlite::Error> for CommandError {
    fn from(e: rusqlite::Error) -> Self {
        CommandError {
            message: e.to_string(),
        }
    }
}

impl From<super::db::DbError> for CommandError {
    fn from(e: super::db::DbError) -> Self {
        CommandError {
            message: e.to_string(),
        }
    }
}

type CmdResult<T> = Result<T, CommandError>;

/// 可预览图片扩展名（文件条目是否算"图片"的判定口径，与前端一致）
const IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "avif", "tif", "tiff",
];

/// 文件条目的首个文件是否为图片（网格/横条展示的就是首个文件）
fn first_file_is_image(item: &Item) -> bool {
    let paths: Vec<String> =
        serde_json::from_str(item.file_paths.as_deref().unwrap_or("[]")).unwrap_or_default();
    let Some(first) = paths.first() else {
        return false;
    };
    first
        .rsplit('.')
        .next()
        .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 历史列表（可搜索、按类型筛选、分页）
#[tauri::command]
pub fn get_history(
    state: State<'_, AppState>,
    filter: Option<String>,
    kind: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> CmdResult<Vec<ItemDto>> {
    let db = state.db.lock().unwrap();
    let mut items = db.list_items(
        filter.as_deref().unwrap_or(""),
        kind.as_deref(),
        limit.unwrap_or(100),
        offset.unwrap_or(0),
    )?;
    // 实时检测：图片原图被手动删除后不再显示（恢复文件后自动重新出现）
    items.retain(|it| match it.kind {
        ItemKind::Image => it
            .image_path
            .as_deref()
            .map(|p| std::path::Path::new(p).exists())
            .unwrap_or(false),
        // 图片 Tab：文件条目仅保留首个文件为图片的
        ItemKind::Files => kind.as_deref() != Some("image") || first_file_is_image(it),
        _ => true,
    });
    Ok(items.iter().map(|i| to_dto(&state, i)).collect())
}

/// 固定 / 取消固定
#[tauri::command]
pub fn pin_item(state: State<'_, AppState>, id: i64, pinned: bool) -> CmdResult<bool> {
    let db = state.db.lock().unwrap();
    Ok(db.set_pinned(id, pinned)?)
}

/// 删除单条（含磁盘文件）
#[tauri::command]
pub fn delete_item(state: State<'_, AppState>, id: i64) -> CmdResult<bool> {
    let db = state.db.lock().unwrap();
    if let Some(item) = db.delete_item(id)? {
        state.store.remove_files(&item);
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 清空全部非固定条目
#[tauri::command]
pub fn clear_history(state: State<'_, AppState>) -> CmdResult<u32> {
    let db = state.db.lock().unwrap();
    let removed = db.clear_unpinned()?;
    let n = removed.len() as u32;
    for item in removed {
        state.store.remove_files(&item);
    }
    Ok(n)
}

/// 清空全部历史（含固定条目）
#[tauri::command]
pub fn clear_all_history(state: State<'_, AppState>) -> CmdResult<u32> {
    let db = state.db.lock().unwrap();
    let removed = db.clear_all()?;
    let n = removed.len() as u32;
    for item in removed {
        state.store.remove_files(&item);
    }
    Ok(n)
}

/// 粘贴条目到上一窗口（核心动作）
#[tauri::command]
pub fn paste_item(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
    super::paste::paste_item(&state, id).map_err(|m| CommandError { message: m })
}

/// 复制条目到剪贴板（不粘贴，右键菜单用）
#[tauri::command]
pub fn copy_item(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
    let item = {
        let db = state.db.lock().unwrap();
        db.get_item(id)
            .map_err(|e| CommandError {
                message: e.to_string(),
            })?
            .ok_or(CommandError {
                message: "item not found".into(),
            })?
    };
    super::paste::write_item_clipboard(&state, &item).map_err(|m| CommandError { message: m })
}

/// 打开文件所在位置（资源管理器定位）
#[tauri::command]
pub fn open_file_location(path: String) -> CmdResult<()> {
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{path}"))
        .spawn()
        .map_err(|e| CommandError {
            message: format!("无法打开所在位置: {e}"),
        })?;
    Ok(())
}

/// 用默认程序打开文件
#[tauri::command]
pub fn open_file(path: String) -> CmdResult<()> {
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| CommandError {
            message: format!("无法打开文件: {e}"),
        })?;
    Ok(())
}

/// 设置历史上限（写入 config 并即时生效）
#[tauri::command]
pub fn set_max_items(
    app: AppHandle,
    state: State<'_, AppState>,
    max_items: i64,
) -> CmdResult<()> {
    let max = max_items.clamp(1, 100000) as u64;
    state.max_items.store(max, Ordering::SeqCst);
    let cfg_state = app.state::<crate::config::ConfigState>();
    let mut cfg = cfg_state.0.lock().unwrap();
    if let Some(v) = cfg.modules.get_mut("clipboard") {
        v["max_items"] = serde_json::json!(max);
    }
    crate::config::save_config(&app, &cfg).map_err(|m| CommandError { message: m })
}

/// 数据目录路径（设置展示用）
#[tauri::command]
pub fn get_data_dir(state: State<'_, AppState>) -> CmdResult<String> {
    Ok(state.store.root().to_string_lossy().into_owned())
}

/// 打开数据目录（主动清理入口）
#[tauri::command]
pub fn open_data_dir(state: State<'_, AppState>) -> CmdResult<()> {
    let dir = state.store.root();
    std::fs::create_dir_all(dir).map_err(|e| CommandError {
        message: format!("数据目录不可用: {e}"),
    })?;
    std::process::Command::new("explorer.exe")
        .arg(dir)
        .spawn()
        .map_err(|e| CommandError {
            message: format!("无法打开资源管理器: {e}"),
        })?;
    Ok(())
}

/// 数据统计（设置面板展示）
#[derive(Debug, Serialize)]
pub struct StatsDto {
    pub total: i64,
    pub text: i64,
    pub image: i64,
    pub files: i64,
    pub db_size: u64,
    pub media_size: u64,
}

fn dir_size(dir: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                total += dir_size(&path);
            } else if let Ok(meta) = std::fs::metadata(&path) {
                total += meta.len();
            }
        }
    }
    total
}

/// 数据统计：条目数量与磁盘占用
#[tauri::command]
pub fn get_stats(state: State<'_, AppState>) -> CmdResult<StatsDto> {
    let db = state.db.lock().unwrap();
    let count = |kind: &str| -> i64 { db.count_by_kind(kind).unwrap_or(0) };
    let total: i64 = db.count_all().unwrap_or(0);
    let db_path = state.store.root().join("clipboard.db");
    let db_size = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
    let media_size =
        dir_size(&state.store.root().join("images")) + dir_size(&state.store.root().join("thumbs"));
    Ok(StatsDto {
        total,
        text: count("text"),
        image: count("image"),
        files: count("files"),
        db_size,
        media_size,
    })
}

/// 图片缩略图 base64（按 id 读取）
#[tauri::command]
pub fn get_thumb(state: State<'_, AppState>, id: i64) -> CmdResult<Option<String>> {
    let db = state.db.lock().unwrap();
    let Some(item) = db.get_item(id)? else {
        return Ok(None);
    };
    let Some(path) = item.thumb_path else {
        return Ok(None);
    };
    Ok(std::fs::read(&path)
        .ok()
        .map(|b| super::monitor::base64_encode(&b)))
}

/// 图片原图 base64（大图预览用，按 id 读取）
#[tauri::command]
pub fn get_image(state: State<'_, AppState>, id: i64) -> CmdResult<Option<String>> {
    let db = state.db.lock().unwrap();
    let Some(item) = db.get_item(id)? else {
        return Ok(None);
    };
    let Some(path) = item.image_path else {
        return Ok(None);
    };
    Ok(std::fs::read(&path)
        .ok()
        .map(|b| super::monitor::base64_encode(&b)))
}

/// 文件类型图标（Shell API，按文件路径；异步执行避免阻塞 IPC 串行线程）
#[tauri::command]
pub async fn get_file_icon(path: String) -> CmdResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || super::file_icons::file_icon_png(&path))
        .await
        .map_err(|e| CommandError {
            message: format!("图标提取任务失败: {e}"),
        })
}

/// 图片文件缩略图（按文件路径；解码耗时，异步执行）
#[tauri::command]
pub async fn get_file_thumb(path: String) -> CmdResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || super::file_icons::file_thumb_png(&path))
        .await
        .map_err(|e| CommandError {
            message: format!("缩略图生成任务失败: {e}"),
        })
}

/// 图片文件大预览（按文件路径，最长边 1024；解码耗时，异步执行）
#[tauri::command]
pub async fn get_file_preview(path: String) -> CmdResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || super::file_icons::file_preview_png(&path))
        .await
        .map_err(|e| CommandError {
            message: format!("预览生成任务失败: {e}"),
        })
}

/// 组装前端视图（缩略图由前端按需加载，避免列表全量读文件转 base64）
fn to_dto(_state: &AppState, item: &Item) -> ItemDto {
    item.to_dto(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_item(paths: &[&str]) -> Item {
        Item {
            id: 0,
            kind: ItemKind::Files,
            content: None,
            html: None,
            file_paths: Some(serde_json::to_string(paths).unwrap()),
            image_path: None,
            thumb_path: None,
            hash: "h".into(),
            pinned: false,
            created_at: 0,
        }
    }

    /// 图片 Tab 的文件图片判定（首个文件扩展名）
    #[test]
    fn first_file_image_detection() {
        assert!(first_file_is_image(&file_item(&["C:\\a\\b.png"])));
        assert!(first_file_is_image(&file_item(&["C:\\a\\B.JPG"]))); // 大小写不敏感
        assert!(!first_file_is_image(&file_item(&["C:\\a\\b.docx"])));
        assert!(first_file_is_image(&file_item(&[
            "C:\\a\\b.png",
            "C:\\a\\c.pdf"
        ]))); // 首个为图片
        assert!(!first_file_is_image(&file_item(&[
            "C:\\a\\b.pdf",
            "C:\\a\\c.png"
        ]))); // 首非图片
        assert!(!first_file_is_image(&file_item(&[])));
    }
}