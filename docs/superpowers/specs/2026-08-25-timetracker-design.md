# 时长统计模块设计文档

## 1. 概述

将 ActivityWatch 的核心时长统计功能集成到 EasyTool，实现电脑软件使用时长的自动记录、统计和可视化展示。

### 1.1 目标
- 自动记录前台应用使用时长
- 支持多维度统计（今日/本周/本月）
- 提供可视化展示（排行、时间线、分类饼图）
- 隐私优先：数据本地存储，不上传云端

### 1.2 技术栈
- 后端：Rust + Tauri 2 + windows crate + rusqlite
- 前端：React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui + lucide-react
- 存储：SQLite（WAL 模式）

### 1.3 模块规范遵循

本模块严格遵循 `docs/module-guide.md` 的规范：

| 规范项 | 遵循方式 |
|--------|----------|
| 模块目录结构 | `src-tauri/modules/timetracker/` + `src-tauri/src/modules/timetracker/` + `src/modules/timetracker/` |
| 配置管理三件套 | `config.ts` + `useModuleConfig` + 受控 `Settings.tsx` |
| 面板头 | 使用 `ModuleHeader` + `HeaderButton` + `HeaderSort` |
| 独立弹窗 | `mountPopup` + `usePopupGeometry` + 延迟创建 |
| 操作反馈 | 失败必 toast，成功补 toast |

---

## 二、模块文件结构

### 2.1 完整文件清单

| 文件 | 必需性 | 作用 |
|------|--------|------|
| `src-tauri/modules/timetracker/manifest.json` | ✅ 必需 | 模块清单 + 默认配置 |
| `src-tauri/src/modules/timetracker/mod.rs` | ✅ 必需 | 模块入口、setup、状态管理 |
| `src-tauri/src/modules/timetracker/commands.rs` | ✅ 必需 | Tauri 命令（前端 invoke） |
| `src-tauri/src/modules/timetracker/db.rs` | ✅ 必需 | 数据库操作 |
| `src-tauri/src/modules/timetracker/collector.rs` | ✅ 必需 | 数据采集（前台监听 + 键盘/鼠标钩子） |
| `src-tauri/src/modules/timetracker/aggregator.rs` | ✅ 必需 | 聚合统计 |
| `src-tauri/src/modules/timetracker/models.rs` | ✅ 必需 | 数据模型 |
| `src-tauri/src/modules/mod.rs` | ✅ 必需 | 追加 `pub mod timetracker` |
| `src-tauri/src/lib.rs` | ✅ 必需 | setup + invoke_handler 注册 |
| `src/modules/timetracker/config.ts` | ✅ 必需 | 配置类型 + 默认值 |
| `src/modules/timetracker/Page.tsx` | ✅ 必需 | 主窗口 Tab |
| `src/modules/timetracker/Settings.tsx` | ✅ 必需 | 设置组件（受控） |
| `src/modules/timetracker/TimetrackerView.tsx` | ✅ 必需 | 核心视图（主窗口/弹窗共用） |
| `src/modules/timetracker/components/` | ✅ 按需 | UI 组件 |
| `src/modules/timetracker/hooks/` | ✅ 按需 | 自定义 Hooks |
| `src/modules/timetracker/types.ts` | ✅ 必需 | TypeScript 类型 |
| `src/App.tsx` | ✅ 必需 | 页面路由 + 设置区挂载 |
| `timetracker_window.html` | ⭕ 可选 | 独立弹窗入口 |
| `src/timetracker_window.tsx` | ⭕ 可选 | 弹窗挂载（mountPopup） |
| `vite.config.ts` | ⭕ 可选 | rollupOptions.input 增加 |
| `src-tauri/capabilities/default.json` | ⭕ 可选 | 窗口权限声明 |

### 2.2 manifest.json

