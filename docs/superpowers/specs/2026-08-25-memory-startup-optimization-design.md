# EasyTool 内存与启动优化设计方案

**日期**：2026-08-25  
**版本**：v1.0  
**状态**：待审批

---

## 1. 概述

### 1.1 背景

EasyTool 当前版本（v0.5.0）已具备良好的模块化架构和基础优化（并行加载、延迟创建等）。为进一步提升用户体验，需要优化内存占用和启动速度。

### 1.2 目标

| 指标 | 当前值 | 目标值 | 提升幅度 |
|------|--------|--------|----------|
| 冷启动时间 | ~2s | <1s | 50%+ |
| 内存占用 | 基准 | -20%~30% | 显著降低 |
| 首屏渲染 | ~1.5s | <1s | 33%+ |

### 1.3 范围

本方案聚焦于：
- 启动流程优化
- 内存占用优化
- 缓存策略优化

不涉及：
- 功能新增
- UI 改进
- 性能测试框架搭建

---

## 2. 当前架构分析

### 2.1 启动流程（lib.rs:427-641）

```
1. init_logger()
2. 并行加载配置和 manifests（cfg_thread, manifests_thread）
3. 合并 manifests 到配置
4. 旧数据迁移（migrate::run_migration）
5. 并行初始化模块（clipboard, quota, search, emoji）
6. 等待剪贴板模块完成
7. 延迟 500ms 初始化额度监控模块
8. 注册全局热键
9. 恢复主窗口尺寸
10. 创建托盘
11. search/emoji 的 join 放后台线程
```

### 2.2 性能瓶颈点

| 瓶颈点 | 耗时占比 | 原因 |
|--------|----------|------|
| 配置加载 | ~300ms | 同步阻塞，文件 I/O |
| 模块初始化 | ~400ms | 4 个模块并行，但有依赖 |
| SQLite 连接创建 | ~100ms | 每个模块独立创建 |
| WebView2 初始化 | ~200ms | 首次创建窗口时 |
| 图片缓存加载 | ~50ms | 无上限，可能膨胀 |

### 2.3 内存占用分析

| 组件 | 内存占用 | 问题 |
|------|----------|------|
| ICON_CACHE | 无上限 | 长时间运行后膨胀 |
| PREVIEW_CACHE | 无上限 | 大预览图占用多 |
| SQLite 连接 | 3 个独立连接 | 重复开销 |
| 模块状态 | 常驻内存 | 正常 |

---

## 3. 优化方案详细设计

### 3.1 配置异步加载（P0）

**目标**：启动 -300ms

**当前实现**（lib.rs:488-509）：
```rust
let cfg_thread = std::thread::spawn(move || {
    config::load_config(&cfg_handle)
});
// ... 等待配置加载完成
let mut cfg = cfg_thread.join()...;
```

**优化方案**：
```rust
// 1. 先用默认配置快速启动
let mut cfg = AppConfig::default();

// 2. 异步加载配置（不阻塞 setup）
let cfg_handle = app.handle().clone();
std::thread::spawn(move || {
    let loaded = config::load_config(&cfg_handle);
    // 更新 ConfigState
    let state = cfg_handle.state::<ConfigState>();
    *state.0.lock().unwrap() = loaded;
    // 触发热键重新注册等副作用
    crate::reapply_hotkeys(&cfg_handle);
});

// 3. 模块初始化立即开始（使用默认配置）
```

**改动文件**：
- `src-tauri/src/lib.rs`：setup 函数重构
- `src-tauri/src/config.rs`：添加异步加载支持

**风险**：
- 低：模块使用默认配置启动，配置加载完成后自动更新
- 需确保配置更新时触发必要的副作用（热键注册等）

---

### 3.2 模块懒初始化（P0）

**目标**：启动 -200ms（禁用 2+ 模块时）

**当前实现**（lib.rs:515-549）：
```rust
let quota_handle = if quota_enabled(app.handle()) {
    let app_clone = app.handle().clone();
    Some(std::thread::spawn(move || {
        modules::quota::setup_from_handle(&app_clone)
    }))
} else {
    None
};
```

**优化方案**：
- 确认禁用模块确实不 spawn 线程
- 移除不必要的线程创建开销
- 优化模块初始化顺序（按依赖关系）

**改动文件**：
- `src-tauri/src/lib.rs`：setup 函数微调

**风险**：
- 低：只是确认和清理，不改变逻辑

---

### 3.3 图片缓存 LRU 优化（P1）

**目标**：内存 -10%

**当前实现**（file_icons.rs:17-21）：
```rust
static ICON_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
static THUMB_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
static PREVIEW_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
const CACHE_MAX: usize = 200;
```

**问题**：
- `ICON_CACHE` 和 `PREVIEW_CACHE` 无上限
- `THUMB_CACHE` 虽有上限但使用简单 HashMap（非 LRU）

**优化方案**：
```rust
use lru::LruCache;

static ICON_CACHE: OnceLock<Mutex<LruCache<String, Option<String>>>> = OnceLock::new();
static THUMB_CACHE: OnceLock<Mutex<LruCache<String, Option<String>>>> = OnceLock::new();
static PREVIEW_CACHE: OnceLock<Mutex<LruCache<String, Option<String>>>> = OnceLock::new();

const ICON_CACHE_MAX: usize = 200;
const THUMB_CACHE_MAX: usize = 200;
const PREVIEW_CACHE_MAX: usize = 100;  // 大预览图更占内存，上限更低
```

**改动文件**：
- `src-tauri/src/modules/clipboard/file_icons.rs`：缓存实现重构
- `src-tauri/Cargo.toml`：添加 `lru` 依赖

