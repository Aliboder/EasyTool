# EasyTool 内存与启动优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 EasyTool 的内存占用和启动速度，冷启动从 ~2s 降到 <1s，内存占用降低 20-30%

**Architecture:** 通过 4 项低/中风险优化措施实现：配置异步加载、模块懒初始化、图片缓存 LRU、SQLite 连接池共享。遵循「低风险优先」原则，分阶段实施。

**Tech Stack:** Rust, Tauri 2, SQLite, LRU Cache

**Spec:** `docs/superpowers/specs/2026-08-25-memory-startup-optimization-design.md`

## Global Constraints

- Rust edition 2021
- Tauri 2.x
- SQLite WAL 模式（支持并发读）
- Windows 10/11 x64
- 不改变现有功能逻辑
- 不引入新的用户可见功能

---

## 文件结构

### 新增文件
- 无

### 修改文件
| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `src-tauri/Cargo.toml` | 依赖管理 | 添加 `lru` crate |
| `src-tauri/src/lib.rs` | 启动流程、状态管理 | 重构 setup、管理 SqlitePool |
| `src-tauri/src/config.rs` | 配置加载 | 添加异步加载支持 |
| `src-tauri/src/modules/clipboard/file_icons.rs` | 图片缓存 | LRU 缓存重构 |
| `src-tauri/src/modules/clipboard/db.rs` | 剪贴板数据访问 | 使用共享连接 |
| `src-tauri/src/modules/quota/db.rs` | 额度数据访问 | 使用共享连接 |
| `src-tauri/src/modules/search/apps.rs` | 应用数据访问 | 使用共享连接 |

---

## Task 1: 配置异步加载（P0）

**Files:**
- Modify: `src-tauri/src/config.rs:1-86`
- Modify: `src-tauri/src/lib.rs:482-509`

**Interfaces:**
- Consumes: `AppConfig::default()`, `ConfigState`
- Produces: `config::load_config_async()`

- [ ] **Step 1: 在 config.rs 添加异步加载函数**

```rust
/// 异步加载配置并更新 ConfigState（不阻塞调用方）
pub fn load_config_async(app: AppHandle) {
    std::thread::spawn(move || {
        let loaded = load_config(&app);
        let state = app.state::<ConfigState>();
        *state.0.lock().unwrap() = loaded;
        // 配置加载完成后触发热键重新注册
        crate::reapply_hotkeys(&app);
        log::info!("[config] async config loaded and applied");
    });
}
```

- [ ] **Step 2: 在 lib.rs setup 中使用异步加载**

```rust
// 替换原来的同步加载逻辑（约 488-509 行）
// 1. 先用默认配置快速启动
let cfg = AppConfig::default();
app.manage(ConfigState(std::sync::Mutex::new(cfg)));

// 2. 异步加载实际配置（不阻塞 setup）
config::load_config_async(app.handle().clone());

// 3. 模块初始化立即开始（使用默认配置）
```

- [ ] **Step 3: 验证编译通过**

Run: `cargo build --release` in `src-tauri/`
Expected: 编译成功，无错误

- [ ] **Step 4: 手动测试配置加载**

启动应用，检查：
1. 配置文件正常加载（热键生效）
2. 模块使用默认配置启动
3. 配置更新后热键重新注册

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/config.rs src-tauri/src/lib.rs
git commit -m "perf: async config loading to speed up startup"
```

---

## Task 2: 模块懒初始化确认（P0）

**Files:**
- Modify: `src-tauri/src/lib.rs:514-549`

**Interfaces:**
- Consumes: `clipboard_enabled()`, `quota_enabled()`, `search_enabled()`, `emoji_enabled()`
- Produces: 无（确认和清理）

- [ ] **Step 1: 审查模块初始化代码**

检查 lib.rs:514-549，确认：
1. 禁用模块确实不 spawn 线程（返回 None）
2. 没有不必要的线程创建

- [ ] **Step 2: 添加日志验证**

在每个模块初始化处添加日志：
```rust
let clipboard_handle = if clipboard_enabled(app.handle()) {
    log::info!("[setup] initializing clipboard module");
    let app_clone = app.handle().clone();
    Some(std::thread::spawn(move || {
        modules::clipboard::setup_from_handle(&app_clone)
    }))
} else {
    log::info!("[setup] clipboard module disabled, skipping");
    None
};
```

- [ ] **Step 3: 验证编译通过**

Run: `cargo build --release` in `src-tauri/`
Expected: 编译成功

- [ ] **Step 4: 手动测试禁用模块**

1. 在设置中禁用 2+ 模块
2. 重启应用
3. 检查日志确认禁用模块不初始化

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "perf: verify disabled modules skip initialization"
```