```json
{
  "id": "timetracker",
  "name": "时长统计",
  "icon": "clock",
  "enabled": true,
  "description": "自动记录电脑软件使用时长，支持统计分析和可视化",
  "default_config": {
    "trackWindowTitle": true,
    "trackKeyboard": true,
    "trackMouse": true,
    "hotkey": "Ctrl+Shift+T",
    "topN": 10,
    "autoAggregateMinutes": 60
  }
}
```

> 注意：`default_config` 使用 camelCase（前端 useModuleConfig 自动转 snake_case）

---

## 五、功能范围

### 5.1 数据采集层（A1-A5）

| 编号 | 功能 | 实现方式 |
|------|------|----------|
| A1 | 前台窗口监听 | 复用 search/foreground.rs 的 SetWinEventHook 机制 |
| A2 | 窗口标题采集 | GetWindowText(hwnd) 获取窗口标题 |
| A3 | 进程路径采集 | QueryFullProcessImageNameW 获取 exe 完整路径 |
| A4 | 键盘活动检测 | SetWindowsHookEx(WH_KEYBOARD) 检测键盘输入 |
| A5 | 鼠标活动检测 | SetWindowsHookEx(WH_MOUSE) 检测鼠标移动/点击 |

### 5.2 数据存储层（B1-B6）

| 编号 | 功能 | 数据库设计 |
|------|------|------------|
| B1 | 按秒粒度存储 | ❌ 不采用（数据量过大） |
| B2 | 按会话粒度存储 | ✅ events 表：记录每次前台会话 |
| B3 | 按天聚合统计 | ✅ daily_stats 表：按天汇总 |
| B4 | 按周/月聚合统计 | ✅ 基于 daily_stats 聚合查询 |
| B5 | 应用分类标签 | ✅ apps 表：存储应用分类 |
| B6 | 自动分类规则 | ✅ 基于应用名/路径关键词自动归类 |

### 5.3 数据展示层（C1-C6 + D1-D3 + E1-E3）

**主窗口 Tab：**
- C1：今日 Top N 应用排行
- C2：本周/本月排行切换
- C3：时间线视图（甘特图）
- C4：应用分类饼图
- C5：搜索/筛选
- C6：应用详情页

**独立弹窗：** 与主窗口页面相同

**托盘菜单：**
- E1：右键显示今日 Top 3
- E2：开始/暂停记录
- E3：打开主窗口

---

## 六、数据库设计

### 6.1 表结构

```sql
-- 应用信息表
CREATE TABLE apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exe_path TEXT UNIQUE NOT NULL,      -- exe 完整路径（小写）
    app_name TEXT NOT NULL,             -- 应用名称（exe 文件名）
    window_title TEXT,                  -- 最近窗口标题
    category TEXT DEFAULT 'unknown',    -- 分类：dev/office/entertainment/social/system/unknown
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 前台会话表（核心数据）
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    start_time DATETIME NOT NULL,       -- 会话开始时间
    end_time DATETIME,                  -- 会话结束时间（NULL=进行中）
    duration_sec INTEGER DEFAULT 0,     -- 时长（秒）
    window_title TEXT,                  -- 窗口标题快照
    is_active INTEGER DEFAULT 1,        -- 是否有键盘/鼠标活动
    FOREIGN KEY (app_id) REFERENCES apps(id)
);

-- 每日统计表（聚合查询加速）
CREATE TABLE daily_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    date TEXT NOT NULL,                 -- YYYY-MM-DD 格式
    total_duration_sec INTEGER DEFAULT 0, -- 当天总时长（秒）
    active_duration_sec INTEGER DEFAULT 0, -- 活跃时长（秒）
    session_count INTEGER DEFAULT 0,    -- 会话次数
    FOREIGN KEY (app_id) REFERENCES apps(id),
    UNIQUE(app_id, date)
);

-- 应用分类规则表
CREATE TABLE category_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,              -- 匹配模式（应用名/路径关键词）
    category TEXT NOT NULL,             -- 目标分类
    priority INTEGER DEFAULT 0,         -- 优先级（越大越优先）
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 6.2 索引

```sql
CREATE INDEX idx_events_app_id ON events(app_id);
CREATE INDEX idx_events_start_time ON events(start_time);
CREATE INDEX idx_events_end_time ON events(end_time);
CREATE INDEX idx_daily_stats_date ON daily_stats(date);
CREATE INDEX idx_daily_stats_app_id ON daily_stats(app_id);
CREATE INDEX idx_apps_category ON apps(category);
```

---

## 七、后端架构

### 7.1 模块结构

```
src-tauri/src/modules/timetracker/
├── mod.rs              # 模块入口、setup、热键
├── db.rs               # 数据库操作（AppsDb、EventsDb、DailyStatsDb）
├── collector.rs        # 数据采集（前台监听、键盘/鼠标钩子）
├── aggregator.rs       # 聚合统计（按天/周/月汇总）
├── commands.rs         # Tauri 命令（供前端调用）
└── models.rs           # 数据模型（App、Event、DailyStat）
```

### 7.2 核心组件

#### 7.2.1 前台监听器（collector.rs）

复用 search/foreground.rs 的 SetWinEventHook 机制，增加：
- 窗口标题采集
- 会话时长计算
- 键盘/鼠标活动检测

```rust
// 伪代码
pub struct Collector {
    db: Arc<Mutex<TimetrackerDb>>,
    current_event: Option<Event>,
    last_active: Instant,
}

