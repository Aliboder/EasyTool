//! 旧数据一次性迁移：PasteBoard 剪贴板历史 + QuotaMonitor 余额记录
//!
//! 在应用启动 setup 阶段自动执行，结果写入 config.migrated 标记，避免重复迁移。
//! 迁移是幂等的：剪贴板按 hash `INSERT OR IGNORE`，余额按时间合并去重。

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};

use crate::config::ConfigState;

const OLD_PB_APP_DIR: &str = "com.aliboder.pasteboard";

fn old_pasteboard_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    Path::new(&base).join(OLD_PB_APP_DIR)
}

fn balance_source_paths() -> Vec<PathBuf> {
    let docs = std::env::var("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Documents");
    vec![
        docs.join("QuotaMonitor").join("余额记录.json"),
        docs.join("余额记录.json"),
    ]
}

/// 启动时调用：自动执行未完成的迁移并写回标记
pub fn run_migration(app: &AppHandle) {
    let state = app.state::<ConfigState>();
    let mut cfg = state.0.lock().unwrap();
    let data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            log::warn!("migration: no app data dir, skipped: {e}");
            return;
        }
    };

    let mut changed = false;

    if !cfg.migrated.iter().any(|m| m == "clipboard") {
        let old_dir = old_pasteboard_dir();
        let old_db = old_dir.join("pasteboard.db");
        if old_db.exists() {
            match migrate_clipboard_db(
                &old_db,
                &data_dir.join("clipboard.db"),
                &old_dir,
                &data_dir.join("images"),
                &data_dir.join("thumbs"),
            ) {
                Ok(n) => {
                    log::info!("migration: clipboard imported {n} items");
                    // 成功才标记完成；失败不标记，下次启动重试（INSERT OR IGNORE 保证重试幂等）
                    cfg.migrated.push("clipboard".into());
                    changed = true;
                }
                Err(e) => log::warn!("migration: clipboard failed, will retry next launch: {e}"),
            }
        } else {
            // 旧库不存在：无可迁移数据，标记完成避免每次启动空跑
            cfg.migrated.push("clipboard".into());
            changed = true;
        }
    }

    if !cfg.migrated.iter().any(|m| m == "balance") {
        let dst = data_dir.join("balance_history.json");
        let mut any_source = false;
        let mut ok = false;
        for src in balance_source_paths() {
            if src.exists() {
                any_source = true;
                match migrate_balance_file(&src, &dst) {
                    Ok(k) => {
                        log::info!("migration: balance history imported {k} records from {}", src.display());
                        ok = true;
                        break;
                    }
                    Err(e) => log::warn!("migration: balance failed: {e}"),
                }
            }
        }
        // 无源文件或导入成功才标记；全部失败则下次启动重试
        if !any_source || ok {
            cfg.migrated.push("balance".into());
            changed = true;
        }
    }

    // 分账户历史迁移：默认 deepseek 账户沿用旧单文件数据（兼容已迁移用户）
    let legacy_history = data_dir.join("balance_history.json");
    let per_acc = data_dir.join("balance_history_deepseek.json");
    if legacy_history.exists() && !per_acc.exists() {
        match fs::copy(&legacy_history, &per_acc) {
            Ok(_) => {
                log::info!("migration: split balance history into per-account file");
                changed = true;
            }
            Err(e) => log::warn!("migration: per-account history split failed: {e}"),
        }
    }

    if changed {
        if let Err(e) = crate::config::save_config(app, &cfg) {
            log::warn!("migration: failed to save migrated flag: {e}");
        }
    }
}

/// 复制文件到目标目录（同名）；返回新路径。源文件不存在时原样返回旧路径
fn remap_file(path: Option<String>, old_dir: &Path, new_dir: &Path) -> Option<String> {
    let p = path?;
    let src = Path::new(&p);
    if !src.is_file() {
        return Some(p);
    }
    let name = src.file_name()?.to_string_lossy().to_string();
    if !src.starts_with(old_dir) {
        return Some(p); // 路径不在旧目录下，无需搬迁
    }
    let _ = fs::create_dir_all(new_dir);
    let dst = new_dir.join(&name);
    if !dst.exists() {
        let _ = fs::copy(src, &dst);
    }
    Some(dst.to_string_lossy().to_string())
}