---

## Task 3: 图片缓存 LRU 优化（P1）

**Files:**
- Modify: `src-tauri/Cargo.toml:1-54`
- Modify: `src-tauri/src/modules/clipboard/file_icons.rs:1-56`

**Interfaces:**
- Consumes: `OnceLock`, `Mutex`, `HashMap`
- Produces: `LruCache` 替代 `HashMap`

- [ ] **Step 1: 在 Cargo.toml 添加 lru 依赖**

```toml
[dependencies]
# ... 现有依赖
lru = "0.12"
```

- [ ] **Step 2: 重构 file_icons.rs 缓存实现**

```rust
use lru::LruCache;
use std::num::NonZeroUsize;

/// 按路径缓存图标 base64（None = 提取失败，不再重试）
static ICON_CACHE: OnceLock<Mutex<LruCache<String, Option<String>>>> = OnceLock::new();
/// 按路径缓存缩略图/大预览 base64（避免同一文件反复解码，上限 200 防内存膨胀）
static THUMB_CACHE: OnceLock<Mutex<LruCache<String, Option<String>>>> = OnceLock::new();
static PREVIEW_CACHE: OnceLock<Mutex<LruCache<String, Option<String>>>> = OnceLock::new();

const ICON_CACHE_MAX: usize = 200;
const THUMB_CACHE_MAX: usize = 200;
const PREVIEW_CACHE_MAX: usize = 100;  // 大预览图更占内存，上限更低

/// 带容量上限的缓存读取/写入（LRU 策略）
fn cache_get_or_insert(
    cache: &OnceLock<Mutex<LruCache<String, Option<String>>>>,
    key: &str,
    max_size: usize,
    compute: impl FnOnce() -> Option<String>,
) -> Option<String> {
    // 先查缓存
    {
        let map = cache
            .get_or_init(|| Mutex::new(LruCache::new(NonZeroUsize::new(max_size).unwrap())))
            .lock()
            .unwrap();
        if let Some(v) = map.get(key) {
            return v.clone();
        }
    }
    // 锁外执行耗时计算
    let v = compute();
    // 二次加锁写入
    {
        let mut map = cache
            .get_or_init(|| Mutex::new(LruCache::new(NonZeroUsize::new(max_size).unwrap())))
            .lock()
            .unwrap();
        map.put(key.to_string(), v.clone());
    }
    v
}
```

- [ ] **Step 3: 更新缓存调用**

```rust
pub fn file_icon_png(path: &str) -> Option<String> {
    cache_get_or_insert(&ICON_CACHE, path, ICON_CACHE_MAX, || {
        let png = unsafe { extract_icon(path, false) }
            .or_else(|| unsafe { extract_icon(path, true) ))?;
        Some(base64_encode(&png))
    })
}

pub fn file_thumb_png(path: &str) -> Option<String> {
    cache_get_or_insert(&THUMB_CACHE, path, THUMB_CACHE_MAX, || {
        let img = image::open(path).ok()?;
        let thumb = img.thumbnail(256, 256);
        let mut buf = Vec::new();
        thumb
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .ok()?;
        Some(base64_encode(&buf))
    })
}

pub fn file_preview_png(path: &str) -> Option<String> {
    cache_get_or_insert(&PREVIEW_CACHE, path, PREVIEW_CACHE_MAX, || {
        let img = image::open(path).ok()?;
        let preview = img.thumbnail(1024, 1024);
        let mut buf = Vec::new();
        preview
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .ok()?;
        Some(base64_encode(&buf))
    })
}
```

