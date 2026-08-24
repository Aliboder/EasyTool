//! SQLite 存储层：条目读写、固定、上限清理

use super::models::{Item, ItemKind};
use rusqlite::{params, Connection, OptionalExtension};

pub struct Db {
    conn: Connection,
}

#[derive(Debug)]
pub enum DbError {
    Sql(rusqlite::Error),
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbError::Sql(e) => write!(f, "sqlite error: {e}"),
        }
    }
}

impl std::error::Error for DbError {}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sql(e)
    }
}

impl Db {
    /// 打开数据库并建表（测试可用 ":memory:"）
    pub fn open(path: &str) -> Result<Self, DbError> {
        let conn = Connection::open(path)?;
        let db = Db { conn };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<(), DbError> {
        // WAL：监听线程高频写库时提升并发，崩溃时更安全（-wal/-shm 文件伴随 db 生成）
        self.conn
            .execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")?;
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS items (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                kind        TEXT NOT NULL CHECK(kind IN ('text','image','files')),
                content     TEXT,
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
            );
            CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_items_pinned ON items(pinned);
            CREATE INDEX IF NOT EXISTS idx_items_hash ON items(hash);
            CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);",
        )?;
        // 版本化迁移：schema_version 在 settings 表中，缺失视为 0（旧库）
        let version: i64 = self
            .get_setting("schema_version")
            .ok()
            .flatten()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        if version < 1 {
            // v1：富文本列（0.4.0 引入）。列探测保证幂等，兼容从未写入版本的库
            let cols = self
                .conn
                .prepare("PRAGMA table_info(items)")?
                .query_map([], |r| r.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()?;
            if !cols.iter().any(|c| c == "html") {
                self.conn
                    .execute_batch("ALTER TABLE items ADD COLUMN html TEXT")?;
            }
            self.set_setting("schema_version", "1")?;
        }
        if version < 2 {
            // v2：固定条目手动排序（固定 Tab 拖拽，0.7.0 引入）；NULL = 未排过序（按时间倒序排在其他固定条目之后）
            let cols = self
                .conn
                .prepare("PRAGMA table_info(items)")?
                .query_map([], |r| r.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()?;
            if !cols.iter().any(|c| c == "pin_order") {
                self.conn
                    .execute_batch("ALTER TABLE items ADD COLUMN pin_order INTEGER")?;
            }
            self.set_setting("schema_version", "2")?;
        }
        // pin_order 列在 v2 迁移后才存在，索引须在其后创建（旧库无此列）
        self.conn
            .execute_batch("CREATE INDEX IF NOT EXISTS idx_items_pinned_order ON items(pinned, pin_order)")?;
        Ok(())
    }

    // ---------- 条目 ----------

    /// 插入新条目；hash 冲突时忽略并返回 None
    pub fn insert_item(&self, item: &Item) -> Result<Option<i64>, DbError> {
        let result = self.conn.execute(
            "INSERT INTO items (kind, content, html, file_paths, image_path, thumb_path, hash, pinned, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                item.kind.as_str(),
                item.content,
                item.html,
                item.file_paths,
                item.image_path,
                item.thumb_path,
                item.hash,
                item.pinned as i64,
                item.created_at,
            ],
        );
        match result {
            Ok(_) => Ok(Some(self.conn.last_insert_rowid())),
            Err(rusqlite::Error::SqliteFailure(e, _))
                if e.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                Ok(None) // hash 唯一冲突 → 已存在
            }
            Err(e) => Err(DbError::Sql(e)),
        }
    }

    /// 为已有条目回填富文本（去重命中时升级用）
    pub fn set_html(&self, id: i64, html: Option<String>) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE items SET html = ?1 WHERE id = ?2",
            params![html, id],
        )?;
        Ok(())
    }

    /// 按 hash 查找条目 id
    pub fn find_by_hash(&self, hash: &str) -> Result<Option<i64>, DbError> {
        let id = self
            .conn
            .query_row(
                "SELECT id FROM items WHERE hash = ?1",
                params![hash],
                |row| row.get(0),
            )
            .optional()?;
        Ok(id)
    }

    /// 把已有条目顶到最前（刷新 created_at）
    pub fn touch_item(&self, id: i64, now_ms: i64) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE items SET created_at = ?1 WHERE id = ?2",
            params![now_ms, id],
        )?;
        Ok(())
    }

    pub fn get_item(&self, id: i64) -> Result<Option<Item>, DbError> {
        let item = self
            .conn
            .query_row(
                "SELECT id, kind, content, file_paths, image_path, thumb_path, hash, pinned, created_at, html
                 FROM items WHERE id = ?1",
                params![id],
                row_to_item,
            )
            .optional()?;
        Ok(item)
    }

    /// 查询历史；keyword 非空时对文本内容/文件路径做 LIKE 过滤；kind 非空时按类型过滤，
    /// kind == "pinned" 时仅返回固定条目（"固定" Tab，不限制类型）
    pub fn list_items(
        &self,
        keyword: &str,
        kind: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Item>, DbError> {
        let mut sql = String::from(
            "SELECT id, kind, content, file_paths, image_path, thumb_path, hash, pinned, created_at, html
             FROM items WHERE 1=1",
        );
        let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let keyword = keyword.trim();
        if !keyword.is_empty() {
            // 转义 LIKE 通配符，让 %/_ 按字面匹配
            let esc = keyword
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            let pattern = format!("%{esc}%");
            sql.push_str(
                " AND (content LIKE ? ESCAPE '\\' OR file_paths LIKE ? ESCAPE '\\')",
            );
            args.push(Box::new(pattern.clone()));
            args.push(Box::new(pattern));
        }
        if let Some(k) = kind {
            if k == "pinned" {
                sql.push_str(" AND pinned = 1");
            } else if k == "image" {
                // 图片 Tab 口径：图片条目 + 文件条目（文件中的图片由调用方精确过滤）
                sql.push_str(" AND (kind = 'image' OR kind = 'files')");
            } else {
                sql.push_str(" AND kind = ?");
                args.push(Box::new(k.to_string()));
            }
        }
        // 排序：固定 Tab 按手动排序（pin_order，NULL 未排过序的排最后、其次按时间倒序）；其余按时间倒序
        if kind == Some("pinned") {
            sql.push_str(
                " ORDER BY pin_order IS NULL, pin_order ASC, created_at DESC LIMIT ? OFFSET ?",
            );
        } else {
            sql.push_str(" ORDER BY created_at DESC LIMIT ? OFFSET ?");
        }
        args.push(Box::new(limit));
        args.push(Box::new(offset));
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())),
            row_to_item,
        )?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn set_pinned(&self, id: i64, pinned: bool) -> Result<bool, DbError> {
        // 取消固定时刷新时间戳：条目作为最新记录重新回到列表顶部（固定期间豁免清理）
        let n = if pinned {
            self.conn
                .execute("UPDATE items SET pinned = 1 WHERE id = ?1", params![id])?
        } else {
            self.conn.execute(
                "UPDATE items SET pinned = 0, created_at = ?1 WHERE id = ?2",
                params![now_ms(), id],
            )?
        };
        Ok(n > 0)
    }

    /// 按传入顺序给固定条目写入排序值（0,1,2...），固定 Tab 拖拽排序用
    pub fn set_pin_orders(&self, ids: &[i64]) -> Result<(), DbError> {
        for (i, id) in ids.iter().enumerate() {
            self.conn.execute(
                "UPDATE items SET pin_order = ?1 WHERE id = ?2 AND pinned = 1",
                params![i as i64, id],
            )?;
        }
        Ok(())
    }

    /// 图片落盘后回填路径
    pub fn set_image_paths(
        &self,
        id: i64,
        image_path: Option<String>,
        thumb_path: Option<String>,
    ) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE items SET image_path = ?1, thumb_path = ?2 WHERE id = ?3",
            params![image_path, thumb_path, id],
        )?;
        Ok(())
    }

    /// 删除单条；返回被删条目的磁盘文件路径（若有），供调用方清理文件
    pub fn delete_item(&self, id: i64) -> Result<Option<Item>, DbError> {
        let item = self.get_item(id)?;
        if item.is_some() {
            self.conn
                .execute("DELETE FROM items WHERE id = ?1", params![id])?;
        }
        Ok(item)
    }

    /// 上限清理：删除最旧的非固定条目，直到不超过 max_items；返回被删条目
    pub fn prune(&self, max_items: i64) -> Result<Vec<Item>, DbError> {
        if max_items < 1 {
            return Ok(vec![]);
        }
        let mut removed = Vec::new();
        // 一次计算超出量，替代原来每次循环重复 COUNT(*) 查询
        let excess: i64 = self.conn.query_row(
            "SELECT MAX(0, COUNT(*) - ?1) FROM items",
            params![max_items],
            |r| r.get(0),
        )?;
        for _ in 0..excess {
            let id: Option<i64> = self
                .conn
                .query_row(
                    "SELECT id FROM items WHERE pinned = 0 ORDER BY created_at ASC LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .optional()?;
            let Some(id) = id else { break };
            if let Some(item) = self.delete_item(id)? {
                removed.push(item);
            }
        }
        Ok(removed)
    }

    pub fn clear_unpinned(&self) -> Result<Vec<Item>, DbError> {
        let items = self.list_items("", None, i64::MAX, 0)?;
        let unpinned: Vec<Item> = items.into_iter().filter(|it| !it.pinned).collect();
        if unpinned.is_empty() {
            return Ok(vec![]);
        }
        // 一条 SQL 批量删除（替代逐条 DELETE + 循环）
        self.conn
            .execute("DELETE FROM items WHERE pinned = 0", [])?;
        Ok(unpinned)
    }

    /// 清空全部条目（含固定），返回被删条目供文件清理
    pub fn clear_all(&self) -> Result<Vec<Item>, DbError> {
        let items = self.list_items("", None, i64::MAX, 0)?;
        self.conn.execute("DELETE FROM items", [])?;
        Ok(items)
    }

    /// 按类型计数（统计用）
    pub fn count_by_kind(&self, kind: &str) -> Result<i64, DbError> {
        let n = self.conn.query_row(
            "SELECT COUNT(*) FROM items WHERE kind = ?1",
            params![kind],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    /// 全部条目数（统计用，避免全量加载）
    pub fn count_all(&self) -> Result<i64, DbError> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))?)
    }

    // ---------- 设置（schema_version 等内部元数据） ----------

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        let v = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?;
        Ok(v)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    // ---------- 数据库维护 ----------

    /// 数据库文件超过阈值时 VACUUM，回收增删产生的碎片空间（启动时调用）
    pub fn vacuum_if_large(&self, threshold_bytes: u64) -> Result<(), DbError> {
        let page_size: i64 = self.conn.query_row("PRAGMA page_size", [], |r| r.get(0))?;
        let page_count: i64 = self.conn.query_row("PRAGMA page_count", [], |r| r.get(0))?;
        let size = (page_count as u64).saturating_mul(page_size as u64);
        if size > threshold_bytes {
            self.conn.execute_batch("VACUUM")?;
            log::info!("db vacuumed (was {size} bytes)");
        }
        Ok(())
    }
}