impl Collector {
    pub fn start(&self) {
        // 1. SetWinEventHook 监听前台窗口变化
        // 2. SetWindowsHookEx(WH_KEYBOARD) 监听键盘
        // 3. SetWindowsHookEx(WH_MOUSE) 监听鼠标
        // 4. 每秒检查当前会话是否活跃
    }

    fn on_foreground_change(&mut self, hwnd: HWND) {
        // 1. 结束旧会话
        // 2. 获取新应用信息
        // 3. 开始新会话
    }

    fn on_input_activity(&mut self) {
        // 更新 last_active 时间戳
    }
}
```

#### 7.2.2 数据库（db.rs）

```rust
pub struct TimetrackerDb {
    conn: rusqlite::Connection,
}

impl TimetrackerDb {
    // 应用操作
    pub fn upsert_app(&self, exe_path: &str, app_name: &str) -> Result<i64>;
    pub fn get_app_by_path(&self, exe_path: &str) -> Result<Option<App>>;
    pub fn update_app_category(&self, app_id: i64, category: &str) -> Result<()>;

    // 会话操作
    pub fn start_event(&self, app_id: i64, window_title: &str) -> Result<i64>;
    pub fn end_event(&self, event_id: i64) -> Result<()>;
    pub fn get_active_event(&self) -> Result<Option<Event>>;

    // 统计查询
    pub fn get_today_stats(&self, limit: Option<i64>) -> Result<Vec<DailyStat>>;
    pub fn get_week_stats(&self, limit: Option<i64>) -> Result<Vec<DailyStat>>;
    pub fn get_month_stats(&self, limit: Option<i64>) -> Result<Vec<DailyStat>>;
    pub fn get_app_timeline(&self, date: &str) -> Result<Vec<Event>>;

    // 分类
    pub fn auto_categorize(&self, app_name: &str, exe_path: &str) -> String;
}
```

#### 7.2.3 聚合统计（aggregator.rs）

```rust
pub struct Aggregator {
    db: Arc<Mutex<TimetrackerDb>>,
}

impl Aggregator {
    // 定时任务：每小时聚合一次 daily_stats
    pub fn start_aggregation_loop(&self) {
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(3600));
            self.aggregate_today();
        });
    }

    // 聚合今天的 events 到 daily_stats
    fn aggregate_today(&self) {
        // INSERT OR REPLACE INTO daily_stats
        // SELECT app_id, date(start_time), SUM(duration_sec), ...
        // FROM events
        // WHERE date(start_time) = date('now')
        // GROUP BY app_id, date(start_time)
    }
}
```

### 7.3 Tauri 命令（commands.rs）

```rust
// 查询命令
#[tauri::command]
pub fn timetracker_get_today_stats(app: AppHandle) -> Result<Vec<DailyStat>>;

