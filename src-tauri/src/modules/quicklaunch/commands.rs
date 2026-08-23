use tauri::{AppHandle, Manager, State};
use std::sync::Mutex;
use super::{QuicklaunchState, types::*};

pub type CmdResult<T> = Result<T, String>;

/// 解析 .lnk 快捷方式的目标路径（COM IShellLinkW）；失败返回 None
fn resolve_lnk(path: &str) -> Option<String> {
    use windows::core::{HSTRING, Interface};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, IPersistFile, STGM_READ,
    };
    use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    unsafe {
        if CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_err() {
            return None;
        }
        let result = (|| {
            let link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
            let pf: IPersistFile = link.cast().ok()?;
            pf.Load(&HSTRING::from(path), STGM_READ).ok()?;
            let mut buf = [0u16; 1024];
            let mut find = WIN32_FIND_DATAW::default();
            link.GetPath(&mut buf, &mut find, 0).ok()?;
            let len = buf.iter().position(|&c| c == 0).unwrap_or(0);
            let s = String::from_utf16_lossy(&buf[..len]);
            (!s.is_empty()).then_some(s)
        })();
        CoUninitialize();
        result
    }
}

/// 解析条目的「真实目标」（判重/前台计数匹配键）：
/// - .lnk → COM 解析目标程序；其余本地路径 → canonicalize（顺带解析符号链接）
/// - URL 不解析；任何失败回退为小写化原路径
pub(crate) fn resolve_target(path: &str) -> String {
    let lower = path.to_lowercase();
    if lower.ends_with(".lnk") {
        if let Some(t) = resolve_lnk(path) {
            return t.to_lowercase();
        }
    } else if !lower.starts_with("http://") && !lower.starts_with("https://") {
        if let Ok(c) = std::fs::canonicalize(path) {
            return c.to_string_lossy().to_lowercase();
        }
    }
    lower
}