/// 启动备份：距上次备份超过 6 小时则复制 db 到 backup/，仅保留最近 5 份
pub fn backup_database(data_dir: &std::path::Path) {
    let db_path = data_dir.join("clipboard.db");
    if !db_path.exists() {
        return;
    }
    let backup_dir = data_dir.join("backup");
    if std::fs::create_dir_all(&backup_dir).is_err() {
        return;
    }
    // 距上次备份不足 6 小时则跳过
    let last = std::fs::read_dir(&backup_dir).ok().and_then(|rd| {
        rd.filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".db"))
            .filter_map(|e| e.metadata().ok())
            .filter_map(|m| m.modified().ok())
            .max()
    });
    if let Some(last) = last {
        if let Ok(elapsed) = last.elapsed() {
            if elapsed < std::time::Duration::from_secs(6 * 3600) {
                return;
            }
        }
    }
    let dest = backup_dir.join(format!("pasteboard-{}.db", now_ms()));
    // 先把 WAL 落盘，避免崩溃后备份缺少尾部提交
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_r| Ok(()));
    }
    if std::fs::copy(&db_path, &dest).is_ok() {
        log::info!("db backup saved: {}", dest.display());
    }
    // 只保留最近 5 份
    let mut files: Vec<_> = std::fs::read_dir(&backup_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".db"))
        .collect();
    files.sort_by_key(|f| f.file_name());
    while files.len() > 5 {
        let old = files.remove(0);
        let _ = std::fs::remove_file(old.path());
        log::info!("db backup pruned: {}", old.path().display());
    }
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<Item> {
    let kind: String = row.get(1)?;
    let kind = match kind.as_str() {
        "text" => ItemKind::Text,
        "image" => ItemKind::Image,
        "files" => ItemKind::Files,
        _ => {
            return Err(rusqlite::Error::InvalidColumnType(
                1,
                kind,
                rusqlite::types::Type::Text,
            ))
        }
    };
    Ok(Item {
        id: row.get(0)?,
        kind,
        content: row.get(2)?,
        file_paths: row.get(3)?,
        image_path: row.get(4)?,
        thumb_path: row.get(5)?,
        hash: row.get(6)?,
        pinned: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
        html: row.get(9)?,
    })
}