/// 剪贴板历史迁移核心：旧库 → 新库（按 hash 去重），图片文件搬迁
fn migrate_clipboard_db(
    old_db: &Path,
    new_db: &Path,
    old_dir: &Path,
    new_images: &Path,
    new_thumbs: &Path,
) -> Result<i64, String> {
    // 复制旧库（含 WAL/SHM）到临时目录，避免锁原库或与仍在运行的 PasteBoard 冲突
    let tmp_db = std::env::temp_dir().join(format!("easytool-migrate-{}.db", std::process::id()));
    fs::copy(old_db, &tmp_db).map_err(|e| e.to_string())?;
    for ext in ["-wal", "-shm"] {
        let src = PathBuf::from(format!("{}{ext}", old_db.display()));
        if src.exists() {
            let _ = fs::copy(&src, PathBuf::from(format!("{}{ext}", tmp_db.display())));
        }
    }

    let conn = Connection::open(&tmp_db).map_err(|e| format!("打开旧库失败: {e}"))?;
    let has_html = table_columns(&conn, "items")?.iter().any(|c| c == "html");
    let select_sql = if has_html {
        "SELECT kind, content, html, file_paths, image_path, thumb_path, hash, pinned, created_at FROM items"
    } else {
        "SELECT kind, content, NULL, file_paths, image_path, thumb_path, hash, pinned, created_at FROM items"
    };

    // 新库：建表（含 html 列，对齐 clipboard 模块 schema）
    let nconn = Connection::open(new_db).map_err(|e| format!("打开新库失败: {e}"))?;
    nconn
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS items (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                kind        TEXT NOT NULL CHECK(kind IN ('text','image','files')),
                content     TEXT,
                html        TEXT,
                file_paths  TEXT,
                image_path  TEXT,
                thumb_path  TEXT,
                hash        TEXT NOT NULL UNIQUE,
                pinned      INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("新库建表失败: {e}"))?;

    let mut stmt = conn.prepare(select_sql).map_err(|e| format!("读取旧库失败: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, i64>(7)? != 0,
                r.get::<_, i64>(8)?,
            ))
        })
        .map_err(|e| format!("读取旧库失败: {e}"))?;

    let mut inserted: i64 = 0;
    for row in rows {
        let (kind, content, html, file_paths, image_path, thumb_path, hash, pinned, created_at) =
            row.map_err(|e| format!("读取旧记录失败: {e}"))?;
        let image_path = remap_file(image_path, &old_dir.join("images"), new_images);
        let thumb_path = remap_file(thumb_path, &old_dir.join("thumbs"), new_thumbs);
        inserted += nconn
            .execute(
                "INSERT OR IGNORE INTO items
                 (kind, content, html, file_paths, image_path, thumb_path, hash, pinned, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    kind,
                    content,
                    html,
                    file_paths,
                    image_path,
                    thumb_path,
                    hash,
                    pinned,
                    created_at
                ],
            )
            .map_err(|e| format!("写入新库失败: {e}"))? as i64;
    }

    let _ = fs::remove_file(&tmp_db);
    let _ = fs::remove_file(PathBuf::from(format!("{}-wal", tmp_db.display())));
    let _ = fs::remove_file(PathBuf::from(format!("{}-shm", tmp_db.display())));
    Ok(inserted)
}

/// 解析时间字段：ISO 字符串或 .NET /Date(ms)/ 格式；返回可排序的 (epoch_ms, iso)
fn parse_time(raw: &str) -> Option<(i64, String)> {
    if let Some(inner) = raw.strip_prefix("/Date(") {
        if let Some(ms) = inner.strip_suffix(")/") {
            if let Ok(ms) = ms.parse::<i64>() {
                let secs = ms / 1000;
                if let Some(dt) = chrono::DateTime::from_timestamp(secs, 0) {
                    return Some((ms, dt.to_rfc3339()));
                }
            }
        }
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) {
        return Some((dt.timestamp_millis(), dt.to_rfc3339()));
    }
    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S") {
        let dt = naive.and_utc();
        return Some((dt.timestamp_millis(), dt.to_rfc3339()));
    }
    None
}

