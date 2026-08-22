//! Tauri 命令层：前端 invoke 的入口，仅做编排
//!
//! ⚠️ 函数名带 search_ 前缀：Tauri 的 #[tauri::command] 按函数名生成宏符号，
//! 与 clipboard/quota 的同名命令（get_status/open_file/save_settings 等）会冲突。

use super::sdk::{self, SdkResult, SORT_DATE_MODIFIED_ASC, SORT_DATE_MODIFIED_DESC, SORT_NAME_ASC, SORT_NAME_DESC, SORT_PATH_ASC, SORT_PATH_DESC, SORT_SIZE_ASC, SORT_SIZE_DESC};
use serde::Serialize;
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
pub fn search_get_status() -> SearchStatus {
    let running = {
        let guard = sdk::sdk_lock();
        match guard.as_ref() {
            Some(sdk) => match sdk.search("", 0, 1, SORT_NAME_ASC, false, false, false, false) {                Ok(_) => true,
                Err(e) => {
                    log::warn!("everything probe failed: {e}");
                    false
                }
            },
            None => false,
        }
    };
    SearchStatus { running }
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

/// 在资源管理器中打开文件所在位置并选中
#[tauri::command]
pub fn search_open_file_location(path: String) -> CmdResult<()> {
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{path}"))
        .spawn()
        .map_err(|e| CommandError::from(format!("无法打开所在位置: {e}")))?;
    Ok(())
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

/// 保存弹窗固定位置（物理像素坐标）
#[tauri::command]
pub fn search_save_fixed_pos(app: AppHandle, x: i32, y: i32) -> CmdResult<()> {
    let cfg_state = app.state::<crate::config::ConfigState>();
    let mut cfg = cfg_state.0.lock().unwrap();
    if let Some(v) = cfg.modules.get_mut("search") {
        v["fixed_pos"] = serde_json::json!({ "x": x, "y": y });
    }
    crate::config::save_config(&app, &cfg).map_err(CommandError::from)?;
    Ok(())
}

/// 保存弹窗尺寸
#[tauri::command]
pub fn search_save_popup_size(app: AppHandle, width: u32, height: u32) -> CmdResult<()> {
    let cfg_state = app.state::<crate::config::ConfigState>();
    let mut cfg = cfg_state.0.lock().unwrap();
    if let Some(v) = cfg.modules.get_mut("search") {
        v["popup_size"] = serde_json::json!({ "w": width, "h": height });
    }
    crate::config::save_config(&app, &cfg).map_err(CommandError::from)?;
    Ok(())
}

/// 设置搜索模块热键（统一呼出模式下禁用，与剪贴板一致）
#[tauri::command]
pub fn search_set_hotkey(app: AppHandle, hotkey: String) -> CmdResult<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let unified = {
        let state = app.state::<crate::config::ConfigState>();
        let cfg = state.0.lock().unwrap();
        cfg.unified_hotkey
    };
    if unified {
        return Err(CommandError::from("统一呼出主窗口模式已开启，模块热键已禁用。可在设置中关闭该模式后使用。".to_string()));
    }
    app.global_shortcut()
        .register(hotkey.as_str())
        .map_err(|e| CommandError::from(format!("快捷键无效或已被其他程序占用：{e}")))?;
    // 新键验证成功后写入 config
    let cfg_state = app.state::<crate::config::ConfigState>();
    let mut cfg = cfg_state.0.lock().unwrap();
    if let Some(v) = cfg.modules.get_mut("search") {
        v["hotkey"] = serde_json::json!(hotkey);
    }
    crate::config::save_config(&app, &cfg).map_err(CommandError::from)?;
    // 整体重注册：unregister_all 后按新 config 注册所有启用模块热键，避免其它模块热键丢失
    crate::reapply_hotkeys(&app);
    log::info!("search hotkey changed to {hotkey}");
    Ok(())
}