// ---------- 工具 ----------

/// 当前时间（Unix 毫秒）
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_item(hash: &str, pinned: bool, created_at: i64) -> Item {
        Item {
            id: 0,
            kind: ItemKind::Text,
            content: Some(format!("content-{hash}")),
            html: None,
            file_paths: None,
            image_path: None,
            thumb_path: None,
            hash: hash.to_string(),
            pinned,
            created_at,
        }
    }

    fn open_mem() -> Db {
        Db::open(":memory:").unwrap()
    }

    #[test]
    fn insert_and_get() {
        let db = open_mem();
        let item = test_item("h1", false, 1000);
        let id = db.insert_item(&item).unwrap().unwrap();
        let got = db.get_item(id).unwrap().unwrap();
        assert_eq!(got.hash, "h1");
        assert_eq!(got.kind, ItemKind::Text);
        assert_eq!(got.content.as_deref(), Some("content-h1"));
    }

    #[test]
    fn hash_unique_conflict_returns_none() {
        let db = open_mem();
        db.insert_item(&test_item("dup", false, 1000)).unwrap();
        let second = db.insert_item(&test_item("dup", false, 2000)).unwrap();
        assert!(second.is_none());
        assert_eq!(db.list_items("", None, 100, 0).unwrap().len(), 1);
    }

    #[test]
    fn touch_moves_to_top() {
        let db = open_mem();
        let a = db
            .insert_item(&test_item("a", false, 100))
            .unwrap()
            .unwrap();
        let b = db
            .insert_item(&test_item("b", false, 200))
            .unwrap()
            .unwrap();
        db.touch_item(a, 300).unwrap();
        let list = db.list_items("", None, 100, 0).unwrap();
        assert_eq!(list[0].id, a);
        assert_eq!(list[1].id, b);
    }

    #[test]
    fn list_filters_by_keyword() {
        let db = open_mem();
        db.insert_item(&test_item("a", false, 100)).unwrap();
        let mut files_item = test_item("b", false, 200);
        files_item.kind = ItemKind::Files;
        files_item.file_paths = Some(r#"["C:\\temp\\report.pdf"]"#.to_string());
        db.insert_item(&files_item).unwrap();
        let list = db.list_items("report", None, 100, 0).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].kind, ItemKind::Files);
    }

    #[test]
    fn pinned_not_priority_in_normal_list() {
        let db = open_mem();
        let a = db
            .insert_item(&test_item("a", false, 100))
            .unwrap()
            .unwrap();
        let b = db.insert_item(&test_item("b", true, 200)).unwrap().unwrap();
        // 普通查询（全部/文本/图片/文件）：固定条目不固定，按时间倒序混排
        let list = db.list_items("", None, 100, 0).unwrap();
        assert_eq!(list[0].id, b);
        assert_eq!(list[1].id, a);
        // 固定查询：仅固定条目
        let list = db.list_items("", Some("pinned"), 100, 0).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, b);
    }

    #[test]
    fn list_pinned_only() {
        let db = open_mem();
        let a = db
            .insert_item(&test_item("a", false, 100))
            .unwrap()
            .unwrap();
        let b = db.insert_item(&test_item("b", true, 200)).unwrap().unwrap();
        let mut img = test_item("img", true, 300);
        img.kind = ItemKind::Image;
        db.insert_item(&img).unwrap();
        // 固定 Tab 口径：仅固定条目，不限制类型
        let list = db.list_items("", Some("pinned"), 100, 0).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().all(|i| i.pinned));
        assert!(!list.iter().any(|i| i.id == a));
        // 固定 + 搜索叠加
        let list = db.list_items("b", Some("pinned"), 100, 0).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, b);
    }

    #[test]
    fn unpin_refreshes_timestamp_to_top() {
        let db = open_mem();
        let _a = db
            .insert_item(&test_item("a", false, 100))
            .unwrap()
            .unwrap();
        let b = db.insert_item(&test_item("b", true, 200)).unwrap().unwrap();
        db.set_pinned(b, false).unwrap();
        // 取消固定后时间戳刷新为最新，作为新记录回到列表顶部（先于所有旧条目）
        let list = db.list_items("", None, 100, 0).unwrap();
        assert_eq!(list[0].id, b);
        assert!(!list[0].pinned);
        assert!(list[0].created_at >= list[1].created_at);
        // 固定动作不刷新时间戳
        let before = list[0].created_at;
        db.set_pinned(b, true).unwrap();
        let item = db.get_item(b).unwrap().unwrap();
        assert_eq!(item.created_at, before);
    }

