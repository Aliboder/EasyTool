# EasyTool 性能优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全面提升 EasyTool 性能，包括启动速度、内存占用、响应速度和包体积

**Architecture:** 分四个阶段实施：启动优化、内存优化、响应优化、包体积优化。每个阶段独立可测试，逐步提升性能。

**Tech Stack:** Tauri 2 + Rust + React 19 + TypeScript + SQLite + @tanstack/react-virtual + lru + r2d2

**Spec:** `docs/superpowers/specs/2026-08-19-performance-optimization-design.md`

## Global Constraints

- Tauri 2 框架，Rust 后端 + React 前端
- SQLite 数据库（WAL 模式）
- Windows 平台，WebView2 渲染
- 现有功能不能受影响
- 每个优化阶段独立提交，便于回滚

---

## 文件结构

### 后端文件
- `src-tauri/src/lib.rs` - 主入口，模块初始化
- `src-tauri/src/modules/clipboard/db.rs` - 数据库操作
- `src-tauri/src/modules/clipboard/store.rs` - 文件存储
- `src-tauri/src/modules/clipboard/monitor.rs` - 剪贴板监听
- `src-tauri/src/modules/quota/mod.rs` - 额度监控模块
- `src-tauri/Cargo.toml` - 依赖配置

### 前端文件
- `src/App.tsx` - 主应用组件
- `src/modules/clipboard/Clippage.tsx` - 剪贴板页面
- `src/modules/quota/QuotaPage.tsx` - 额度监控页面
- `src/components/` - UI 组件

---

## 阶段1：启动优化

### Task 1.1: 模块并行初始化

**Files:**
- Modify: `src-tauri/src/lib.rs:317-365`

**Interfaces:**
- Consumes: `clipboard::setup()`, `quota::setup()`
- Produces: 并行初始化逻辑

- [ ] **Step 1: 分析当前初始化流程**

读取 `src-tauri/src/lib.rs` 第 317-365 行，理解当前串行初始化逻辑。

- [ ] **Step 2: 实现并行初始化**

```rust
// 在 setup 闭包中，将串行初始化改为并行
// 使用 std::thread::spawn 并行执行模块初始化
let clipboard_handle = if clipboard_enabled(app.handle()) {
    let app_clone = app.handle().clone();
    Some(std::thread::spawn(move || {
        modules::clipboard::setup_from_handle(&app_clone)
    }))
} else {
    None
};

let quota_handle = if quota_enabled(app.handle()) {
    let app_clone = app.handle().clone();
    Some(std::thread::spawn(move || {
        modules::quota::setup_from_handle(&app_clone)
    }))
} else {
    None
};

// 等待初始化完成
if let Some(handle) = clipboard_handle {
    handle.join().unwrap_or_else(|e| {
        log::error!("clipboard init failed: {:?}", e);
    });
}
if let Some(handle) = quota_handle {
    handle.join().unwrap_or_else(|e| {
        log::error!("quota init failed: {:?}", e);
    });
}
```

- [ ] **Step 3: 修改模块 setup 函数**

需要为每个模块添加 `setup_from_handle` 函数，接受 `AppHandle` 参数：

```rust
// 在 modules/clipboard/mod.rs 中添加
pub fn setup_from_handle(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 复用现有 setup 逻辑
    Ok(())
}

// 在 modules/quota/mod.rs 中添加
pub fn setup_from_handle(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 复用现有 setup 逻辑
    Ok(())
}
```

- [ ] **Step 4: 测试并行初始化**

运行 `npm run tauri dev`，验证应用正常启动，模块功能正常。

- [ ] **Step 5: 提交代码**

```bash
git add src-tauri/src/lib.rs src-tauri/src/modules/clipboard/mod.rs src-tauri/src/modules/quota/mod.rs
git commit -m "feat: parallel module initialization for faster startup"
```

### Task 1.2: 延迟加载非关键模块

**Files:**
- Modify: `src-tauri/src/lib.rs:327-365`

**Interfaces:**
- Consumes: `quota_enabled()`, `quota::setup()`
- Produces: 延迟加载逻辑

