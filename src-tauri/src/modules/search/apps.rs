//! 已安装应用中心：扫描开始菜单快捷方式 + 前台使用频率统计
//!
//! 「软件」判定三道筛（解析目标后）：必须是 .exe；排除卸载程序；
//! 排除 Startup 自启动目录；再按解析目标去重。

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

// 注意：Path::extension() 返回值不带前导点（"lnk" 而非 ".lnk"）
const SCAN_EXTS: &[&str] = &["lnk"];
/// 卸载程序特征词（目标路径或快捷方式名命中即排除）
const UNINSTALL_KEYS: &[&str] = &["uninst", "unwise", "卸载"];

#[derive(Debug, Clone, Serialize)]
pub struct ScannedApp {
    pub name: String,
    pub path: String,
    /// 全局前台使用次数（与文件搜索模块共用同一监测源）
    pub usage_count: i64,
    /// 最近一次启动时间戳（毫秒；0 = 从未记录）
    pub last_launched_ms: i64,
}

pub struct AppsState {
    pub db: AppsDb,
}

/// 频率计数库：解析后的应用目标 → 累计前台次数
pub struct AppsDb {
    conn: rusqlite::Connection,
}

impl AppsDb {
    pub fn open(path: &std::path::Path) -> Result<Self, String> {
        let conn =
            rusqlite::Connection::open(path).map_err(|e| format!("打开数据库失败: {e}"))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS app_usage (
                 target TEXT PRIMARY KEY,
                 count INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS shortcut_cache (
                 path TEXT PRIMARY KEY,
                 target TEXT NOT NULL,
                 mtime_ms INTEGER NOT NULL
             );",
        )
        .map_err(|e| format!("建表失败: {e}"))?;
        // 清理历史版本产生的带扩展前缀（\\?\）的脏计数键
        conn.execute(
            "DELETE FROM app_usage WHERE substr(target, 1, 4) = ?1",
            params![r"\\?"],
        )
        .map_err(|e| format!("清理失败: {e}"))?;
        // v4：最近启动时间列（0.7.1 引入）；列探测保证幂等
        let cols = conn
            .prepare("PRAGMA table_info(app_usage)")
            .map_err(|e| format!("读表结构失败: {e}"))?
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| format!("读表结构失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读表结构失败: {e}"))?;
        if !cols.iter().any(|c| c == "last_launched_ms") {
            conn.execute(
                "ALTER TABLE app_usage ADD COLUMN last_launched_ms INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| format!("加列失败: {e}"))?;
        }
        Ok(Self { conn })
    }

    /// 批量落库扫描到的目标（新目标从 0 起），返回 目标→(当前次数, 最近启动)。
    /// 单个事务内完成全部 INSERT，避免数百次自动提交的磁盘 fsync 开销
    pub fn sync_targets(&self, targets: &[String]) -> Result<Vec<(String, i64, i64)>, String> {
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;
        for t in targets {
            tx.execute(
                "INSERT INTO app_usage(target, count)
                 VALUES (?1, COALESCE((SELECT count FROM app_usage WHERE target = ?1), 0))
                 ON CONFLICT(target) DO NOTHING",
                params![t],
            )
            .map_err(|e| format!("同步失败: {e}"))?;
        }
        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
        let mut stmt = self
            .conn
            .prepare("SELECT target, count, last_launched_ms FROM app_usage")
            .map_err(|e| format!("查询失败: {e}"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| format!("查询失败: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取失败: {e}"))
    }

    /// 记录一次启动（应用中心点击启动时调用；合计次数仍由前台钩子累计）
    pub fn mark_launched(&self, target: &str, now_ms: i64) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO app_usage(target, count, last_launched_ms) VALUES (?1, 1, ?2)
                 ON CONFLICT(target) DO UPDATE SET last_launched_ms = ?2",
                params![target, now_ms],
            )
            .map_err(|e| format!("记录启动失败: {e}"))?;
        Ok(())
    }

    /// 目标命中前台 +1（不存在则建行）
    pub fn increment(&self, target: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO app_usage(target, count) VALUES (?1, 1)
                 ON CONFLICT(target) DO UPDATE SET count = count + 1",
                params![target],
            )
            .map_err(|e| format!("计数失败: {e}"))?;
        Ok(())
    }

    /// 重置全部应用频率（数据管理用；快捷方式缓存保留）
    pub fn reset_usage(&self) -> Result<u32, String> {
        let n = self
            .conn
            .execute("DELETE FROM app_usage", [])
            .map_err(|e| format!("重置失败: {e}"))?;
        Ok(n as u32)
    }

    /// 读取快捷方式解析缓存：.lnk 路径 → (解析目标, 文件修改时间 ms)
    pub fn load_shortcut_cache(
        &self,
    ) -> Result<std::collections::HashMap<String, (String, u64)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT path, target, mtime_ms FROM shortcut_cache")
            .map_err(|e| format!("准备缓存查询失败: {e}"))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, (row.get(1)?, row.get(2)?))))
            .map_err(|e| format!("查询缓存失败: {e}"))?;
        rows.collect::<Result<_, _>>()
            .map_err(|e| format!("读取缓存失败: {e}"))
    }

    /// 写入快捷方式解析缓存（仅 mtime 变化/新增的条目）
    pub fn store_shortcut_cache(&self, rows: &[(String, String, u64)]) -> Result<(), String> {
        for (path, target, mtime_ms) in rows {
            self.conn
                .execute(
                    "INSERT INTO shortcut_cache(path, target, mtime_ms) VALUES (?1, ?2, ?3)
                     ON CONFLICT(path) DO UPDATE SET target = excluded.target,
                                                     mtime_ms = excluded.mtime_ms",
                    params![path, target, mtime_ms],
                )
                .map_err(|e| format!("写入缓存失败: {e}"))?;
        }
        Ok(())
    }
}

