# EasyTool 性能优化设计文档

## 1. 目标

全面提升 EasyTool 的性能表现，包括：
- **启动速度**：从点击到可用 < 2秒
- **内存占用**：运行时内存 < 100MB
- **响应速度**：操作反馈 < 100ms
- **包体积**：安装包 < 20MB

## 2. 现状分析

### 2.1 启动流程
```
init_logger() → load_config() → load_manifests() → merge_manifests()
→ run_migration() → clipboard::setup() → quota::setup()
→ reapply_hotkeys() → apply_main_window_mode() → build_tray()
```

**瓶颈**：
- 串行初始化模块
- 同步数据库操作
- 迁移可能耗时

### 2.2 运行时性能
- 剪贴板：事件驱动 + 500ms轮询
- 数据库：SQLite WAL模式，无连接池
- 图片：实时生成缩略图
- 前端：无虚拟列表，全量渲染

## 3. 优化方案

### 3.1 启动优化

#### 3.1.1 模块并行初始化
**当前**：`clipboard::setup()` → `quota::setup()` 串行执行
**优化**：使用 `tokio::join!` 或 `std::thread::spawn` 并行初始化

```rust
// 伪代码
let clipboard_handle = std::thread::spawn(|| clipboard::setup(app));
let quota_handle = std::thread::spawn(|| quota::setup(app));
clipboard_handle.join().unwrap();
quota_handle.join().unwrap();
```

**影响文件**：`src-tauri/src/lib.rs:317-365`

#### 3.1.2 延迟加载非关键模块
**当前**：所有启用模块在启动时初始化
**优化**：根据使用频率延迟初始化

- **立即初始化**：剪贴板（用户可能立即使用）
- **延迟初始化**：额度监控（后台轮询，不紧急）

**影响文件**：`src-tauri/src/lib.rs:327-365`

#### 3.1.3 预加载关键资源
**当前**：配置加载后才注册热键
**优化**：并行加载配置和注册热键

```rust
let (config, _) = tokio::join!(
    async { load_config(app.handle()) },
    async { reapply_hotkeys(app.handle()) }
);
```

**影响文件**：`src-tauri/src/lib.rs:317-370`

### 3.2 内存优化

#### 3.2.1 图片懒加载
**当前**：剪贴板历史加载时立即加载所有缩略图
**优化**：虚拟列表 + 滚动时按需加载

**前端实现**：
```tsx
// 使用 IntersectionObserver 懒加载
const LazyImage = ({ src }) => {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef();
  
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setLoaded(true);
        observer.disconnect();
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  
  return <div ref={ref}>{loaded && <img src={src} />}</div>;
};
```

**影响文件**：`src/modules/clipboard/`

#### 3.2.2 缓存策略
**当前**：无缓存，每次请求都读取文件
**优化**：LRU缓存最近使用的图片

```rust
use lru::LruCache;

struct ImageCache {
    cache: LruCache<String, Vec<u8>>,
}

impl ImageCache {
    fn new(capacity: usize) -> Self {
        Self {
            cache: LruCache::new(capacity),
        }
    }
    
    fn get_or_load(&mut self, path: &str) -> Option<Vec<u8>> {
        if let Some(data) = self.cache.get(path) {
            return Some(data.clone());
        }
        let data = std::fs::read(path).ok()?;
        self.cache.put(path.to_string(), data.clone());
        Some(data)
    }
}
```

**影响文件**：`src-tauri/src/modules/clipboard/store.rs`

#### 3.2.3 数据库连接池
**当前**：每次操作都获取锁
**优化**：使用连接池复用连接

```rust
use r2d2::Pool;
use rusqlite::Connection;

struct DbPool {
    pool: Pool<Connection>,
}

impl DbPool {
    fn new(path: &str) -> Self {
        let manager = r2d2_sqlite::SqliteConnectionManager::file(path);
        let pool = Pool::builder().build(manager).unwrap();
        Self { pool }
    }
    
    fn get(&self) -> r2d2::PooledConnection<Connection> {
        self.pool.get().unwrap()
    }
}
```