- [ ] **Step 1: 分析模块使用频率**

剪贴板：用户可能立即使用，需要立即初始化
额度监控：后台轮询，可以延迟初始化

- [ ] **Step 2: 实现延迟加载**

```rust
// 在 setup 闭包中，额度监控延迟 500ms 初始化
if quota_enabled(app.handle()) {
    let app_clone = app.handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if let Err(e) = modules::quota::setup_from_handle(&app_clone) {
            log::error!("quota delayed init failed: {e}");
        }
    });
}
```

- [ ] **Step 3: 添加加载状态提示**

在前端添加加载状态提示，让用户知道模块正在初始化。

- [ ] **Step 4: 测试延迟加载**

运行 `npm run tauri dev`，验证额度监控模块延迟加载正常。

- [ ] **Step 5: 提交代码**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: delayed initialization for non-critical modules"
```

### Task 1.3: 预加载关键资源

**Files:**
- Modify: `src-tauri/src/lib.rs:317-370`

**Interfaces:**
- Consumes: `load_config()`, `reapply_hotkeys()`
- Produces: 并行预加载逻辑

- [ ] **Step 1: 分析预加载流程**

当前流程：load_config → merge_manifests → save_config → reapply_hotkeys

- [ ] **Step 2: 实现并行预加载**

```rust
// 将配置加载和热键注册并行执行
let (config, _) = tokio::join!(
    async { 
        let mut cfg = config::load_config(app.handle());
        let manifests = modules::load_manifests(app.handle());
        modules::merge_manifests(&mut cfg, &manifests);
        let _ = config::save_config(app.handle(), &cfg);
        cfg
    },
    async { 
        reapply_hotkeys(app.handle());
        apply_main_window_mode(app.handle());
    }
);
```

- [ ] **Step 3: 测试预加载**

运行 `npm run tauri dev`，验证配置和热键正常加载。

- [ ] **Step 4: 提交代码**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: parallel preloading of config and hotkeys"
```

---

## 阶段2：内存优化

### Task 2.1: 图片懒加载

**Files:**
- Create: `src/components/LazyImage.tsx`
- Modify: `src/modules/clipboard/Clippage.tsx`

**Interfaces:**
- Consumes: IntersectionObserver API
- Produces: LazyImage 组件

- [ ] **Step 1: 创建 LazyImage 组件**

```tsx
// src/components/LazyImage.tsx
import { useEffect, useRef, useState } from 'react';

interface LazyImageProps {
  src: string;
  alt?: string;
  className?: string;
}

export function LazyImage({ src, alt, className }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLoaded(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {loaded && !error && (
        <img
          src={src}
          alt={alt}
          onError={() => setError(true)}
          className="w-full h-full object-cover"
        />
      )}
      {loaded && error && (
        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
          加载失败
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 在 Clippage 中使用 LazyImage**

```tsx
// 在 src/modules/clipboard/Clippage.tsx 中替换 img 标签
import { LazyImage } from '@/components/LazyImage';

// 替换原来的 img 标签
<LazyImage
  src={`asset://localhost/${thumbPath}`}
  alt="缩略图"
  className="size-full"
/>
```

- [ ] **Step 3: 测试懒加载**

运行 `npm run tauri dev`，验证图片懒加载正常工作。

- [ ] **Step 4: 提交代码**

```bash
git add src/components/LazyImage.tsx src/modules/clipboard/Clippage.tsx
git commit -m "feat: lazy loading for clipboard images"
```

### Task 2.2: 实现 LRU 缓存

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/modules/clipboard/cache.rs`
- Modify: `src-tauri/src/modules/clipboard/mod.rs`
- Modify: `src-tauri/src/modules/clipboard/store.rs`

**Interfaces:**
- Consumes: `lru` crate
- Produces: ImageCache 结构体

- [ ] **Step 1: 添加 lru 依赖**

```toml
# src-tauri/Cargo.toml
[dependencies]
lru = "0.12"
```

- [ ] **Step 2: 创建缓存模块**