use rusqlite::params;

/// 归一化路径：剥掉 canonicalize 产生的扩展前缀（\\?\ 与 \\?\UNC\），统一小写。
/// 扫描键与监测键必须经过同一归一化，否则计数匹配不上
fn normalize_path(p: String) -> String {
    let s = if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = p.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        p
    };
    s.to_lowercase()
}

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

/// 解析条目的「真实目标」（判重/频率匹配键）：
/// - .lnk → COM 解析目标程序；其余本地路径 → canonicalize（顺带解析符号链接）
/// - URL 不解析；任何失败回退为小写化原路径
pub fn resolve_target(path: &str) -> String {
    let lower = path.to_lowercase();
    if lower.ends_with(".lnk") {
        if let Some(t) = resolve_lnk(path) {
            return normalize_path(t);
        }
    } else if !lower.starts_with("http://") && !lower.starts_with("https://") {
        if let Ok(c) = std::fs::canonicalize(path) {
            return normalize_path(c.to_string_lossy().into_owned());
        }
    }
    lower
}

fn collect_apps(
    dir: &std::path::Path,
    depth: u32,
    out: &mut Vec<(String, String, u64)>,
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
            // 跳过自启动目录：里面的程序不属于"可启动的应用"
            let is_startup = p
                .file_name()
                .map(|s| s.to_string_lossy().eq_ignore_ascii_case("startup"))
                .unwrap_or(false);
            if !is_startup {
                collect_apps(&p, depth + 1, out, seen);
            }
        } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            if SCAN_EXTS.contains(&ext.to_lowercase().as_str()) {
                let path_key = p.to_string_lossy().to_lowercase();
                if seen.insert(path_key) {
                    let mtime_ms = entry
                        .metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    out.push((
                        p.to_string_lossy().into_owned(),
                        p.file_stem()
                            .map(|s| s.to_string_lossy().into_owned())
                            .unwrap_or_default(),
                        mtime_ms,
                    ));
                }
            }
        }
    }
}

