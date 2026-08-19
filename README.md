# EasyTool 工具箱

Windows 桌面工具箱（Tauri 2 + React + TypeScript + SQLite），以模块化方式集成了多个独立可开关、可配置的小工具。

## 功能模块

| 模块 | 说明 |
|------|------|
| 剪贴板 | 监听系统剪贴板，记录文本/图片/文件历史，支持固定、拖拽排序、搜索、一键粘贴回唤起前窗口、自定义呼出热键 |
| 额度监控 | 监控 DeepSeek API 余额与 OpenCode Go 套餐用量，完整消费历史时间线，余额不足/消费突增系统通知 |

模块在设置页中可独立启用/禁用，设置面板支持卡片拖拽排序（顺序记忆）。

## 全局快捷键

- **Ctrl+Shift+E**：呼出/隐藏主窗口（统一呼出模式，可自定义）
- **Ctrl+Shift+V**：直接呼出剪贴板弹窗（关闭「统一呼出主窗口」后生效，可自定义）

热键支持录制式设置（按下组合键即可录入）。统一呼出模式下主窗口按「面板」工作：点击窗口外关闭、热键切换、可置顶、可跟随鼠标。

## 数据位置

所有数据保存在系统用户数据目录，卸载/重装不丢失：

```
%APPDATA%\com.aliboder.easytool\
├── config.json           # 配置（模块开关、热键、主题、迁移标记、窗口尺寸/位置记忆）
├── clipboard.db          # 剪贴板历史（SQLite，含固定条目排序）
├── balance_history.json  # 额度历史记录（消费历史时间线数据源）
├── images/               # 剪贴板图片原图
├── thumbs/               # 图片缩略图
└── easytool.log          # 运行日志
```

API 密钥通过 Windows 系统凭据库（Credential Manager）加密保存，不落盘明文。

## 数据迁移

首次启动会自动迁移旧版数据（一次性，迁移后不再执行）：

- **PasteBoard** 剪贴板历史 → 导入 `clipboard.db`
- **QuotaMonitor / DeepSeek Money** 余额记录 → 合并进 `balance_history.json`

## 安装与使用

- **安装版**：`EasyTool_<版本>_x64-setup.exe`，双击安装，安装后托盘常驻。
- 关闭主窗口 = 最小化到托盘；右键托盘图标可退出。
- 首次使用：设置页为各模块配置密钥/热键即可。
- 支持开机自启动（设置页开关）。

## 开发

```bash
npm install
npm run tauri dev      # 开发模式（热重载）
npm run tauri build    # 打包（NSIS 安装包）
```

## 技术栈

- Tauri 2（Rust）+ WebView2
- React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui + @dnd-kit
- SQLite（rusqlite）、keyring（密钥加密）、reqwest（API 查询）
