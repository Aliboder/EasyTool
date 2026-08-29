//! Tauri 命令层：前端 invoke 的入口，仅做编排
//!
//! ⚠️ 函数名带 search_ 前缀：Tauri 的 #[tauri::command] 按函数名生成宏符号，
//! 与 clipboard/quota 的同名命令（get_status/open_file/save_settings 等）会冲突。

use super::sdk::{self, SdkResult, SORT_DATE_MODIFIED_ASC, SORT_DATE_MODIFIED_DESC, SORT_NAME_ASC, SORT_NAME_DESC, SORT_PATH_ASC, SORT_PATH_DESC, SORT_SIZE_ASC, SORT_SIZE_DESC};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
pub struct CommandError {
    pub message: String,
}

type CmdResult<T> = Result<T, CommandError>;

impl From<String> for CommandError {
    fn from(message: String) -> Self {
        CommandError { message }
    }
}

/// 搜索结果视图（前端展示用）
#[derive(Debug, Clone, Serialize)]
pub struct SearchResultDto {
    pub name: String,
    pub path: String,
    pub full_path: String,
    pub size: Option<u64>,
    pub modified_ms: Option<i64>,
    pub is_folder: bool,
}

impl From<SdkResult> for SearchResultDto {
    fn from(r: SdkResult) -> Self {
        SearchResultDto {
            name: r.name,
            path: r.path,
            full_path: r.full_path,
            size: r.size,
            modified_ms: r.modified_ms,
            is_folder: r.is_folder,
        }
    }
}

/// 状态检测：Everything 是否可通信（查询探测成功 = 已安装且正在运行）
#[derive(Debug, Serialize)]
pub struct SearchStatus {
    pub running: bool,
}

/// 分页搜索结果：total = 全部命中数，items = 本页结果
#[derive(Debug, Serialize)]
pub struct SearchPageDto {
    pub total: u32,
    pub items: Vec<SearchResultDto>,
}

/// 执行搜索（Everything 完整语法；异步执行避免阻塞 IPC 线程）
/// offset = 跳过条数（分页），page_size = 每页条数；返回总数 + 本页
#[tauri::command]
pub async fn search(
    query: String,
    offset: Option<u32>,
    page_size: Option<u32>,
    sort_by: Option<String>,
    sort_desc: Option<bool>,
    match_case: Option<bool>,
    match_path: Option<bool>,
    match_whole_word: Option<bool>,
    regex: Option<bool>,
) -> CmdResult<SearchPageDto> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = sdk::sdk_lock();
        let sdk = guard.as_mut().ok_or_else(|| "Everything 未就绪，请确认已安装并运行 Everything".to_string())?;

        let sort = match sort_by.as_deref().unwrap_or("name") {
            "path" => {
                if sort_desc.unwrap_or(false) {
                    SORT_PATH_DESC
                } else {
                    SORT_PATH_ASC
                }
            }
            "size" => {
                if sort_desc.unwrap_or(false) {
                    SORT_SIZE_DESC
                } else {
                    SORT_SIZE_ASC
                }
            }
            "modified" => {
                if sort_desc.unwrap_or(false) {
                    SORT_DATE_MODIFIED_DESC
                } else {
                    SORT_DATE_MODIFIED_ASC
                }
            }
            _ => {
                if sort_desc.unwrap_or(false) {
                    SORT_NAME_DESC
                } else {
                    SORT_NAME_ASC
                }
            }
        };

        let (results, total) = sdk.search(
            &query,
            offset.unwrap_or(0),
            page_size.unwrap_or(100),
            sort,
            match_case.unwrap_or(false),
            match_path.unwrap_or(false),
            match_whole_word.unwrap_or(false),
            regex.unwrap_or(false),
        )?;
        Ok(SearchPageDto {
            total,
            items: results.into_iter().map(Into::into).collect(),
        })
    })
    .await
    .map_err(|e| CommandError::from(e.to_string()))?
}

