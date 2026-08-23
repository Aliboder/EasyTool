use rusqlite::{Connection, params, OptionalExtension};
use super::types::{Item, Folder, ItemType};
use std::path::Path;

pub struct QuicklaunchDb {
    conn: Connection,
}

impl QuicklaunchDb {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path)
            .map_err(|e| format!("打开数据库失败: {e}"))?;
        
        // 启用 WAL 模式
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("设置 WAL 模式失败: {e}"))?;
        
        let db = Self { conn };
        db.init_tables()?;
        Ok(db)
    }
    
    fn init_tables(&self) -> Result<(), String> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                parent_id INTEGER,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK(type IN ('app', 'file', 'folder', 'url')),
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                icon_path TEXT,
                folder_id INTEGER,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_items_folder ON items(folder_id);
            CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
            CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);"
        ).map_err(|e| format!("创建表失败: {e}"))?;
        Ok(())
    }
    
    // ========== Items ==========
    
    /// 检查文件路径是否已存在
    pub fn item_exists_by_path(&self, path: &str) -> Result<Option<i64>, String> {
        self.conn.query_row(
            "SELECT id FROM items WHERE path = ?1",
            params![path],
            |row| row.get(0),
        ).optional().map_err(|e| format!("查询失败: {e}"))
    }

    /// 全部条目的 (id, path)：内容级判重时逐条解析目标比对
    pub fn list_item_paths(&self) -> Result<Vec<(i64, String)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, path FROM items")
            .map_err(|e| format!("查询失败: {e}"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| format!("查询失败: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取失败: {e}"))
    }
    
    /// 更新项目的时间戳（用于重复添加时刷新）
    pub fn touch_item(&self, id: i64) -> Result<(), String> {
        self.conn.execute(
            "UPDATE items SET created_at = datetime('now') WHERE id = ?1",
            params![id],
        ).map_err(|e| format!("更新时间失败: {e}"))?;
        Ok(())
    }
    
    pub fn create_item(&self, item_type: ItemType, name: &str, path: &str, folder_id: Option<i64>) -> Result<Item, String> {
        self.create_item_with_icon(item_type, name, path, folder_id, None)
    }
    
    pub fn create_item_with_icon(&self, item_type: ItemType, name: &str, path: &str, folder_id: Option<i64>, icon_path: Option<&str>) -> Result<Item, String> {
        let type_str = match item_type {
            ItemType::App => "app",
            ItemType::File => "file",
            ItemType::Folder => "folder",
            ItemType::Url => "url",
        };
        
        let max_order: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(sort_order), 0) FROM items WHERE folder_id IS ?1",
            params![folder_id],
            |row| row.get(0),
        ).unwrap_or(0);
        
        self.conn.execute(
            "INSERT INTO items (type, name, path, icon_path, folder_id, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![type_str, name, path, icon_path, folder_id, max_order + 1],
        ).map_err(|e| format!("创建固定项失败: {e}"))?;
        
        let id = self.conn.last_insert_rowid();
        self.get_item(id)
    }
    
    pub fn get_item(&self, id: i64) -> Result<Item, String> {
        self.conn.query_row(
            "SELECT id, type, name, path, icon_path, folder_id, sort_order, created_at FROM items WHERE id = ?1",
            params![id],
            |row| {
                let type_str: String = row.get(1)?;
                let item_type = match type_str.as_str() {
                    "app" => ItemType::App,
                    "file" => ItemType::File,
                    "folder" => ItemType::Folder,
                    "url" => ItemType::Url,
                    _ => ItemType::File,
                };
                Ok(Item {
                    id: row.get(0)?,
                    item_type,
                    name: row.get(2)?,
                    path: row.get(3)?,
                    icon_path: row.get(4)?,
                    folder_id: row.get(5)?,
                    sort_order: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        ).map_err(|e| format!("获取固定项失败: {e}"))
    }
    
    pub fn list_items(&self, filter: &super::types::FilterOptions) -> Result<Vec<Item>, String> {
        let mut sql = String::from(
            "SELECT id, type, name, path, icon_path, folder_id, sort_order, created_at FROM items WHERE 1=1"
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        
        if let Some(ref item_type) = filter.item_type {
            let type_str = match item_type {
                ItemType::App => "app",
                ItemType::File => "file",
                ItemType::Folder => "folder",
                ItemType::Url => "url",
            };
            sql.push_str(" AND type = ?");
            params.push(Box::new(type_str.to_string()));
        }
        
        if let Some(ref search) = filter.search {
            sql.push_str(" AND name LIKE ?");
            params.push(Box::new(format!("%{}%", search)));
        }
        
        // SQL 注入防护：白名单验证排序字段
        let sort_by = match filter.sort_by.as_deref() {
            Some("name") => "name",
            Some("created_at") => "created_at",
            Some("sort_order") | None => "sort_order",
            Some(_) => "sort_order", // 无效值使用默认排序
        };
        let sort_desc = filter.sort_desc.unwrap_or(false);
        sql.push_str(&format!(" ORDER BY {} {}", sort_by, if sort_desc { "DESC" } else { "ASC" }));
        
        let mut stmt = self.conn.prepare(&sql).map_err(|e| format!("准备查询失败: {e}"))?;
        let rows = stmt.query_map(rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())), |row| {
            let type_str: String = row.get(1)?;
            let item_type = match type_str.as_str() {
                "app" => ItemType::App,
                "file" => ItemType::File,
                "folder" => ItemType::Folder,
                "url" => ItemType::Url,
                _ => ItemType::File,
            };
            Ok(Item {
                id: row.get(0)?,
                item_type,
                name: row.get(2)?,
                path: row.get(3)?,
                icon_path: row.get(4)?,
                folder_id: row.get(5)?,
                sort_order: row.get(6)?,
                created_at: row.get(7)?,
            })
        }).map_err(|e| format!("查询失败: {e}"))?;
        
        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|e| format!("读取行失败: {e}"))?);
        }
        Ok(items)
    }
    
    pub fn update_item(&self, id: i64, name: Option<&str>, folder_id: Option<Option<i64>>) -> Result<Item, String> {
        if let Some(name) = name {
            self.conn.execute(
                "UPDATE items SET name = ?1 WHERE id = ?2",
                params![name, id],
            ).map_err(|e| format!("更新名称失败: {e}"))?;
        }
        
        if let Some(folder_id) = folder_id {
            self.conn.execute(
                "UPDATE items SET folder_id = ?1 WHERE id = ?2",
                params![folder_id, id],
            ).map_err(|e| format!("更新文件夹失败: {e}"))?;
        }
        
        self.get_item(id)
    }
    
    pub fn delete_item(&self, id: i64) -> Result<(), String> {
        self.conn.execute(
            "DELETE FROM items WHERE id = ?1",
            params![id],
        ).map_err(|e| format!("删除固定项失败: {e}"))?;
        Ok(())
    }
    
    pub fn sort_items(&self, item_ids: &[i64]) -> Result<(), String> {
        let mut stmt = self.conn.prepare(
            "UPDATE items SET sort_order = ?1 WHERE id = ?2"
        ).map_err(|e| format!("准备排序更新失败: {e}"))?;
        
        for (i, &id) in item_ids.iter().enumerate() {
            stmt.execute(params![i as i64 + 1, id])
                .map_err(|e| format!("更新排序失败: {e}"))?;
        }
        Ok(())
    }
    
    // ========== Folders ==========
    
    pub fn create_folder(&self, name: &str, parent_id: Option<i64>) -> Result<Folder, String> {
        let max_order: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(sort_order), 0) FROM folders WHERE parent_id IS ?1",
            params![parent_id],
            |row| row.get(0),
        ).unwrap_or(0);
        
        self.conn.execute(
            "INSERT INTO folders (name, parent_id, sort_order) VALUES (?1, ?2, ?3)",
            params![name, parent_id, max_order + 1],
        ).map_err(|e| format!("创建文件夹失败: {e}"))?;
        
        let id = self.conn.last_insert_rowid();
        self.get_folder(id)
    }
    
    pub fn get_folder(&self, id: i64) -> Result<Folder, String> {
        self.conn.query_row(
            "SELECT id, name, parent_id, sort_order, created_at FROM folders WHERE id = ?1",
            params![id],
            |row| {
                Ok(Folder {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    sort_order: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        ).map_err(|e| format!("获取文件夹失败: {e}"))
    }
    
    pub fn list_folders(&self, parent_id: Option<i64>) -> Result<Vec<Folder>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, parent_id, sort_order, created_at FROM folders WHERE parent_id IS ?1 ORDER BY sort_order ASC"
        ).map_err(|e| format!("准备查询失败: {e}"))?;
        
        let rows = stmt.query_map(params![parent_id], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: row.get(4)?,
            })
        }).map_err(|e| format!("查询失败: {e}"))?;
        
        let mut folders = Vec::new();
        for row in rows {
            folders.push(row.map_err(|e| format!("读取行失败: {e}"))?);
        }
        Ok(folders)
    }
    
    pub fn update_folder(&self, id: i64, name: Option<&str>, parent_id: Option<Option<i64>>) -> Result<Folder, String> {
        if let Some(name) = name {
            self.conn.execute(
                "UPDATE folders SET name = ?1 WHERE id = ?2",
                params![name, id],
            ).map_err(|e| format!("更新名称失败: {e}"))?;
        }
        
        if let Some(parent_id) = parent_id {
            self.conn.execute(
                "UPDATE folders SET parent_id = ?1 WHERE id = ?2",
                params![parent_id, id],
            ).map_err(|e| format!("更新父文件夹失败: {e}"))?;
        }
        
        self.get_folder(id)
    }
    
    pub fn delete_folder(&self, id: i64) -> Result<(), String> {
        // 删除文件夹（级联删除会自动删除关联的 items）
        self.conn.execute(
            "DELETE FROM folders WHERE id = ?1",
            params![id],
        ).map_err(|e| format!("删除文件夹失败: {e}"))?;
        
        Ok(())
    }
    
    pub fn sort_folders(&self, folder_ids: &[i64]) -> Result<(), String> {
        let mut stmt = self.conn.prepare(
            "UPDATE folders SET sort_order = ?1 WHERE id = ?2"
        ).map_err(|e| format!("准备排序更新失败: {e}"))?;
        
        for (i, &id) in folder_ids.iter().enumerate() {
            stmt.execute(params![i as i64 + 1, id])
                .map_err(|e| format!("更新排序失败: {e}"))?;
        }
        Ok(())
    }
    
    /// 获取文件夹及其子项目（最多返回4个子项目用于预览）
    pub fn get_folder_with_items(&self, folder_id: i64) -> Result<(Folder, Vec<Item>), String> {
        let folder = self.get_folder(folder_id)?;
        
        let mut stmt = self.conn.prepare(
            "SELECT id, type, name, path, icon_path, folder_id, sort_order, created_at 
             FROM items WHERE folder_id = ?1 
             ORDER BY sort_order ASC LIMIT 4"
        ).map_err(|e| format!("准备查询失败: {e}"))?;
        
        let rows = stmt.query_map(params![folder_id], |row| {
            let type_str: String = row.get(1)?;
            let item_type = match type_str.as_str() {
                "app" => ItemType::App,
                "file" => ItemType::File,
                "folder" => ItemType::Folder,
                "url" => ItemType::Url,
                _ => ItemType::File,
            };
            Ok(Item {
                id: row.get(0)?,
                item_type,
                name: row.get(2)?,
                path: row.get(3)?,
                icon_path: row.get(4)?,
                folder_id: row.get(5)?,
                sort_order: row.get(6)?,
                created_at: row.get(7)?,
            })
        }).map_err(|e| format!("查询失败: {e}"))?;
        
        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|e| format!("读取行失败: {e}"))?);
        }
        
        Ok((folder, items))
    }
    
    /// 获取所有分组及其子项目预览
    pub fn list_folders_with_items(&self) -> Result<Vec<(Folder, Vec<Item>)>, String> {
        let folders = self.list_folders(None)?;
        let mut result = Vec::new();
        
        for folder in folders {
            let items = self.get_folder_with_items(folder.id)?;
            result.push(items);
        }
        
        Ok(result)
    }
}