import type { LucideIcon } from "lucide-react";
import { ClipboardList, Gauge, Smile, Search } from "lucide-react";

export interface ModuleFeature {
  title: string;
  desc: string;
}

export interface ModuleSpec {
  label: string;
  value: string;
}

export interface Module {
  id: string;
  no: string;
  path: string;
  name: string;
  kicker: string;
  oneLine: string;
  heroTitle: string;
  lead: string;
  body: string[];
  features: ModuleFeature[];
  specs: ModuleSpec[];
  icon: LucideIcon;
  hotkey: string;
  hotkeyLabel: string;
}

export const modules: Module[] = [
  {
    id: "clipboard",
    no: "01",
    path: "/modules/clipboard",
    name: "剪贴板历史",
    kicker: "Clipboard",
    oneLine: "记录剪贴板文本 / 图片 / 文件，固定排序，跟手粘贴。",
    heroTitle: "剪贴板，不该只留最后一次。",
    lead: "EasyTool 持续监听系统剪贴板，把每一次复制都留存下来——文本、图片、文件，随时回看、搜索、一键粘贴回原窗口。",
    body: [
      "剪贴板模块以事件驱动（WM_CLIPBOARDUPDATE）+ 500ms 轮询兜底双通道监听系统剪贴板，按内容指纹去重，避免同一内容反复入库。文本、图片、文件三种类型统一记录，默认保留最近 500 条。",
      "常用条目可以固定置顶，拖拽即可调整顺序并持久化。图片自动生成 256px 缩略图，点开可大图预览；内容支持模糊搜索。粘贴时跟随鼠标弹出，失焦自动隐藏，延迟创建窗口保证不干扰启动。",
    ],
    features: [
      { title: "三种类型全覆盖", desc: "文本、图片、文件历史统一记录，指纹去重。" },
      { title: "固定 + 拖拽排序", desc: "常用条目置顶固定，拖拽调整顺序并持久化。" },
      { title: "模糊搜索", desc: "历史内容即时检索，快速定位任意一条记录。" },
      { title: "图片缩略图", desc: "256px 缩略图 + 大图预览，图片不占屏幕。" },
      { title: "跟手粘贴", desc: "跟随鼠标弹出，一键粘贴回唤起前的窗口。" },
      { title: "延迟创建弹窗", desc: "首次呼出才建窗，不拖慢应用启动。" },
    ],
    specs: [
      { label: "默认容量", value: "500 条" },
      { label: "默认热键", value: "Ctrl+Shift+V" },
      { label: "记录类型", value: "文本 / 图片 / 文件" },
      { label: "监听机制", value: "事件驱动 + 500ms 轮询兜底" },
      { label: "去重", value: "内容指纹" },
      { label: "缩略图", value: "256px" },
    ],
    icon: ClipboardList,
    hotkey: "Ctrl+Shift+V",
    hotkeyLabel: "剪贴板弹窗",
  },
  {
    id: "quota",
    no: "02",
    path: "/modules/quota",
    name: "额度监控",
    kicker: "Quota",
    oneLine: "DeepSeek / OpenCode Go 多账户余额监控与消费告警。",
    heroTitle: "API 额度，心里有数。",
    lead: "把 DeepSeek 与 OpenCode Go 的余额、套餐用量、消费历史集中到一个面板，多账户独立管理，不足时自动提醒。",
    body: [
      "额度监控支持 DeepSeek 与 OpenCode Go 两类账户，可以添加任意多个账户，每个账户独立密钥（存入 Windows 凭据库，每账户独立槽位，绝不落盘明文）。后台按设定间隔轮询各账户余额与用量。",
      "预警 / 告警双阈值机制：低于阈值弹出系统通知；完整消费历史按账户分文件保存（上限 5000 条），并支持消费突增提醒，让你对每一笔花销有迹可循。",
    ],
    features: [
      { title: "多账户管理", desc: "DeepSeek / OpenCode Go 任意多个账户，独立密钥独立余额。" },
      { title: "双阈值告警", desc: "预警 / 告警两级阈值，余额不足自动系统通知。" },
      { title: "消费历史", desc: "完整时间线，上限 5000 条，按账户独立保存。" },
      { title: "消费突增提醒", desc: "检测到异常消费及时提醒，心里有底。" },
      { title: "后台轮询", desc: "后台线程按设定间隔刷新，不打扰使用。" },
      { title: "密钥安全", desc: "keyring 加密存储，每账户独立槽位，不落盘明文。" },
    ],
    specs: [
      { label: "账户类型", value: "DeepSeek / OpenCode Go" },
      { label: "默认刷新间隔", value: "30 秒" },
      { label: "默认预警阈值", value: "10.0" },
      { label: "历史上限", value: "5000 条 / 账户" },
      { label: "密钥存储", value: "Windows 凭据库（keyring）" },
      { label: "用量窗口", value: "滚动 / 每周 / 每月" },
    ],
    icon: Gauge,
    hotkey: "Ctrl+Shift+E",
    hotkeyLabel: "主面板统一呼出",
  },
  {
    id: "emoji",
    no: "03",
    path: "/modules/emoji",
    name: "表情面板",
    kicker: "Emoji",
    oneLine: "1900+ 常用表情，分类检索，一键插入。",
    heroTitle: "一个面板，装下全部表情。",
    lead: "系统字体优先渲染，分类检索，点击即输入——写代码、写文档、聊天时都能顺手用上表情。",
    body: [
      "表情模块内置 1900+ 常用表情符号，按分类组织、支持检索。渲染采用系统字体优先 + Canvas 像素检测判断是否可显示，缺失时自动回退到 Twemoji 兜底，保证每个平台上都显示完整。",
      "点击表情通过 SendInput 直接输入到当前光标位置，无需复制粘贴。弹窗跟随鼠标，呼出即用；也支持配置点击动作与自定义热键。",
    ],
    features: [
      { title: "1900+ 表情", desc: "常用表情符号全量收录，分类组织。" },
      { title: "一键直输", desc: "SendInput 直接输入到当前光标，无需复制粘贴。" },
      { title: "智能渲染", desc: "系统字体优先，Twemoji 兜底，任何平台显示完整。" },
      { title: "分类检索", desc: "按分类浏览 + 关键词搜索，快速定位。" },
      { title: "跟随鼠标", desc: "弹窗在光标旁弹出，呼出即用。" },
    ],
    specs: [
      { label: "表情数量", value: "1900+" },
      { label: "默认热键", value: "Ctrl+Shift+J" },
      { label: "插入方式", value: "SendInput 直接输入" },
      { label: "渲染回退", value: "Twemoji（CC-BY 4.0）" },
      { label: "默认点击动作", value: "粘贴" },
    ],
    icon: Smile,
    hotkey: "Ctrl+Shift+J",
    hotkeyLabel: "表情弹窗",
  },
  {
    id: "search",
    no: "04",
    path: "/modules/search",
    name: "文件搜索",
    kicker: "Search",
    oneLine: "基于 Everything 的全局文件名秒搜。",
    heroTitle: "全盘文件，秒级直达。",
    lead: "基于 Everything 的 NTFS 索引能力，输入即搜，结果列、排序、视图全部可自定义，找到的路径顺手写进剪贴板历史。",
    body: [
      "文件搜索模块基于 Everything（免费、MIT 协议）的实时索引，全盘文件名搜索毫秒级返回。Everything64.dll 随应用动态加载，查询在后台线程执行并持全局互斥锁，避免阻塞界面。",
      "结果列表支持按名称 / 路径 / 大小 / 修改时间排序与自定义列，提供列表、缩略图、网格多种视图；支持正则、区分大小写、匹配路径、全字匹配等 Everything 完整语法。复制路径或文件时会联动写入剪贴板历史，形成工作闭环。",
    ],
    features: [
      { title: "秒级全盘搜索", desc: "Everything 实时索引，文件名毫秒级返回。" },
      { title: "结果自定义", desc: "列、排序、视图模式全部可配置。" },
      { title: "完整查询语法", desc: "正则、区分大小写、匹配路径、全字匹配。" },
      { title: "双入口", desc: "独立弹窗 + 模块页均可呼出使用。" },
      { title: "联动剪贴板", desc: "复制路径 / 文件自动写入剪贴板历史。" },
      { title: "后台查询", desc: "全局互斥锁 + 后台线程，界面不卡顿。" },
    ],
    specs: [
      { label: "搜索引擎", value: "Everything（免费 / MIT）" },
      { label: "默认热键", value: "Ctrl+Shift+F" },
      { label: "默认结果上限", value: "200 条" },
      { label: "排序方式", value: "名称 / 路径 / 大小 / 修改时间" },
      { label: "视图模式", value: "列表 / 缩略图 / 网格" },
      { label: "SDK", value: "Everything64.dll 动态加载" },
    ],
    icon: Search,
    hotkey: "Ctrl+Shift+F",
    hotkeyLabel: "搜索弹窗",
  },
];

export const about = {
  version: "v0.4.4",
  license: "MIT",
  tests: "36+ 后端单元测试",
  platform: "Windows 10 / 11 x64",
  stack: ["Tauri 2", "Rust", "React 19", "TypeScript", "Tailwind v4", "SQLite WAL"],
  dataDir: "%APPDATA%\\com.aliboder.easytool",
  mainHotkey: "Ctrl+Shift+E",
  releaseUrl: "https://github.com/Aliboder/EasyTool/releases",
  repoUrl: "https://github.com/Aliboder/EasyTool",
};