#[tauri::command]
pub fn quicklaunch_create_item(
    state: State<'_, Mutex<QuicklaunchState>>,
    item_type: ItemType,
    name: String,
    path: String,
    folder_id: Option<i64>,
) -> CmdResult<Item> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    let target = resolve_target(&path);
    st.db.create_item(item_type, &name, &path, folder_id, Some(&target))
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
            // explorer 打开 URL 走系统默认浏览器，不经 cmd 解析（含 & 的查询串不会被截断）
            std::process::Command::new("explorer")
                .arg(&item.path)
                .spawn()
                .map_err(|e| format!("打开URL失败: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn quicklaunch_open_item_as_admin(
    item: Item,
) -> CmdResult<()> {
    match item.item_type {
        ItemType::App => {
            // 使用 PowerShell Start-Process -Verb RunAs 以管理员身份运行
            std::process::Command::new("powershell")
                .args(["-Command", &format!("Start-Process -FilePath '{}' -Verb RunAs", item.path)])
                .spawn()
                .map_err(|e| format!("以管理员身份运行失败: {e}"))?;
        }
        _ => {
            return Err("只能以管理员身份运行应用程序".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn quicklaunch_add_from_path(
    state: State<'_, Mutex<QuicklaunchState>>,
    path: String,
) -> CmdResult<Item> {
    let st = state.lock().map_err(|e| format!("锁状态失败: {e}"))?;
    
    // 检查文件是否已存在（路径完全一致，快速路径）
    if let Some(existing_id) = st.db.item_exists_by_path(&path).map_err(|e| format!("查询失败: {e}"))? {
        // 文件已存在，更新时间戳并返回现有记录
        st.db.touch_item(existing_id).map_err(|e| format!("更新失败: {e}"))?;
        return st.db.get_item(existing_id).map_err(|e| format!("获取项目失败: {e}"));
    }

    // 内容级判重：不同快捷方式/路径指向同一目标视为重复
    // （开始菜单与公共桌面各有一份 .lnk 是常见场景）
    let new_target = resolve_target(&path);
    for (id, key) in st.db.list_dedup_keys().map_err(|e| format!("查询失败: {e}"))? {
        if key == new_target {
            st.db.touch_item(id).map_err(|e| format!("更新失败: {e}"))?;
            return st.db.get_item(id).map_err(|e| format!("获取项目失败: {e}"));
        }
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
    st.db.create_item(item_type, &name, &path, None, Some(&new_target))
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

#[derive(Debug, serde::Serialize)]
pub struct ScannedApp {
    pub name: String,
    pub path: String,
    /// 该应用与某个已固定条目指向同一目标
    pub fixed: bool,
}

// 注意：Path::extension() 返回值不带前导点（"lnk" 而非 ".lnk"）
const SCAN_EXTS: &[&str] = &["lnk", "url"];

fn collect_apps(
    dir: &std::path::Path,
    depth: u32,
    out: &mut Vec<ScannedApp>,
    seen: &mut std::collections::HashSet<String>,
) {
    if depth > 6 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_apps(&p, depth + 1, out, seen);
        } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            if SCAN_EXTS.contains(&ext.to_lowercase().as_str()) {
                // 路径去重 + 同名快捷方式去重（用户菜单/公共菜单各一份只留一个）
                let path_key = p.to_string_lossy().to_lowercase();
                let stem_key = format!(
                    "stem:{}",
                    p.file_stem().map(|s| s.to_string_lossy().to_lowercase())
                        .unwrap_or_default()
                );
                if seen.insert(path_key) && seen.insert(stem_key) {
                    out.push(ScannedApp {
                        name: p
                            .file_stem()
                            .map(|s| s.to_string_lossy().into_owned())
                            .unwrap_or_default(),
                        path: p.to_string_lossy().into_owned(),
                        fixed: false,
                    });
                }
            }
        }
    }
}

/// 扫描开始菜单中的快捷方式，供「全部应用」Tab 与添加选择器使用。
/// 与已固定条目目标相同的项标记 fixed=true（比对库内 target 列）
#[tauri::command]
pub async fn quicklaunch_scan_apps(
    app: AppHandle,
) -> CmdResult<Vec<ScannedApp>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out: Vec<ScannedApp> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut roots: Vec<std::path::PathBuf> = Vec::new();
        if let Some(d) = std::env::var_os("APPDATA") {
            roots.push(std::path::PathBuf::from(d).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        if let Some(d) = std::env::var_os("ProgramData") {
            roots.push(std::path::PathBuf::from(d).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        for r in &roots {
            collect_apps(&r, 0, &mut out, &mut seen);
        }
        // 固定条目的目标集合：扫描项命中即标记 fixed
        let fixed_targets: std::collections::HashSet<String> =
            match app.try_state::<Mutex<QuicklaunchState>>() {
                Some(state) => state
                    .lock()
                    .unwrap()
                    .db
                    .list_targets()
                    .unwrap_or_default()
                    .into_iter()
                    .collect(),
                None => Default::default(),
            };
        for a in out.iter_mut() {
            a.fixed = !fixed_targets.is_empty() && fixed_targets.contains(&resolve_target(&a.path));
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    })
    .await
    .map_err(|e| format!("扫描任务失败: {e}"))?
}

/// 直接打开任意路径（系统应用 Tab 点击启动用；.lnk 由 shell 解析目标）
#[tauri::command]
pub fn quicklaunch_open_path(path: String) -> CmdResult<()> {
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开失败: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod scan_tests {
    use super::*;

    #[test]
    fn scan_real_start_menu() {
        let mut out: Vec<ScannedApp> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut roots: Vec<std::path::PathBuf> = Vec::new();
        if let Some(d) = std::env::var_os("APPDATA") {
            let r = std::path::PathBuf::from(d).join(r"Microsoft\Windows\Start Menu\Programs");
            println!("user root exists: {}", r.exists());
            roots.push(r);
        } else {
            println!("APPDATA not set!");
        }
        if let Some(d) = std::env::var_os("ProgramData") {
            let r = std::path::PathBuf::from(d).join(r"Microsoft\Windows\Start Menu\Programs");
            println!("allusers root exists: {}", r.exists());
            roots.push(r);
        }
        for r in &roots {
            collect_apps(r, 0, &mut out, &mut seen);
        }
        println!("scanned count = {}", out.len());
        for a in out.iter().take(5) {
            println!("  e.g. {} -> {}", a.name, a.path);
        }
        assert!(!out.is_empty(), "scan found nothing");
    }
}