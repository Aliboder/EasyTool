use tauri::{AppHandle, Manager, State};
use std::sync::Mutex;
use super::{QuicklaunchState, types::*};

pub type CmdResult<T> = Result<T, String>;

#[tauri::command]
pub fn quicklaunch_create_item(
    state: State<'_, Mutex<QuicklaunchState>>,
    item_type: ItemType,
    name: String,
    path: String,
    folder_id: Option<i64>,
) -> CmdResult<Item> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.create_item(item_type, &name, &path, folder_id)
}

#[tauri::command]
pub fn quicklaunch_get_item(
    state: State<'_, Mutex<QuicklaunchState>>,
    id: i64,
) -> CmdResult<Item> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.get_item(id)
}

#[tauri::command]
pub fn quicklaunch_list_items(
    state: State<'_, Mutex<QuicklaunchState>>,
    filter: FilterOptions,
) -> CmdResult<Vec<Item>> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.list_items(&filter)
}

#[tauri::command]
pub fn quicklaunch_update_item(
    state: State<'_, Mutex<QuicklaunchState>>,
    id: i64,
    name: Option<String>,
    folder_id: Option<Option<i64>>,
) -> CmdResult<Item> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.update_item(id, name.as_deref(), folder_id)
}

#[tauri::command]
pub fn quicklaunch_delete_item(
    state: State<'_, Mutex<QuicklaunchState>>,
    id: i64,
) -> CmdResult<()> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.delete_item(id)
}

#[tauri::command]
pub fn quicklaunch_sort_items(
    state: State<'_, Mutex<QuicklaunchState>>,
    item_ids: Vec<i64>,
) -> CmdResult<()> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.sort_items(&item_ids)
}

#[tauri::command]
pub fn quicklaunch_create_folder(
    state: State<'_, Mutex<QuicklaunchState>>,
    name: String,
    parent_id: Option<i64>,
) -> CmdResult<Folder> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.create_folder(&name, parent_id)
}

#[tauri::command]
pub fn quicklaunch_get_folder(
    state: State<'_, Mutex<QuicklaunchState>>,
    id: i64,
) -> CmdResult<Folder> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.get_folder(id)
}

#[tauri::command]
pub fn quicklaunch_list_folders(
    state: State<'_, Mutex<QuicklaunchState>>,
    parent_id: Option<i64>,
) -> CmdResult<Vec<Folder>> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.list_folders(parent_id)
}

#[tauri::command]
pub fn quicklaunch_list_folders_with_items(
    state: State<'_, Mutex<QuicklaunchState>>,
) -> CmdResult<Vec<(Folder, Vec<Item>)>> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.list_folders_with_items()
}

#[tauri::command]
pub fn quicklaunch_update_folder(
    state: State<'_, Mutex<QuicklaunchState>>,
    id: i64,
    name: Option<String>,
    parent_id: Option<Option<i64>>,
) -> CmdResult<Folder> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.update_folder(id, name.as_deref(), parent_id)
}

#[tauri::command]
pub fn quicklaunch_delete_folder(
    state: State<'_, Mutex<QuicklaunchState>>,
    id: i64,
) -> CmdResult<()> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.delete_folder(id)
}

#[tauri::command]
pub fn quicklaunch_sort_folders(
    state: State<'_, Mutex<QuicklaunchState>>,
    folder_ids: Vec<i64>,
) -> CmdResult<()> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    st.db.sort_folders(&folder_ids)
}

#[tauri::command]
pub fn quicklaunch_open_item(
    item: Item,
) -> CmdResult<()> {
    match item.item_type {
        ItemType::App => {
            // App 类型直接执行，不通过 explorer
            std::process::Command::new(&item.path)
                .spawn()
                .map_err(|e| format!("打开应用失败: {e}"))?;
        }
        ItemType::File | ItemType::Folder => {
            std::process::Command::new("explorer")
                .arg(&item.path)
                .spawn()
                .map_err(|e| format!("打开失败: {e}"))?;
        }
        ItemType::Url => {
            std::process::Command::new("cmd")
                .args(["/c", "start", "", &item.path])
                .spawn()
                .map_err(|e| format!("打开URL失败: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_quicklaunch_settings(
    app: AppHandle,
    settings: serde_json::Value,
) -> CmdResult<()> {
    let cfg_state = app.state::<crate::config::ConfigState>();
    let mut cfg = cfg_state.0.lock().unwrap();
    if let Some(m) = cfg.modules.get_mut("quicklaunch") {
        if let Some(obj) = settings.as_object() {
            for (k, v) in obj {
                m[k] = v.clone();
            }
        }
    }
    crate::config::save_config(&app, &cfg).map_err(|e| format!("保存配置失败: {e}"))
}

#[tauri::command]
pub fn quicklaunch_add_from_path(
    state: State<'_, Mutex<QuicklaunchState>>,
    path: String,
) -> CmdResult<Item> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    
    // 检查文件是否已存在
    if let Some(existing_id) = st.db.item_exists_by_path(&path).map_err(|e| format!("查询失败: {e}"))? {
        // 文件已存在，更新时间戳并返回现有记录
        st.db.touch_item(existing_id).map_err(|e| format!("更新失败: {e}"))?;
        return st.db.get_item(existing_id).map_err(|e| format!("获取项目失败: {e}"));
    }
    
    // 判断文件类型
    let is_url = path.starts_with("http://") || path.starts_with("https://");
    let item_type = if is_url {
        ItemType::Url
    } else if std::path::Path::new(&path).is_dir() {
        ItemType::Folder
    } else if path.ends_with(".exe") {
        ItemType::App
    } else {
        ItemType::File
    };
    
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    
    // 图标由前端按需加载，不在此处获取
    st.db.create_item(item_type, &name, &path, None)
}

#[tauri::command]
pub async fn quicklaunch_get_file_icon(path: String) -> CmdResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(crate::modules::clipboard::file_icons::file_icon_png(&path))
    })
    .await
    .map_err(|e| format!("获取图标失败: {e}"))?
}

#[tauri::command]
pub fn quicklaunch_create_folder_with_items(
    state: State<'_, Mutex<QuicklaunchState>>,
    name: String,
    item_ids: Vec<i64>,
) -> CmdResult<Folder> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    
    // 创建文件夹
    let folder = st.db.create_folder(&name, None)?;
    
    // 将项目移动到文件夹中
    for item_id in item_ids.iter() {
        let _ = st.db.update_item(*item_id, None, Some(Some(folder.id)));
    }
    
    Ok(folder)
}