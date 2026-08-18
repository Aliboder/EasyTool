//! 进程级共享状态（不依赖 Tauri，便于测试）

use super::db::{now_ms, Db};
use super::store::FileStore;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicIsize, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;

pub struct AppState {
    /// rusqlite::Connection 非 Sync，用 Mutex 串行化访问
    pub db: Mutex<Db>,
    pub store: FileStore,
    /// 历史上限（来自 config，运行时可变）
    pub max_items: AtomicU64,
    /// 自身写入剪贴板标志（监听侧据此忽略）
    pub self_write: AtomicBool,
    /// 最近一次自身写入时间（Unix 毫秒），配合守卫窗口
    pub last_self_write_ms: AtomicI64,
    /// 唤起弹出窗前的前台窗口句柄（HWND，0 表示无）
    pub prev_foreground: AtomicIsize,
    /// 唤起前台窗口内的焦点控件句柄（HWND，0 表示无）
    pub prev_focus: AtomicIsize,
    /// 焦点控件内选中的起始/结束位置（EM_GETSEL），用于恢复输入状态
    pub prev_sel_start: AtomicU32,
    pub prev_sel_end: AtomicU32,
}

impl AppState {
    pub fn new(
        data_dir: PathBuf,
        db_path: PathBuf,
        max_items: u64,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let store = FileStore::new(data_dir)?;
        let db = Db::open(db_path.to_str().unwrap_or(":memory:"))?;
        Ok(Self {
            db: Mutex::new(db),
            store,
            max_items: AtomicU64::new(max_items),
            self_write: AtomicBool::new(false),
            last_self_write_ms: AtomicI64::new(0),
            prev_foreground: AtomicIsize::new(0),
            prev_focus: AtomicIsize::new(0),
            prev_sel_start: AtomicU32::new(0),
            prev_sel_end: AtomicU32::new(0),
        })
    }

    /// 标记一次自身剪贴板写入（粘贴时调用）
    pub fn mark_self_write(&self) {
        self.self_write.store(true, Ordering::SeqCst);
        self.last_self_write_ms.store(now_ms(), Ordering::SeqCst);
    }
}