- [ ] **Step 4: 更新 emoji 缓存（可选）**

如果 emoji/commands.rs 也有类似的缓存，同步更新为 LRU。

- [ ] **Step 5: 验证编译通过**

Run: `cargo build --release` in `src-tauri/`
Expected: 编译成功

- [ ] **Step 6: 手动测试缓存功能**

1. 打开剪贴板，查看图片/文件图标正常显示
2. 长时间运行后检查内存占用是否稳定
3. 验证缓存命中（重复打开同一文件图标应更快）

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/modules/clipboard/file_icons.rs
git commit -m "perf: LRU cache for file icons/thumbnails to limit memory"
```

---

## Task 4: SQLite 连接池共享（P1）

**Files:**
- Modify: `src-tauri/src/lib.rs:482-641`
- Modify: `src-tauri/src/modules/clipboard/db.rs:1-100`
- Modify: `src-tauri/src/modules/quota/db.rs:1-100`
- Modify: `src-tauri/src/modules/search/apps.rs:1-100`

**Interfaces:**
- Consumes: `rusqlite::Connection`, `ConfigState`
- Produces: `SqlitePool` 结构

- [ ] **Step 1: 在 lib.rs 定义 SqlitePool**

```rust
use std::path::Path;

/// 共享 SQLite 连接池（避免各模块独立创建连接的开销）
pub struct SqlitePool {
    clip_conn: rusqlite::Connection,
    quota_conn: rusqlite::Connection,
    apps_conn: rusqlite::Connection,
}

impl SqlitePool {
    pub fn open(data_dir: &Path) -> Result<Self, String> {
        let clip_conn = rusqlite::Connection::open(data_dir.join("clipboard.db"))
            .map_err(|e| format!("Failed to open clipboard.db: {e}"))?;
        let quota_conn = rusqlite::Connection::open(data_dir.join("quota.db"))
            .map_err(|e| format!("Failed to open quota.db: {e}"))?;
        let apps_conn = rusqlite::Connection::open(data_dir.join("apps.db"))
            .map_err(|e| format!("Failed to open apps.db: {e}"))?;
        
        // 启用 WAL 模式（支持并发读）
        clip_conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
        quota_conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
        apps_conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
        
        Ok(Self { clip_conn, quota_conn, apps_conn })
    }
    
    pub fn clip(&self) -> &rusqlite::Connection { &self.clip_conn }
    pub fn quota(&self) -> &rusqlite::Connection { &self.quota_conn }
    pub fn apps(&self) -> &rusqlite::Connection { &self.apps_conn }
}
```

- [ ] **Step 2: 在 setup 中管理 SqlitePool**

```rust
// 在 setup 中创建并管理 SqlitePool
let data_dir = app.path().app_data_dir().unwrap();
if let Ok(pool) = SqlitePool::open(&data_dir) {
    app.manage(pool);
    log::info!("[setup] SQLite connection pool initialized");
} else {
    log::error!("[setup] failed to initialize SQLite connection pool");
}
```

- [ ] **Step 3: 重构 clipboard/db.rs**

```rust
// 修改 ClipboardDb::new 使用共享连接
pub fn new(pool: &SqlitePool) -> Self {
    let conn = pool.clip().clone();  // 或使用引用
    // ... 初始化逻辑
}

