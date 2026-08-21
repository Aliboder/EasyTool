# EasyTool

> Windows 效率工具箱——一个热键，唤出整套效率工具。

**[官方网站](https://aliboder.github.io/EasyTool/)** · **[下载安装包](https://github.com/Aliboder/EasyTool/releases/latest)** · **[更新日志](https://github.com/Aliboder/EasyTool/releases)**

EasyTool 是一款开源免费的 Windows 效率工具箱，用 Tauri 2 + Rust + React 打造。它不是一堆互不相干的小工具集合，而是一个**模块化架构**——每个功能是独立模块，可启停、可排序、可扩展，通过全局热键一键呼出。

---

## 功能

| 模块 | 功能 | 热键 |
|------|------|------|
| **剪贴板历史** | 记录文本/图片/文件，固定常用项，拖拽排序，搜索，一键粘贴 | `Ctrl+Shift+V` |
| **额度监控** | DeepSeek / OpenCode Go 多账户余额监控，消费历史，阈值告警 | 主面板内 |
| **表情面板** | 1900+ 表情分类浏览，中文/英文/shortcode 搜索，收藏置顶 | `Ctrl+Shift+J` |
| **文件秒搜** | Everything 全文引擎毫秒级搜索，自定义列/排序，复制路径联动剪贴板 | `Ctrl+Shift+F` |

所有模块通过 `Ctrl+Shift+E` 统一呼出主面板，也可关闭统一模式使用独立热键。

## 特点

- **本地优先**：数据存本机 SQLite，密钥进 Windows 凭据管理器，无服务器、无遥测
- **模块化架构**：manifest.json 壳驱动，新增模块只需 3 个文件
- **全局热键**：全局热键一键呼出，弹窗跟随鼠标，失焦自动隐藏
- **开源免费**：MIT 许可，永久免费，无广告无账号

---

## 安装

从 [Releases](https://github.com/Aliboder/EasyTool/releases/latest) 下载 `EasyTool_x.x.x_x64-setup.exe`，双击安装即可。无需管理员权限。

- 支持 Windows 10/11 x64
- 安装后托盘常驻，开机自启动（可选）
- 文件搜索模块需安装 [Everything](https://www.voidtools.com/)（免费开源）

## 快速开始

1. 安装并启动 EasyTool
2. 打开设置页，配置 API 密钥（如需使用额度监控）
3. 按 `Ctrl+Shift+E` 呼出主面板
4. 试试剪贴板历史、表情面板、文件搜索

---

## 开发

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/)（通过 `rustup` 安装）
- Windows 10/11 x64

### 开发命令

```bash
git clone https://github.com/Aliboder/EasyTool.git
cd EasyTool
npm install
npm run tauri dev        # 开发模式（热重载）
npm run tauri build      # 打包（NSIS 安装包）
cargo test               # Rust 单元测试（在 src-tauri/ 下）
npx tsc --noEmit         # 前端类型检查
```

### 项目结构

```
src-tauri/src/
├── lib.rs              # 主入口：托盘、热键、窗口、模块 setup
├── config.rs           # AppConfig + 配置读写命令
├── migrate.rs          # 旧数据一次性迁移
└── modules/            # 模块注册表
    ├── clipboard/      # 剪贴板历史
    ├── quota/          # 额度监控
    ├── emoji/          # 表情面板
    └── search/         # 文件搜索

src/
├── App.tsx             # 根组件
├── lib/                # API 封装、主题、工具函数
├── components/         # UI 组件
└── modules/            # 各模块前端页面
```

### 新增模块

参考 [模块开发指南](docs/module-guide.md)——一个 manifest.json + 一个 Rust 后端文件 + 一个 React 前端组件即可接入，壳 UI 自动识别。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 + WebView2 |
| 后端 | Rust（rusqlite / keyring / reqwest / chrono） |
| 前端 | React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui |
| 存储 | SQLite WAL（本地）+ Windows 凭据管理器 |
| 构建 | Vite（MPA 多 HTML 入口）+ NSIS 安装包 |

---

## 数据存储

所有数据保存在 `%APPDATA%\com.aliboder.easytool\`：

```
├── config.json               # 应用配置
├── clipboard.db              # 剪贴板历史（SQLite WAL）
├── balance_history_*.json    # 额度消费历史（按账户分文件）
├── images/                   # 图片原文
├── thumbs/                   # 缩略图缓存
└── easytool.log              # 运行日志
```

API 密钥通过 Windows 凭据管理器加密存储，不落盘明文。

---

## 许可

[MIT License](LICENSE) © 2026 [Aliboder](https://github.com/Aliboder)

表情模块的 Emoji 图片来自 [Twemoji](https://github.com/jdecked/twemoji)（CC-BY 4.0）