/// 扫描开始菜单，三道筛后返回全部已安装应用（按名称排序，含全局使用次数）
pub fn scan_installed(app: &AppHandle) -> Result<Vec<ScannedApp>, String> {
    let mut candidates: Vec<(String, String, u64)> = Vec::new(); // (path, name, mtime_ms)
    let mut seen_paths = std::collections::HashSet::new();
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Some(d) = std::env::var_os("APPDATA") {
        roots.push(std::path::PathBuf::from(d).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Some(d) = std::env::var_os("ProgramData") {
        roots.push(std::path::PathBuf::from(d).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    // 桌面快捷方式也是常见启动入口，纳入扫描（重复目标由解析去重兜底）
    if let Some(d) = std::env::var_os("USERPROFILE") {
        roots.push(std::path::PathBuf::from(d).join("Desktop"));
    }
    if let Some(d) = std::env::var_os("PUBLIC") {
        roots.push(std::path::PathBuf::from(d).join("Desktop"));
    }
    for r in &roots {
        collect_apps(r, 0, &mut candidates, &mut seen_paths);
    }

    // 复用 shortcut_cache：mtime 未变的 .lnk 直接取上次解析结果，
    // 只有新增/变更的快捷方式才做 COM 解析（扫描开始菜单通常上百个快捷方式）
    let cache = app
        .try_state::<Mutex<AppsState>>()
        .map(|state| state.lock().unwrap().db.load_shortcut_cache().unwrap_or_default())
        .unwrap_or_default();
    let mut changed_rows: Vec<(String, String, u64)> = Vec::new();
    let mut resolved: Vec<(String, String, String)> = Vec::with_capacity(candidates.len());
    for (p, n, mtime_ms) in &candidates {
        let target = match cache.get(p) {
            Some((cached_target, cached_mtime)) if *cached_mtime == *mtime_ms => {
                cached_target.clone()
            }
            _ => {
                let target = resolve_target(p);
                changed_rows.push((p.clone(), target.clone(), *mtime_ms));
                target
            }
        };
        resolved.push((p.clone(), n.clone(), target));
    }
    if !changed_rows.is_empty() {
        if let Some(state) = app.try_state::<Mutex<AppsState>>() {
            let _ = state.lock().unwrap().db.store_shortcut_cache(&changed_rows);
        }
    }

    let usage_map: std::collections::HashMap<String, (i64, i64)> =
        match app.try_state::<Mutex<AppsState>>() {
            Some(state) => state
                .lock()
                .unwrap()
                .db
                .sync_targets(
                    &resolved
                        .iter()
                        .map(|(_, _, t)| t.clone())
                        .collect::<Vec<_>>(),
                )
                .unwrap_or_default()
                .into_iter()
                .map(|(t, c, l)| (t, (c, l)))
                .collect(),
            None => Default::default(),
        };

    let mut out: Vec<ScannedApp> = Vec::new();
    let mut seen_targets: std::collections::HashSet<String> = Default::default();
    for (path, name, target) in resolved {
        if !target.ends_with(".exe") {
            continue; // 文档/帮助/文件夹/网站/失效链接
        }
        let hay = format!("{} {}", target, name.to_lowercase());
        if UNINSTALL_KEYS.iter().any(|k| hay.contains(k)) {
            continue; // 卸载程序
        }
        if !seen_targets.insert(target.clone()) {
            continue; // 同一目标的重复快捷方式
        }
        out.push(ScannedApp {
            name,
            path,
            usage_count: usage_map.get(&target).map(|(c, _)| *c).unwrap_or(0),
            last_launched_ms: usage_map.get(&target).map(|(_, l)| *l).unwrap_or(0),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_real_start_menu() {
        let mut candidates: Vec<(String, String, u64)> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut roots: Vec<std::path::PathBuf> = Vec::new();
        if let Some(d) = std::env::var_os("APPDATA") {
            roots.push(std::path::PathBuf::from(d).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        if let Some(d) = std::env::var_os("ProgramData") {
            roots.push(std::path::PathBuf::from(d).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        assert!(!roots.is_empty(), "no start menu roots");
        for r in &roots {
            collect_apps(r, 0, &mut candidates, &mut seen);
        }
        println!("candidates = {}", candidates.len());
        let software: Vec<&(String, String, u64)> = candidates
            .iter()
            .filter(|(p, n, _)| {
                let t = resolve_target(p);
                t.ends_with(".exe")
                    && !UNINSTALL_KEYS
                        .iter()
                        .any(|k| format!("{} {}", t, n.to_lowercase()).contains(k))
            })
            .collect();
        println!("software after filters = {}", software.len());
        for (p, _, _) in software.iter().take(3) {
            println!("  e.g. {} -> {}", n_of(p), p);
        }
        assert!(!software.is_empty(), "scan found nothing");

        fn n_of(p: &str) -> String {
            std::path::Path::new(p)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
        }
    }

    #[test]
    fn shortcut_cache_roundtrip() {
        let db = AppsDb::open(std::path::Path::new(":memory:")).unwrap();
        db.store_shortcut_cache(&[(
            r"c:\shortcuts\a.lnk".into(),
            r"c:\apps\a.exe".into(),
            123,
        )])
        .unwrap();
        let cache = db.load_shortcut_cache().unwrap();
        assert_eq!(
            cache.get(r"c:\shortcuts\a.lnk"),
            Some(&(r"c:\apps\a.exe".to_string(), 123))
        );
    }
}