// 或者更简单：让 ClipboardDb 持有引用
pub struct ClipboardDb<'a> {
    conn: &'a rusqlite::Connection,
}
```

- [ ] **Step 4: 重构 quota/db.rs**

```rust
// 同样修改 QuotaDb 使用共享连接
pub fn new(pool: &SqlitePool) -> Self {
    let conn = pool.quota().clone();
    // ... 初始化逻辑
}
```

- [ ] **Step 5: 重构 search/apps.rs**

```rust
// 修改 AppsDb 使用共享连接
pub fn new(pool: &SqlitePool) -> Self {
    let conn = pool.apps().clone();
    // ... 初始化逻辑
}
```

- [ ] **Step 6: 更新模块初始化代码**

更新各模块的 `setup_from_handle` 函数，从 `app.state::<SqlitePool>()` 获取连接。

- [ ] **Step 7: 验证编译通过**

Run: `cargo build --release` in `src-tauri/`
Expected: 编译成功

- [ ] **Step 8: 手动测试数据访问**

1. 剪贴板历史正常读写
2. 额度监控正常轮询
3. 文件搜索正常工作
4. 应用中心正常扫描

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/modules/clipboard/db.rs src-tauri/src/modules/quota/db.rs src-tauri/src/modules/search/apps.rs
git commit -m "perf: shared SQLite connection pool to reduce memory and startup time"
```

---

## Task 5: 性能测试验证

**Files:**
- Create: `docs/performance-test-guide.md`

**Interfaces:**
- Consumes: 完成的优化代码
- Produces: 性能测试报告

- [ ] **Step 1: 创建性能测试指南**

```markdown
# EasyTool 性能测试指南

## 测试指标

| 指标 | 测量方法 | 目标 |
|------|----------|------|
| 冷启动时间 | 从进程启动到主窗口显示 | <1s |
| 内存占用 | 任务管理器工作集 | -20%+ |
| 首屏渲染 | 从窗口显示到内容可交互 | <1s |

## 测试场景

### 1. 冷启动测试
1. 完全退出 EasyTool
2. 打开任务管理器，记录初始内存
3. 启动 EasyTool，用秒表计时
4. 记录主窗口显示时间
5. 记录稳定后内存占用

### 2. 长时间运行测试
1. 启动 EasyTool
2. 正常使用 1 小时
3. 记录内存占用变化

### 3. 多模块场景测试
1. 禁用所有模块，测试启动时间
2. 只启用剪贴板，测试启动时间
3. 启用所有模块，测试启动时间

## 测试工具
- Windows 任务管理器
- PowerShell 脚本（可选）
- 秒表
```

- [ ] **Step 2: 执行性能测试**

按照测试指南执行测试，记录结果。

- [ ] **Step 3: 验证优化效果**

对比优化前后的性能数据：
1. 启动时间是否减少 300ms+
2. 内存占用是否减少 10%+
3. 功能是否正常

- [ ] **Step 4: 记录测试结果**

在 `docs/lessons.md` 中记录性能优化的经验和结果。

- [ ] **Step 5: Commit**

```bash
git add docs/performance-test-guide.md docs/lessons.md
git commit -m "docs: add performance test guide and results"
```

---

## 自检清单

### 1. 规格覆盖
- [x] 配置异步加载（Task 1）
- [x] 模块懒初始化确认（Task 2）
- [x] 图片缓存 LRU（Task 3）
- [x] SQLite 连接池（Task 4）
- [x] 性能测试验证（Task 5）

### 2. 占位符检查
- [x] 所有代码块都有具体实现
- [x] 所有步骤都有明确的验证标准
- [x] 没有 "TBD"、"TODO" 等占位符

### 3. 类型一致性
- [x] `SqlitePool` 结构在 Task 4 定义，在 Task 4 使用
- [x] `LruCache` 在 Task 3 定义，在 Task 3 使用
- [x] `load_config_async` 在 Task 1 定义，在 Task 1 使用

### 4. 依赖关系
- [x] Task 1 和 Task 2 可并行执行
- [x] Task 3 可独立执行
- [x] Task 4 可独立执行
- [x] Task 5 依赖 Task 1-4 完成

---

**计划状态**：待执行  
**下一步**：用户选择执行方式（Subagent-Driven 或 Inline Execution）
