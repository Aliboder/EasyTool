//! emojis.db：图片表情、分组、使用统计、收藏（内置 Emoji 动态数据也存于此）
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS custom_emojis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                name TEXT NOT NULL,
                group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                use_count INTEGER NOT NULL DEFAULT 0,
                last_used_at INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS emoji_usage (
                char TEXT PRIMARY KEY,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                use_count INTEGER NOT NULL DEFAULT 0,
                last_used_at INTEGER
            );",
        )?;
        Ok(Db { conn: Mutex::new(conn) })
    }

    pub fn create_group(&self, name: &str) -> Result<i64, rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        conn.execute("INSERT INTO groups (name) VALUES (?1)", params![name])?;
        Ok(conn.last_insert_rowid())
    }

    pub fn rename_group(&self, id: i64, name: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        conn.execute("UPDATE groups SET name = ?1 WHERE id = ?2", params![name, id])?;
        Ok(())
    }

    pub fn delete_group(&self, id: i64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        conn.execute("DELETE FROM groups WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_groups(&self) -> Result<Vec<(i64, String)>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut stmt = conn.prepare("SELECT id, name FROM groups ORDER BY sort_order, id")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn insert_custom(&self, file_path: &str, name: &str) -> Result<i64, rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let now = now_ms();
        conn.execute(
            "INSERT INTO custom_emojis (file_path, name, created_at) VALUES (?1, ?2, ?3)",
            params![file_path, name, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn set_custom_path(&self, id: i64, path: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        conn.execute(
            "UPDATE custom_emojis SET file_path = ?1 WHERE id = ?2",
            params![path, id],
        )?;
        Ok(())
    }

    pub fn delete_custom(&self, id: i64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        conn.execute("DELETE FROM custom_emojis WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn rename_custom(&self, id: i64, name: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        conn.execute(
            "UPDATE custom_emojis SET name = ?1 WHERE id = ?2",
            params![name, id],
        )?;
        Ok(())
    }

    pub fn move_custom(&self, id: i64, group_id: Option<i64>) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        conn.execute(
            "UPDATE custom_emojis SET group_id = ?1 WHERE id = ?2",
            params![group_id, id],
        )?;
        Ok(())
    }

    pub fn get_custom(&self, id: i64) -> Result<Option<(String, String)>, rusqlite::Error> {
        // 返回 (file_path, name)
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut stmt =
            conn.prepare("SELECT file_path, name FROM custom_emojis WHERE id = ?1")?;
        let mut rows = stmt.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.next().transpose()
    }

    pub fn list_custom(&self) -> Result<Vec<CustomRow>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut stmt = conn.prepare(
            "SELECT id, file_path, name, group_id, is_favorite, use_count, last_used_at, created_at
             FROM custom_emojis ORDER BY is_favorite DESC, use_count DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(CustomRow {
                id: r.get(0)?,
                file_path: r.get(1)?,
                name: r.get(2)?,
                group_id: r.get(3)?,
                is_favorite: r.get(4)?,
                use_count: r.get(5)?,
                last_used_at: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn record_use_custom(&self, id: i64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        conn.execute(
            "UPDATE custom_emojis SET use_count = use_count + 1, last_used_at = ?1 WHERE id = ?2",
            params![now_ms(), id],
        )?;
        Ok(())
    }

    pub fn toggle_fav_custom(&self, id: i64, fav: bool) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        conn.execute(
            "UPDATE custom_emojis SET is_favorite = ?1 WHERE id = ?2",
            params![fav as i64, id],
        )?;
        Ok(())
    }

    pub fn record_use_builtin(&self, char_key: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        conn.execute(
            "INSERT INTO emoji_usage (char, use_count, last_used_at) VALUES (?1, 1, ?2)
             ON CONFLICT(char) DO UPDATE SET
               use_count = use_count + 1, last_used_at = excluded.last_used_at",
            params![char_key, now_ms()],
        )?;
        Ok(())
    }

    pub fn toggle_fav_builtin(&self, char_key: &str, fav: bool) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        conn.execute(
            "INSERT INTO emoji_usage (char, is_favorite) VALUES (?1, ?2)
             ON CONFLICT(char) DO UPDATE SET is_favorite = excluded.is_favorite",
            params![char_key, fav as i64],
        )?;
        Ok(())
    }

    pub fn usage_map(
        &self,
    ) -> Result<std::collections::HashMap<String, (i64, i64, i64)>, rusqlite::Error> {
        // char -> (is_favorite, use_count, last_used_at)
        let conn = self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut stmt =
            conn.prepare("SELECT char, is_favorite, use_count, last_used_at FROM emoji_usage")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?),
            ))
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CustomRow {
    pub id: i64,
    pub file_path: String,
    pub name: String,
    pub group_id: Option<i64>,
    pub is_favorite: bool,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_mem() -> Db {
        Db::open(Path::new(":memory:")).unwrap()
    }

    #[test]
    fn group_crud() {
        let db = open_mem();
        let g = db.create_group("工作").unwrap();
        assert_eq!(db.rename_group(g, "工作2").unwrap(), ());
        assert_eq!(db.list_groups().unwrap().len(), 1);
        db.delete_group(g).unwrap();
        assert!(db.list_groups().unwrap().is_empty());
    }

    #[test]
    fn custom_emoji_crud_and_stats() {
        let db = open_mem();
        let id = db.insert_custom("/x/a.png", "a").unwrap();
        db.record_use_custom(id).unwrap();
        db.record_use_custom(id).unwrap();
        let row = db.list_custom().unwrap();
        assert_eq!(row.len(), 1);
        assert_eq!(row[0].use_count, 2);
        db.toggle_fav_custom(id, true).unwrap();
        let row = db.list_custom().unwrap();
        assert!(row[0].is_favorite);
        db.delete_custom(id).unwrap();
        assert!(db.list_custom().unwrap().is_empty());
    }

    #[test]
    fn group_delete_sets_null() {
        let db = open_mem();
        let g = db.create_group("g").unwrap();
        let id = db.insert_custom("/x/b.png", "b").unwrap();
        db.move_custom(id, Some(g)).unwrap();
        db.delete_group(g).unwrap();
        let row = db.list_custom().unwrap();
        assert_eq!(row[0].group_id, None);
    }

    #[test]
    fn builtin_usage_upsert() {
        let db = open_mem();
        db.record_use_builtin("😀").unwrap();
        db.record_use_builtin("😀").unwrap();
        let m = db.usage_map().unwrap();
        assert_eq!(m["😀"].1, 2);
        db.toggle_fav_builtin("😀", true).unwrap();
        let m = db.usage_map().unwrap();
        assert_eq!(m["😀"].0, 1);
    }
}