#[tauri::command]
pub fn timetracker_get_week_stats(app: AppHandle) -> Result<Vec<DailyStat>>;

#[tauri::command]
pub fn timetracker_get_month_stats(app: AppHandle) -> Result<Vec<DailyStat>>;

#[tauri::command]
pub fn timetracker_get_app_timeline(app: AppHandle, date: String) -> Result<Vec<Event>>;

#[tauri::command]
pub fn timetracker_get_app_detail(app: AppHandle, app_id: i64) -> Result<AppDetail>;

// 控制命令
#[tauri::command]
pub fn timetracker_set_recording(app: AppHandle, recording: bool) -> Result<()>;

#[tauri::command]
pub fn timetracker_set_category(app: AppHandle, app_id: i64, category: String) -> Result<()>;

#[tauri::command]
pub fn timetracker_delete_event(app: AppHandle, event_id: i64) -> Result<()>;
```

---

## 八、前端架构

### 8.1 模块结构

```
src/modules/timetracker/
├── Page.tsx              # 主窗口 Tab 入口
├── Popup.tsx             # 独立弹窗入口
├── TimetrackerView.tsx   # 核心视图（主窗口和弹窗共用）
├── components/
│   ├── StatsCard.tsx     # 统计卡片（今日总时长、Top 1 应用）
│   ├── AppRanking.tsx    # 应用排行列表
│   ├── Timeline.tsx      # 时间线视图（甘特图）
│   ├── CategoryPie.tsx   # 分类饼图
│   ├── AppDetail.tsx     # 应用详情页
│   └── SearchFilter.tsx  # 搜索/筛选组件
├── hooks/
│   ├── useTimetracker.ts # 数据获取 Hook
│   └── useTimeline.ts    # 时间线数据 Hook
└── types.ts              # TypeScript 类型定义
```

### 8.2 核心组件

#### 8.2.1 TimetrackerView.tsx

```tsx
export function TimetrackerView({ popup = false }: { popup?: boolean }) {
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const [stats, setStats] = useState<DailyStat[]>([]);
  const [selectedApp, setSelectedApp] = useState<number | null>(null);

  return (
    <div className="flex h-full flex-col">
      <ModuleHeader
        title="时长统计"
        tabs={[
          { id: "today", label: "今日" },
          { id: "week", label: "本周" },
          { id: "month", label: "本月" },
        ]}
        activeTab={period}
        onTabChange={setPeriod}
      />

      <div className="flex-1 overflow-y-auto">
        {/* 统计卡片 */}
        <StatsCard stats={stats} />

        {/* 应用排行 */}
        <AppRanking
          stats={stats}
          onSelect={setSelectedApp}
          selectedApp={selectedApp}
        />

        {/* 时间线视图（仅今日） */}
        {period === "today" && (
          <Timeline onSelect={setSelectedApp} />
        )}

        {/* 分类饼图 */}
        <CategoryPie stats={stats} />
      </div>

      {/* 应用详情抽屉 */}
      {selectedApp && (
        <Drawer open onClose={() => setSelectedApp(null)}>
          <AppDetail appId={selectedApp} />
        </Drawer>
      )}
    </div>
  );
}
```

#### 8.2.2 时间线视图（Timeline.tsx）

使用 CSS Grid 实现甘特图效果：

```tsx
export function Timeline({ onSelect }: { onSelect: (appId: number) => void }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const colors = ["bg-blue-500", "bg-green-500", "bg-yellow-500", ...];

  return (
    <div className="space-y-1">
      {hours.map((hour) => (
        <div key={hour} className="flex items-center gap-2">
          <span className="w-8 text-xs text-muted-foreground">{hour}:00</span>
          <div className="flex-1 flex h-4 gap-px">
            {events
              .filter((e) => e.startHour === hour)
              .map((e, i) => (
                <div
                  key={i}
                  className={`${colors[e.appId % colors.length]} rounded-sm cursor-pointer`}
                  style={{ width: `${(e.duration / 3600) * 100}%` }}
                  onClick={() => onSelect(e.appId)}
                  title={`${e.appName}: ${formatDuration(e.duration)}`}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## 九、模块注册

### 9.1 manifest.json

```json
{
  "id": "timetracker",
  "name": "时长统计",
  "icon": "clock",
  "enabled": true,
  "description": "自动记录电脑软件使用时长，支持统计分析和可视化",
  "default_config": {
    "trackWindowTitle": true,
    "trackKeyboard": true,
    "trackMouse": true,
    "autoAggregateMinutes": 60,
    "topN": 10,
    "hotkey": "Ctrl+Shift+T"
  }
}
```

### 9.2 模块初始化（lib.rs）

```rust
// 在 lib.rs 的 setup 中添加
pub mod modules::timetracker;

// 在 setup 函数中调用
modules::timetracker::setup_from_handle(&app)?;
```

---

## 十、热键设计

| 操作 | 默认热键 | 说明 |
|------|----------|------|
| 呼出时长统计 | Ctrl+Shift+T | 打开主窗口 Tab |
| 开始/暂停记录 | 无 | 可在设置中配置 |

---

## 十一、配置项

```json
{
  "timetracker": {
    "enabled": true,
    "trackWindowTitle": true,
    "trackKeyboard": true,
    "trackMouse": true,
    "autoAggregateMinutes": 60,
    "topN": 10,
    "hotkey": "Ctrl+Shift+T"
  }
}
```

---

## 十二、性能优化

1. **批量写入**：每 10 秒批量写入 events 表，减少 SQLite 写入次数
2. **异步聚合**：聚合统计在后台线程执行，不阻塞 UI
3. **索引优化**：对常用查询字段建立索引
4. **数据清理**：保留 90 天数据，超过自动清理

---

## 十三、实现计划

### Phase 1：基础框架（~2 小时）
- [ ] 创建模块目录结构
- [ ] 实现数据库表结构
- [ ] 实现基础 CRUD 操作

### Phase 2：数据采集（~2 小时）
- [ ] 实现前台监听器
- [ ] 实现键盘/鼠标钩子
- [ ] 实现会话管理

### Phase 3：聚合统计（~1 小时）
- [ ] 实现按天聚合
- [ ] 实现周/月统计查询

### Phase 4：前端展示（~3 小时）
- [ ] 实现主窗口 Tab
- [ ] 实现应用排行
- [ ] 实现时间线视图
- [ ] 实现分类饼图
- [ ] 实现应用详情

### Phase 5：弹窗和托盘（~1 小时）
- [ ] 实现独立弹窗
- [ ] 实现托盘菜单

### Phase 6：测试和优化（~1 小时）
- [ ] 单元测试
- [ ] 性能优化
- [ ] 边界情况处理

**预计总耗时：~10 小时**

---

## 十四、风险和注意事项

1. **权限问题**：某些系统进程可能无法获取窗口信息，需要 WMI 兜底
2. **性能影响**：键盘/鼠标钩子会增加系统开销，需要节流
3. **数据安全**：窗口标题可能包含敏感信息，需要用户知情同意
4. **兼容性**：Windows 7/8/10/11 需要测试兼容性

---

## 十五、参考资源

- [ActivityWatch](https://github.com/ActivityWatch/activitywatch)
- [aw-watcher-window](https://github.com/ActivityWatch/aw-watcher-window)
- [Windows API 文档](https://learn.microsoft.com/en-us/windows/win32/)
- [EasyTool search/foreground.rs](src-tauri/src/modules/search/foreground.rs)