```rust
// src-tauri/src/modules/clipboard/cache.rs
use lru::LruCache;
use std::sync::Mutex;

pub struct ImageCache {
    cache: Mutex<LruCache<String, Vec<u8>>>,
}

impl ImageCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            cache: Mutex::new(LruCache::new(capacity)),
        }
    }

    pub fn get_or_load(&self, path: &str) -> Option<Vec<u8>> {
        let mut cache = self.cache.lock().unwrap();
        
        // 检查缓存
        if let Some(data) = cache.get(path) {
            return Some(data.clone());
        }
        
        // 加载文件
        let data = std::fs::read(path).ok()?;
        cache.put(path.to_string(), data.clone());
        Some(data)
    }

    pub fn clear(&self) {
        self.cache.lock().unwrap().clear();
    }
}
```

- [ ] **Step 3: 在模块中集成缓存**

```rust
// 在 modules/clipboard/mod.rs 中添加
use cache::ImageCache;
use std::sync::OnceLock;

static IMAGE_CACHE: OnceLock<ImageCache> = OnceLock::new();

pub fn get_image_cache() -> &'static ImageCache {
    IMAGE_CACHE.get_or_init(|| ImageCache::new(100)) // 缓存100张图片
}
```

- [ ] **Step 4: 在 store 中使用缓存**

```rust
// 在 modules/clipboard/store.rs 中修改图片加载逻辑
pub fn load_thumb(&self, id: i64) -> Option<Vec<u8>> {
    let path = self.thumb_path(id)?;
    get_image_cache().get_or_load(&path.to_string_lossy())
}
```

- [ ] **Step 5: 测试缓存功能**

运行 `npm run tauri dev`，验证图片缓存正常工作，重复加载相同图片时速度提升。

- [ ] **Step 6: 提交代码**

```bash
git add src-tauri/Cargo.toml src-tauri/src/modules/clipboard/cache.rs src-tauri/src/modules/clipboard/mod.rs src-tauri/src/modules/clipboard/store.rs
git commit -m "feat: LRU cache for clipboard images"
```

