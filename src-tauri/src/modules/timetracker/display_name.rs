//! 应用显示名解析：复用 search 模块的开始菜单快捷方式名，缺失时读 exe 文件版本信息，
//! 仍取不到就保持 exe 主名（由 UI 层 COALESCE 兜底）。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};

pub struct DisplayNameResolver {
    /// 小写 exe 目标路径 → 开始菜单快捷方式主名（apps.db shortcut_cache）
    shortcut_names: HashMap<String, String>,
    /// exe 路径 → 解析结果（None 也缓存，避免前台切换反复读文件）
    cache: Mutex<HashMap<String, Option<String>>>,
}

impl DisplayNameResolver {
    pub fn new(data_dir: &std::path::Path) -> Self {
        Self {
            shortcut_names: load_shortcut_names(data_dir),
            cache: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    pub fn from_shortcut_names(shortcut_names: HashMap<String, String>) -> Self {
        Self {
            shortcut_names,
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn resolve(&self, exe_path: &str) -> Option<String> {
        let key = exe_path.to_lowercase();
        {
            let cache = self.cache.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(v) = cache.get(&key) {
                return v.clone();
            }
        }
        let resolved = self
            .shortcut_names
            .get(&key)
            .cloned()
            .or_else(|| version_info_display_name(&key));
        self.cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(key, resolved.clone());
        resolved
    }
}

/// 读取 search 模块 apps.db 的快捷方式解析缓存：target（小写）→ .lnk 主名。
/// search 模块被禁用时 apps.db 不存在或不可读，返回空表（不影响时长统计）。
fn load_shortcut_names(data_dir: &std::path::Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let path = data_dir.join("apps.db");
    if !path.exists() {
        return out;
    }
    use rusqlite::OpenFlags;
    let conn = rusqlite::Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .or_else(|_| rusqlite::Connection::open(&path))
    .ok();
    let Some(conn) = conn else {
        return out;
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT path, target FROM shortcut_cache ORDER BY rowid ASC",
    ) else {
        return out;
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) else {
        return out;
    };
    for row in rows.flatten() {
        let (lnk, target) = row;
        let name = Path::new(&lnk)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        out.entry(target.to_lowercase()).or_insert(name);
    }
    out
}

/// 读取 exe 文件版本信息的 FileDescription（如 chrome.exe → Google Chrome）。
fn version_info_display_name(exe_path: &str) -> Option<String> {
    let path = Path::new(exe_path);
    let is_exe = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("exe"))
        .unwrap_or(false);
    if !is_exe || !path.is_file() {
        return None;
    }
    let wide: Vec<u16> = exe_path.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let mut handle = 0u32;
        let size = GetFileVersionInfoSizeW(PCWSTR(wide.as_ptr()), Some(&mut handle));
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(
            PCWSTR(wide.as_ptr()),
            Some(handle),
            size,
            data.as_mut_ptr() as *mut core::ffi::c_void,
        )
        .ok()?;
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        for name in version_descriptions(&data) {
            let name = name.trim();
            if name.is_empty()
                || name.len() > 80
                || name.to_lowercase() == stem
                || name.eq_ignore_ascii_case("N/A")
            {
                continue;
            }
            return Some(name.to_string());
        }
    }
    None
}

/// 依次尝试 Translation 枚举和常见语言代码，取第一个非空 FileDescription。
fn version_descriptions(data: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    if let Some((buf, len)) = query_raw(data, "\\VarFileInfo\\Translation") {
        let words =
            unsafe { std::slice::from_raw_parts(buf as *const u16, len as usize / 2) };
        for pair in words.chunks_exact(2) {
            let key = format!(
                "\\StringFileInfo\\{:04x}{:04x}\\FileDescription",
                pair[0], pair[1]
            );
            if let Some(s) = query_string(data, &key) {
                out.push(s);
            }
        }
    }
    for lang in ["040904B0", "080404B0", "041104B0"] {
        let key = format!("\\StringFileInfo\\{lang}\\FileDescription");
        if let Some(s) = query_string(data, &key) {
            out.push(s);
        }
    }
    out
}

fn query_raw(data: &[u8], key: &str) -> Option<(*mut core::ffi::c_void, u32)> {
    let key_wide: Vec<u16> = key.encode_utf16().chain(std::iter::once(0)).collect();
    let mut buf: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut len = 0u32;
    let ok = unsafe {
        VerQueryValueW(
            data.as_ptr() as *const core::ffi::c_void,
            PCWSTR(key_wide.as_ptr()),
            &mut buf,
            &mut len,
        )
    };
    ok.as_bool().then_some((buf, len))
}

fn query_string(data: &[u8], key: &str) -> Option<String> {
    let (buf, len) = query_raw(data, key)?;
    if len < 2 {
        return None;
    }
    let words = unsafe { std::slice::from_raw_parts(buf as *const u16, len as usize / 2) };
    let end = words.iter().position(|&c| c == 0).unwrap_or(words.len());
    let s = String::from_utf16(&words[..end]).ok()?;
    (!s.trim().is_empty()).then_some(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolver_prefers_shortcut_name() {
        let resolver = DisplayNameResolver::from_shortcut_names(HashMap::from([(
            "c:\\browser\\chrome.exe".into(),
            "Google Chrome".into(),
        )]));
        assert_eq!(
            resolver.resolve("C:\\Browser\\CHROME.EXE").as_deref(),
            Some("Google Chrome")
        );
        // 缓存路径直接命中
        assert_eq!(
            resolver.resolve("c:\\browser\\chrome.exe").as_deref(),
            Some("Google Chrome")
        );
    }

    #[test]
    fn version_info_returns_description_for_explorer() {
        let path = "C:\\Windows\\explorer.exe";
        if !std::path::Path::new(path).exists() {
            return;
        }
        let name = version_info_display_name(path);
        assert!(name.is_some(), "explorer.exe 应能读到 FileDescription");
        assert!(!name.unwrap().trim().is_empty());
    }
}