/// 获取 Everything 状态（运行探测：SDK 能查询成功即视为就绪）
#[tauri::command]
pub async fn search_get_status(app: AppHandle) -> SearchStatus {
    // 探测是同步阻塞查询且要抢全局 sdk_lock——放后台线程执行，
    // 避免大查询占锁时主线程陪等冻结 UI；顺带节流重试加载 SDK
    tauri::async_runtime::spawn_blocking(move || {
        super::ensure_sdk_loaded(&app);
        let running = {
            let guard = sdk::sdk_lock();
            match guard.as_ref() {
                Some(sdk) => match sdk.search("", 0, 1, SORT_NAME_ASC, false, false, false, false)
                {
                    Ok(_) => true,
                    Err(e) => {
                        log::warn!("everything probe failed: {e}");
                        false
                    }
                },
                None => false,
            }
        };
        SearchStatus { running }
    })
    .await
    .unwrap_or(SearchStatus { running: false })
}

/// 自动启动 Everything（安装时生效）
#[tauri::command]
pub fn search_start_everything() {
    super::ensure_everything_running();
}

/// 用默认程序打开文件
#[tauri::command]
pub fn search_open_file(path: String) -> CmdResult<()> {
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| CommandError::from(format!("无法打开文件: {e}")))?;
    Ok(())
}

/// 扫描已安装应用（「应用」Tab 数据源；后台线程执行）
#[tauri::command]
pub async fn search_scan_apps(app: AppHandle) -> CmdResult<Vec<super::apps::ScannedApp>> {
    let res = tauri::async_runtime::spawn_blocking(move || super::apps::scan_installed(&app))
        .await
        .map_err(|e| CommandError::from(format!("扫描任务失败: {e}")))?;
    res.map_err(CommandError::from)
}

/// 直接打开任意路径（应用 Tab 点击启动用；.lnk 由 shell 解析目标）
/// 同时记录「最近启动」时间（按解析目标落 app_usage 表）
#[tauri::command]
pub fn search_open_path(app: AppHandle, path: String) -> CmdResult<()> {
    if let Some(state) = app.try_state::<Mutex<super::apps::AppsState>>() {
        let target = super::apps::resolve_target(&path);
        let now = chrono::Local::now().timestamp_millis();
        let _ = state.lock().unwrap().db.mark_launched(&target, now);
    }
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| CommandError::from(format!("打开失败: {e}")))?;
    Ok(())
}

/// 在资源管理器中打开文件所在位置并选中
#[tauri::command]
pub fn search_open_file_location(path: String) -> CmdResult<()> {
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{path}"))
        .spawn()
        .map_err(|e| CommandError::from(format!("无法打开所在位置: {e}")))?;
    Ok(())
}

/// 重置全部应用使用频率（数据管理用）
#[tauri::command]
pub fn search_reset_apps(app: AppHandle) -> CmdResult<u32> {
    use tauri::Emitter;
    let removed = match app.try_state::<Mutex<super::apps::AppsState>>() {
        Some(state) => state.lock().unwrap().db.reset_usage().map_err(CommandError::from)?,
        None => 0,
    };
    let _ = app.emit("search://apps_dirty", serde_json::json!({}));
    Ok(removed)
}

/// 复制文件路径文本到系统剪贴板 + 联动写入剪贴板历史
#[tauri::command]
pub fn search_copy_path(app: AppHandle, path: String) -> CmdResult<()> {
    if !super::super::clipboard::clipboard::write_text_rich(&path, None) {
        return Err(CommandError::from("写入剪贴板失败".to_string()));
    }
    super::super::clipboard::record_file_to_history(&app, &path);
    Ok(())
}

/// 复制文件本身到系统剪贴板（CF_HDROP，可粘贴/拖拽到文件管理器）+ 联动写入历史
#[tauri::command]
pub fn search_copy_file(app: AppHandle, path: String) -> CmdResult<()> {
    if !super::super::clipboard::clipboard::write_files(&[path.clone()]) {
        return Err(CommandError::from("写入剪贴板失败".to_string()));
    }
    super::super::clipboard::record_file_to_history(&app, &path);
    Ok(())
}