### Task 2.3: 数据库连接池优化

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/modules/clipboard/db.rs`

**Interfaces:**
- Consumes: `r2d2` crate
- Produces: 连接池优化

- [ ] **Step 1: 添加 r2d2 依赖**

```toml
# src-tauri/Cargo.toml
[dependencies]
r2d2 = "0.8"
r2d2_sqlite = "0.22"
```

- [ ] **Step 2: 分析当前数据库使用模式**

当前使用 `Mutex<Connection>`，每次操作都获取锁。

- [ ] **Step 3: 评估是否需要连接池**

对于 SQLite，单连接 + WAL 模式通常足够。连接池可能增加复杂度而不带来显著收益。

**决定**：保持现有实现，但优化锁的使用范围。

- [ ] **Step 4: 优化锁的使用**

```rust
// 在 db.rs 中，减小锁的范围
pub fn get_history(&self, limit: i64) -> Result<Vec<Item>, DbError> {
    let db = self.db.lock().unwrap();
    // 只在数据库操作期间持锁
    let items = db.prepare("SELECT * FROM items ORDER BY created_at DESC LIMIT ?")
        .query_map([limit], |row| {
            // ... 映射逻辑
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}
```

- [ ] **Step 5: 测试数据库优化**

运行 `npm run tauri dev`，验证数据库操作正常，性能无退化。

- [ ] **Step 6: 提交代码**

```bash
git add src-tauri/Cargo.toml src-tauri/src/modules/clipboard/db.rs
git commit -m "feat: optimize database lock usage"
```

---

## 阶段3：响应优化

### Task 3.1: 实现虚拟列表

**Files:**
- Modify: `package.json`
- Modify: `src/modules/clipboard/Clippage.tsx`

**Interfaces:**
- Consumes: `@tanstack/react-virtual`
- Produces: 虚拟滚动列表

- [ ] **Step 1: 安装依赖**

```bash
npm install @tanstack/react-virtual
```

- [ ] **Step 2: 实现虚拟列表**

```tsx
// 在 src/modules/clipboard/Clippage.tsx 中
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualClipboardList({ items }: { items: Item[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // 每行高度估算
    overscan: 5, // 预渲染5行
  });

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      style={{ contain: 'strict' }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: virtualRow.size,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <ClipboardItem item={items[virtualRow.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 替换现有列表**

```tsx
// 在 Clippage.tsx 中替换原来的列表渲染
// 将原来的 items.map(...) 替换为
<VirtualClipboardList items={filteredItems} />
```

- [ ] **Step 4: 测试虚拟列表**

运行 `npm run tauri dev`，验证：
1. 大量数据时滚动流畅
2. 搜索功能正常
3. 固定、删除等功能正常

- [ ] **Step 5: 提交代码**

```bash
git add package.json src/modules/clipboard/Clippage.tsx
git commit -m "feat: virtual list for clipboard history"
```

### Task 3.2: 添加查询索引

**Files:**
- Modify: `src-tauri/src/modules/clipboard/db.rs`

**Interfaces:**
- Consumes: SQLite索引语法
- Produces: 数据库索引

- [ ] **Step 1: 分析查询模式**

查看 `db.rs` 中的 SQL 查询，识别常用查询字段。

- [ ] **Step 2: 添加索引**

```rust
// 在 db.rs 的初始化逻辑中添加
pub fn ensure_indexes(&self) -> Result<(), DbError> {
    let db = self.db.lock().unwrap();
    
    // 常用查询索引
    db.execute_batch("
        CREATE INDEX IF NOT EXISTS idx_items_hash ON items(hash);
        CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
        CREATE INDEX IF NOT EXISTS idx_items_pinned ON items(pinned);
        CREATE INDEX IF NOT EXISTS idx_items_pinned_order ON items(pinned, pin_order);
    ")?;
    
    Ok(())
}
```

- [ ] **Step 3: 在初始化时创建索引**

```rust
// 在 modules/clipboard/mod.rs 的 setup 函数中
pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let db = Database::new(&app.path().app_data_dir()?)?;
    db.ensure_indexes()?;
    // ... 其他初始化
}
```

- [ ] **Step 4: 测试索引效果**

运行 `npm run tauri dev`，验证：
1. 查询速度提升
2. 数据库文件大小合理

- [ ] **Step 5: 提交代码**

```bash
git add src-tauri/src/modules/clipboard/db.rs src-tauri/src/modules/clipboard/mod.rs
git commit -m "feat: add database indexes for better query performance"
```

### Task 3.3: 实现防抖处理

**Files:**
- Modify: `src/modules/clipboard/Clippage.tsx`

**Interfaces:**
- Consumes: lodash.debounce
- Produces: 防抖搜索

- [ ] **Step 1: 安装 lodash（如果未安装）**

```bash
npm install lodash
npm install @types/lodash --save-dev
```

- [ ] **Step 2: 实现防抖搜索**

```tsx
// 在 src/modules/clipboard/Clippage.tsx 中
import { debounce } from 'lodash';

function Clippage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  
  const debouncedSearch = useMemo(
    () => debounce((query: string) => {
      setDebouncedQuery(query);
    }, 300),
    []
  );
  
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    debouncedSearch(query);
  };
  
  // 使用 debouncedQuery 进行过滤
  const filteredItems = useMemo(() => {
    if (!debouncedQuery) return items;
    return items.filter(item => 
      item.content?.toLowerCase().includes(debouncedQuery.toLowerCase())
    );
  }, [items, debouncedQuery]);
  
  // 清理防抖函数
  useEffect(() => {
    return () => {
      debouncedSearch.cancel();
    };
  }, [debouncedSearch]);
  
  return (
    <input
      type="text"
      placeholder="搜索..."
      value={searchQuery}
      onChange={handleSearch}
    />
  );
}
```

- [ ] **Step 3: 测试防抖功能**

运行 `npm run tauri dev`，验证：
1. 搜索输入流畅
2. 搜索结果正确
3. 无频繁重新渲染

- [ ] **Step 4: 提交代码**

```bash
git add src/modules/clipboard/Clippage.tsx
git commit -m "feat: debounced search for clipboard history"
```

---

## 阶段4：包体积优化

### Task 4.1: 实现代码分割

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: React.lazy, Suspense
- Produces: 路由级代码分割

- [ ] **Step 1: 分析当前打包结构**

当前所有模块打包在一起，没有代码分割。

- [ ] **Step 2: 实现路由级懒加载**

```tsx
// 在 src/App.tsx 中
import { lazy, Suspense } from 'react';

const ClipboardPage = lazy(() => import('./modules/clipboard/Clippage'));
const QuotaPage = lazy(() => import('./modules/quota/QuotaPage'));

function App() {
  const [active, setActive] = useState<string>('clipboard');
  
  const renderModule = () => {
    switch (active) {
      case 'clipboard':
        return (
          <Suspense fallback={<Loading />}>
            <ClipboardPage popup={false} />
          </Suspense>
        );
      case 'quota':
        return (
          <Suspense fallback={<Loading />}>
            <QuotaPage />
          </Suspense>
        );
      default:
        return <div>未知模块</div>;
    }
  };
  
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <main className="flex-1 overflow-y-auto">
        {renderModule()}
      </main>
      <Sidebar modules={enabledModules} active={active} onSelect={setActive} />
    </div>
  );
}
```

- [ ] **Step 3: 创建 Loading 组件**

```tsx
// 在 src/components/Loading.tsx 中
export function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
```

- [ ] **Step 4: 测试代码分割**

运行 `npm run tauri dev`，验证：
1. 模块切换正常
2. 加载状态显示正确
3. 功能正常

- [ ] **Step 5: 提交代码**

```bash
git add src/App.tsx src/components/Loading.tsx
git commit -m "feat: route-level code splitting for smaller bundles"
```

### Task 4.2: 优化 Tauri 打包配置

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: Cargo profile 配置
- Produces: 优化后的打包配置

- [ ] **Step 1: 分析当前打包配置**

查看 `src-tauri/Cargo.toml` 的 `[profile.release]` 部分。

- [ ] **Step 2: 优化打包配置**

```toml
# src-tauri/Cargo.toml
[profile.release]
opt-level = "s"      # 优化大小
lto = true           # 链接时优化
codegen-units = 1    # 单线程代码生成（更优优化）
strip = true         # 去除调试符号
panic = "abort"      # 终止而非展开
```

- [ ] **Step 3: 测试打包**

```bash
npm run tauri build
```

验证：
1. 打包成功
2. 安装包大小减小
3. 应用正常运行

- [ ] **Step 4: 提交代码**

```bash
git add src-tauri/Cargo.toml
git commit -m "feat: optimize Tauri build for smaller binary size"
```

### Task 4.3: 分析并移除未使用依赖

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: 依赖分析工具
- Produces: 优化后的依赖列表

- [ ] **Step 1: 分析前端依赖**

```bash
npx depcheck
```

- [ ] **Step 2: 分析后端依赖**

```bash
cd src-tauri
cargo machete
```

- [ ] **Step 3: 移除未使用依赖**

根据分析结果，移除未使用的依赖。

- [ ] **Step 4: 测试应用**

运行 `npm run tauri dev`，验证功能正常。

- [ ] **Step 5: 提交代码**

```bash
git add package.json src-tauri/Cargo.toml
git commit -m "chore: remove unused dependencies"
```

---

## 验证计划

### 启动速度验证
1. 清除缓存，测量冷启动时间
2. 目标：< 2秒

### 内存占用验证
1. 启动应用，查看任务管理器
2. 目标：< 100MB

### 响应速度验证
1. 测试搜索、固定、删除等操作
2. 目标：< 100ms

### 包体积验证
1. 查看打包后的安装包大小
2. 目标：< 20MB

---

## 回滚方案

每个任务独立提交，如发现问题：
1. `git revert <commit-hash>`
2. 重新测试
3. 修复后重新提交