**影响文件**：`src-tauri/src/modules/clipboard/db.rs`

### 3.3 响应优化

#### 3.3.1 虚拟列表
**当前**：剪贴板历史全量渲染
**优化**：使用 `react-window` 或 `@tanstack/react-virtual`

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualList({ items }) {
  const parentRef = useRef();
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
  });
  
  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtualRow => (
          <div key={virtualRow.key} style={{ 
            position: 'absolute',
            top: virtualRow.start,
            height: virtualRow.size,
          }}>
            {items[virtualRow.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**影响文件**：`src/modules/clipboard/Clippage.tsx`

#### 3.3.2 查询索引优化
**当前**：可能缺少必要索引
**优化**：分析查询模式，添加索引

```sql
-- 常用查询索引
CREATE INDEX idx_items_hash ON items(hash);
CREATE INDEX idx_items_created_at ON items(created_at DESC);
CREATE INDEX idx_items_kind ON items(kind);
CREATE INDEX idx_items_pinned ON items(pinned);
```

**影响文件**：`src-tauri/src/modules/clipboard/db.rs`

#### 3.3.3 防抖处理
**当前**：搜索、设置变更实时触发
**优化**：使用防抖减少请求频率

```tsx
import { debounce } from 'lodash';

const debouncedSearch = debounce((query) => {
  // 搜索逻辑
}, 300);

// 在组件中使用
<input onChange={(e) => debouncedSearch(e.target.value)} />
```

**影响文件**：`src/modules/clipboard/Clippage.tsx`

### 3.4 包体积优化

#### 3.4.1 代码分割
**当前**：所有模块打包在一起
**优化**：路由级懒加载

```tsx
const ClipboardPage = lazy(() => import('./modules/clipboard/Clippage'));
const QuotaPage = lazy(() => import('./modules/quota/QuotaPage'));

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/clipboard" element={<ClipboardPage />} />
        <Route path="/quota" element={<QuotaPage />} />
      </Routes>
    </Suspense>
  );
}
```

**影响文件**：`src/App.tsx`

#### 3.4.2 Tauri优化
**当前**：默认打包配置
**优化**：启用压缩、去除调试符号

```toml
# src-tauri/Cargo.toml
[profile.release]
opt-level = "s"  # 优化大小
lto = true       # 链接时优化
codegen-units = 1  # 单线程代码生成
strip = true     # 去除调试符号
```

**影响文件**：`src-tauri/Cargo.toml`

## 4. 实施计划

### 阶段1：启动优化（1-2天）
- [ ] 实现模块并行初始化
- [ ] 实现延迟加载非关键模块
- [ ] 优化预加载流程

### 阶段2：内存优化（1-2天）
- [ ] 实现图片懒加载
- [ ] 实现LRU缓存
- [ ] 优化数据库连接

### 阶段3：响应优化（2-3天）
- [ ] 实现虚拟列表
- [ ] 添加查询索引
- [ ] 实现防抖处理

### 阶段4：包体积优化（1天）
- [ ] 实现代码分割
- [ ] 优化Tauri打包配置
- [ ] 分析并移除未使用依赖

## 5. 验证指标

### 5.1 启动速度
- 测量：从点击到窗口可交互的时间
- 目标：< 2秒

### 5.2 内存占用
- 测量：任务管理器中的内存使用
- 目标：< 100MB

### 5.3 响应速度
- 测量：操作到UI反馈的时间
- 目标：< 100ms

### 5.4 包体积
- 测量：安装包大小
- 目标：< 20MB

## 6. 风险与注意事项

1. **兼容性**：确保优化不影响现有功能
2. **稳定性**：并行初始化需要处理好错误边界
3. **用户体验**：延迟加载需要提供加载状态反馈
4. **测试**：每个优化阶段都需要充分测试

## 7. 回滚方案

- 每个优化阶段单独提交
- 保留原始实现作为回滚选项
- 监控关键指标，发现问题及时回滚