/// 余额历史迁移核心：旧 json → 合并进新 balance_history.json
fn migrate_balance_file(src: &Path, dst: &Path) -> Result<i64, String> {
    let text = fs::read_to_string(src).map_err(|e| format!("读取余额记录失败: {e}"))?;
    let doc: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析余额记录失败: {e}"))?;
    let records = doc
        .get("records")
        .or_else(|| doc.get("记录"))
        .and_then(|v| v.as_array())
        .ok_or_else(|| "余额记录格式不符".to_string())?;

    // 读现有历史（存在则合并）
    let mut merged: Vec<(i64, String, f64)> = Vec::new();
    if let Ok(existing) = fs::read_to_string(dst) {
        if let Ok(edoc) = serde_json::from_str::<serde_json::Value>(&existing) {
            if let Some(erecs) = edoc.get("records").and_then(|v| v.as_array()) {
                for r in erecs {
                    if let (Some(time), Some(balance)) = (
                        r.get("time").and_then(|v| v.as_str()),
                        r.get("balance").and_then(|v| v.as_f64()),
                    ) {
                        if let Some((ms, iso)) = parse_time(time) {
                            merged.push((ms, iso, balance));
                        }
                    }
                }
            }
        }
    }

    let before = merged.len();
    for r in records {
        let bal = r.get("balance").or_else(|| r.get("余额")).and_then(|v| v.as_f64());
        let time = r.get("time").or_else(|| r.get("时间")).and_then(|v| v.as_str());
        let (Some(bal), Some(time)) = (bal, time) else { continue };
        let Some((ms, iso)) = parse_time(time) else { continue };
        if !merged.iter().any(|(m, _, b)| *m == ms && (*b - bal).abs() < 1e-9) {
            merged.push((ms, iso, bal));
        }
    }
    let added = merged.len() - before;
    if added == 0 {
        return Ok(0);
    }

    merged.sort_by_key(|(ms, _, _)| *ms);
    let out: Vec<serde_json::Value> = merged
        .iter()
        .map(|(_, iso, bal)| serde_json::json!({ "time": iso, "balance": bal }))
        .collect();
    if let Some(dir) = dst.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let payload = serde_json::json!({ "records": out });
    fs::write(dst, serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?)
        .map_err(|e| format!("写入余额历史失败: {e}"))?;
    Ok(added as i64)
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let cols = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(cols)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_old_db(path: &Path, images_dir: &Path) {
        let _ = fs::create_dir_all(images_dir);
        fs::write(images_dir.join("1.png"), b"PNGDATA").unwrap();
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                content TEXT,
                html TEXT,
                file_paths TEXT,
                image_path TEXT,
                thumb_path TEXT,
                hash TEXT NOT NULL UNIQUE,
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO items (kind, content, html, image_path, hash, pinned, created_at)
             VALUES ('text', 'hello', '<b>hi</b>', NULL, 'h1', 0, 100)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO items (kind, content, hash, pinned, created_at)
             VALUES ('text', 'world', 'h2', 1, 200)",
            [],
        )
        .unwrap();
        let img = images_dir.join("1.png").to_string_lossy().to_string();
        conn.execute(
            "INSERT INTO items (kind, image_path, thumb_path, hash, pinned, created_at)
             VALUES ('image', ?1, ?1, 'h3', 0, 300)",
            params![img],
        )
        .unwrap();
    }

    #[test]
    fn clipboard_migration_preserves_items() {
        let tmp = std::env::temp_dir().join(format!("easytool-mt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let old_dir = tmp.join("old");
        let new_dir = tmp.join("new");
        let images = old_dir.join("images");
        let new_images = new_dir.join("images");
        let new_thumbs = new_dir.join("thumbs");
        let old_db = old_dir.join("pasteboard.db");
        let new_db = new_dir.join("clipboard.db");
        fs::create_dir_all(&new_dir).unwrap();
        make_old_db(&old_db, &images);

        let n = migrate_clipboard_db(&old_db, &new_db, &old_dir, &new_images, &new_thumbs).unwrap();
        assert_eq!(n, 3, "应导入 3 条");

        // 图片已复制
        assert!(new_images.join("1.png").is_file());

        // 幂等：再次执行不重复导入
        let n2 = migrate_clipboard_db(&old_db, &new_db, &old_dir, &new_images, &new_thumbs).unwrap();
        assert_eq!(n2, 0, "二次迁移应导入 0 条");

        // 内容正确
        let conn = Connection::open(&new_db).unwrap();
        let cnt: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(cnt, 3);
        let hello: String = conn
            .query_row(
                "SELECT content FROM items WHERE hash='h1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hello, "hello");
        let html: String = conn
            .query_row("SELECT html FROM items WHERE hash='h1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(html, "<b>hi</b>");
        let img_path: String = conn
            .query_row(
                "SELECT image_path FROM items WHERE hash='h3'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(img_path.contains("easytool-mt"), "图片路径应重映射到新目录");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn balance_migration_merges_and_dedups() {
        let tmp = std::env::temp_dir().join(format!("easytool-mb-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let _ = fs::create_dir_all(&tmp);

        // 旧文件：混合 .NET /Date(ms)/ 与 ISO 格式（第一条与现有记录同刻、同余额 → 应去重）
        let src = tmp.join("余额记录.json");
        fs::write(
            &src,
            r#"{"records":[
                {"time":"/Date(1704067200000)/","balance":50.0},
                {"time":"2024-01-02T03:04:05Z","balance":48.5}
            ]}"#,
        )
        .unwrap();

        // 新文件已有 1 条，其中 1 条与旧文件重复
        let dst = tmp.join("balance_history.json");
        fs::write(
            &dst,
            r#"{"records":[
                {"time":"2024-01-01T00:00:00+00:00","balance":50.0}
            ]}"#,
        )
        .unwrap();

        let added = migrate_balance_file(&src, &dst).unwrap();
        assert_eq!(added, 1, "50.0 重复不计数，仅 48.5 新增");

        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&dst).unwrap()).unwrap();
        let recs = doc["records"].as_array().unwrap();
        assert_eq!(recs.len(), 2);
        // 按时间排序：旧的 50.0 在前
        assert_eq!(recs[0]["balance"].as_f64().unwrap(), 50.0);
        assert_eq!(recs[1]["balance"].as_f64().unwrap(), 48.5);
        let _ = fs::remove_dir_all(&tmp);
    }
}