#[test]
    fn prune_keeps_pinned_removes_oldest() {
        let db = open_mem();
        let p = db.insert_item(&test_item("p", true, 100)).unwrap().unwrap();
        let x = db
            .insert_item(&test_item("x", false, 200))
            .unwrap()
            .unwrap();
        let y = db
            .insert_item(&test_item("y", false, 300))
            .unwrap()
            .unwrap();
        let z = db
            .insert_item(&test_item("z", false, 400))
            .unwrap()
            .unwrap();
        let removed = db.prune(2).unwrap();
        // 上限 2：保留固定 p + 最新 z；删掉最旧的两个 x、y
        assert_eq!(removed.len(), 2);
        let ids: Vec<i64> = removed.iter().map(|i| i.id).collect();
        assert!(ids.contains(&x) && ids.contains(&y));
        let remaining = db.list_items("", None, 100, 0).unwrap();
        assert_eq!(remaining.len(), 2);
        // 普通查询按时间倒序：z(400) 在 p(100) 前
        assert_eq!(remaining[0].id, z);
        assert_eq!(remaining[1].id, p);
    }

    /// 富文本升级路径（monitor 去重命中后 set_html 回填）
    #[test]
    fn html_upgrade_flow() {
        let db = open_mem();
        let mut item = test_item("h1", false, 1000);
        item.html = None;
        let id = db.insert_item(&item).unwrap().unwrap();
        db.set_html(id, Some("<b>x</b>".into())).unwrap();
        let got = db.get_item(id).unwrap().unwrap();
        assert_eq!(got.html.as_deref(), Some("<b>x</b>"));
    }
}
