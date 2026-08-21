use tauri::State;
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
        ItemType::App | ItemType::File | ItemType::Folder => {
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