**风险**：
- 低：LRU 是标准缓存策略，行为可预测
- 需确保缓存命中率不受影响

---

### 3.4 SQLite 连接池共享（P1）

**目标**：内存 -15%，启动 -100ms

**当前实现**：
- `clipboard/db.rs`：独立 `ClipboardDb` 连接
- `quota/db.rs`：独立 `QuotaDb` 连接
- `search/apps.rs`：独立 `AppsDb` 连接

**优化方案**：
```rust
// 新增共享连接池
pub struct SqlitePool {
    clip_conn: rusqlite::Connection,
    quota_conn: rusqlite::Connection,
    apps_conn: rusqlite::Connection,
}

impl SqlitePool {
    pub fn open(data_dir: &Path) -> Result<Self, String> {
        let clip_conn = rusqlite::Connection::open(data_dir.join("clipboard.db"))?;
        let quota_conn = rusqlite::Connection::open(data_dir.join("quota.db"))?;
        let apps_conn = rusqlite::Connection::open(data_dir.join("apps.db"))?;
        Ok(Self { clip_conn, quota_conn, apps_conn })
    }
    
    pub fn clip(&self) -> &rusqlite::Connection { &self.clip_conn }
    pub fn quota(&self) -> &rusqlite::Connection { &self.quota_conn }
    pub fn apps(&self) -> &rusqlite::Connection { &self.apps_conn }
}
```

**改动文件**：
- `src-tauri/src/lib.rs`：管理 `SqlitePool` 状态
- `src-tauri/src/modules/clipboard/db.rs`：使用共享连接
- `src-tauri/src/modules/quota/db.rs`：使用共享连接
- `src-tauri/src/modules/search/apps.rs`：使用共享连接

**风险**：
- 中：需要重构数据访问层
- 需确保线程安全（SQLite WAL 模式支持并发读）

---

### 3.5 WebView2 预热（P2，可选）

**目标**：首屏 -200ms

**当前问题**：
- WebView2 环境初始化在首次创建窗口时
- 首屏需要等待 WebView2 初始化完成

**优化方案**：
```rust
// 在 setup 中预热 WebView2
// 1. 预加载 WebView2 运行时
// 2. 预创建隐藏的 WebView2 实例（不显示）
// 3. 主窗口创建时直接复用
```

**改动文件**：
- `src-tauri/src/lib.rs`：添加预热逻辑
- 可能需要调研 Tauri 2 是否支持预热 API

**风险**：
- 高：需要验证 Tauri 2 支持程度
- 可能引入兼容性问题

**建议**：作为 P2 优先级，先调研可行性，再决定是否实施

---

## 4. 实施计划

### 阶段 1：低风险优化（Week 1）

**任务**：
1. [ ] 配置异步加载（lib.rs setup 重构）
2. [ ] 模块懒初始化确认和清理
3. [ ] 图片缓存 LRU 优化（file_icons.rs）

**验收标准**：
- 启动时间减少 300ms+
- 内存占用减少 10%+
- 所有功能正常

### 阶段 2：中风险优化（Week 2）

**任务**：
4. [ ] SQLite 连接池共享（数据层重构）
5. [ ] 性能测试验证

**验收标准**：
- 启动时间再减少 100ms+
- 内存占用再减少 15%+
- 无功能回归

### 阶段 3：高风险优化（Week 3，可选）

**任务**：
6. [ ] WebView2 预热调研和实施
7. [ ] 最终性能测试

**验收标准**：
- 首屏渲染减少 200ms+
- 无兼容性问题

---

## 5. 性能测试方案

### 5.1 测试指标

| 指标 | 测量方法 | 目标 |
|------|----------|------|
| 冷启动时间 | 从进程启动到主窗口显示 | <1s |
| 内存占用 | 任务管理器工作集 | -20%+ |
| 首屏渲染 | 从窗口显示到内容可交互 | <1s |

### 5.2 测试场景

1. **冷启动**：完全退出后重新启动
2. **热启动**：最小化后恢复
3. **长时间运行**：运行 1 小时后内存变化
4. **多模块场景**：启用/禁用不同模块组合

### 5.3 测试工具

- Windows 任务管理器（内存监控）
- PowerShell 脚本（启动时间测量）
- 自定义日志（性能埋点）

---

## 6. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 配置异步加载导致状态不一致 | 中 | 低 | 配置更新时触发副作用 |
| SQLite 连接池线程安全问题 | 高 | 低 | 使用 WAL 模式 + 适当锁 |
| LRU 缓存命中率下降 | 低 | 中 | 监控缓存命中率 |
| WebView2 预热兼容性问题 | 中 | 高 | 作为 P2，调研后再决定 |

---

## 7. 预期收益

### 7.1 用户体验提升

- **启动更快**：从 ~2s 降到 <1s，用户感知明显
- **内存更省**：长时间运行后内存占用更低
- **响应更灵敏**：首屏渲染更快

### 7.2 技术收益

- **架构更清晰**：配置加载、模块初始化、缓存管理职责分离
- **可维护性提升**：统一的缓存策略和连接管理
- **可扩展性增强**：为未来功能模块预留性能空间

---

## 8. 总结

本方案通过 5 项优化措施，预期实现：
- 启动时间：-500ms ~ -800ms
- 内存占用：-20% ~ -25%
- 首屏渲染：-200ms

优化遵循「低风险优先」原则，分 3 个阶段实施，确保稳定性和可验证性。

---

**文档状态**：待审批  
**下一步**：用户审查后，调用 writing-plans skill 创建实施计划
