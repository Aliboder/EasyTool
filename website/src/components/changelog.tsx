import { ArrowRight } from "lucide-react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

const RELEASES = "https://github.com/Aliboder/EasyTool/releases";

const LOG = [
  {
    version: "v0.7.0",
    date: "2026-08-29",
    highlight: true,
    color: "text-emerald-400",
    colorBg: "bg-emerald-500/15",
    tag: "latest",
    summary: "体验打磨：纯文本粘贴、托盘快捷入口、右键扩展、应用置顶、多关键词高亮。",
    detail: "剪贴板新增「粘贴为纯文本」开关与右键「复制为纯文本」，图片条目支持「用系统看图打开」；历史满 500 条显示上限提示，时间戳恢复固定 MM/DD HH:mm 并统一卡片分割线对齐。托盘右键新增「打开剪贴板 / 打开时长统计 / 检查更新」快速入口。应用中心支持右键「置顶 / 打开所在位置」，置顶应用恒排最前。剪贴板搜索高亮升级为多关键词全部命中。图片管线异步化（最长边 2048 降采样 + 256 缩略图），日志缓冲写盘减少 IO。",
  },
  {
    version: "v0.6.9",
    date: "2026-08-28",
    highlight: true,
    color: "text-emerald-400",
    colorBg: "bg-emerald-500/15",
    tag: "latest",
    summary: "性能与清理：剪贴板「全部」Tab 长列表虚拟化、缩略图分批加载；前端单测体系落地。",
    detail: "剪贴板大历史下「全部」页签不再全量渲染（虚拟滚动）+ 缩略图按帧分批拉取；新增 vitest 前端单测（npm test）；启动自动清理历史遗留的废弃配置键；移除剪贴板焦点记录等死代码；发布流程适配 GitHub 新版 Actions。",
  },
  {
    version: "v0.6.8",
    date: "2026-08-28",
    highlight: true,
    color: "text-emerald-400",
    colorBg: "bg-emerald-500/15",
    tag: "latest",
    summary: "移除独立小窗，统一为单一主窗口 + 单一全局热键。",
    detail: "剪贴板/表情/搜索/时长统计的独立弹窗全部移除，功能收进唯一主面板；模块独立热键精简为单个主窗口呼出热键（Ctrl+Shift+E，可自定义），跟手粘贴/直输保留（收起时自动回到原窗口）。",
  },
  {
    version: "v0.6.7",
    date: "2026-08-28",
    highlight: false,
    color: "text-blue-400",
    colorBg: "bg-blue-500/15",
    tag: "ui",
    summary: "底栏滚轮横向滚动：窗口缩小时悬停底栏滚动滚轮即可平移模块按钮。",
    detail: "",
  },
  {
    version: "v0.6.6",
    date: "2026-08-26",
    highlight: false,
    color: "text-violet-400",
    colorBg: "bg-violet-500/15",
    tag: "feature",
    summary: "播放声音算活跃：视频/直播/音乐（WASAPI 会话监控）不再被计入挂机。",
    detail: "时长统计设置即时生效，无需重启。",
  },
  {
    version: "v0.6.5",
    date: "2026-08-26",
    highlight: false,
    color: "text-cyan-400",
    colorBg: "bg-cyan-500/15",
    tag: "perf",
    summary: "启动提速：合并启动 IPC、仅预载落地面板分包、跳过无操作配置写盘。",
    detail: "",
  },
  {
    version: "v0.6.4",
    date: "2026-08-26",
    highlight: false,
    color: "text-blue-400",
    colorBg: "bg-blue-500/15",
    tag: "feature",
    summary: "时长统计事件记录重写：应用图标 + 时长条 + 点击查看应用详情。",
    detail: "",
  },
  {
    version: "v0.6.3",
    date: "2026-08-26",
    highlight: false,
    color: "text-amber-400",
    colorBg: "bg-amber-500/15",
    tag: "feature",
    summary: "时长统计：同软件多 exe 自动归并、时间线重写；额度监控环形显示模式。",
    detail: "",
  },
  {
    version: "v0.6.2",
    date: "2026-08-26",
    highlight: false,
    color: "text-emerald-400",
    colorBg: "bg-emerald-500/15",
    tag: "feature",
    summary: "时长统计应用友好名（快捷方式名 → 文件版本信息 → exe 名三级解析）。",
    detail: "性能优化：弹窗尺寸记忆、应用中心 .lnk 缓存、可见性轮询、热键按需重注册。",
  },
  {
    version: "v0.6.0",
    date: "2026-08-26",
    highlight: true,
    color: "text-emerald-400",
    colorBg: "bg-emerald-500/15",
    tag: "latest",
    summary: "新增「时长统计」模块：自动记录软件使用时长，排行 + 时间线 + 分类可视化。",
    detail: "今日/本周/本月总览与对比、应用排行（总时长/活跃时长）、每日甘特时间线、应用自动分类与自定义正则规则、AFK 离开检测。额度模块重构为供应商注册表架构，多账户与额外修复。",
  },
  {
    version: "v0.5.2",
    date: "2026-08-25",
    highlight: false,
    color: "text-blue-400",
    colorBg: "bg-blue-500/15",
    tag: "perf",
    summary: "内存与启动性能优化，启动速度与占用明显改善。",
    detail: "",
  },
  {
    version: "v0.5.1",
    date: "2026-08-24",
    highlight: false,
    color: "text-amber-400",
    colorBg: "bg-amber-500/15",
    tag: "fix",
    summary: "修复更新器签名校验问题，自动更新链路跑通并稳定。",
    detail: "",
  },
  {
    version: "v0.5.0",
    date: "2026-08-24",
    highlight: false,
    color: "text-cyan-400",
    colorBg: "bg-cyan-500/15",
    tag: "updater",
    summary: "支持内建自动更新：设置页按钮 + 启动检查 + 签名校验 + GitHub Releases 分发。",
    detail: "",
  },
  {
    version: "v0.4.5",
    date: "2026-08-21",
    highlight: false,
    color: "text-violet-400",
    colorBg: "bg-violet-500/15",
    tag: "search",
    summary: "文件搜索模块升级：内置「已安装应用中心」，点击即启动，前台频率排序。",
    detail: "搜索时匹配的应用置顶显示，Everything 检索与本地应用扫描无缝联动。",
  },
];

export function Changelog() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHead eyebrow="更新日志" title="持续更新" sub="小步快跑，每个版本都解决真实问题。" />
          <a href={RELEASES} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400 hover:text-emerald-300">
            完整更新日志 <ArrowRight className="size-4" />
          </a>
        </div>
      </Reveal>

      <div className="mt-10 space-y-0 border-l-2 border-white/10 pl-6">
        {LOG.map((item, i) => (
          <Reveal key={item.version} delay={i * 0.06}>
            <div className="relative pb-8 last:pb-0">
              <span className={`absolute -left-[35px] top-1.5 size-3 rounded-full border-2 ${item.highlight ? "border-emerald-500 bg-emerald-500" : "border-zinc-600 bg-zinc-900"}`} />
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 transition-colors hover:border-emerald-500/20">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`font-display font-bold ${item.color}`}>{item.version}</span>
                  {item.date && <span className="font-mono text-xs text-zinc-500">{item.date}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${item.colorBg} ${item.color}`}>{item.tag}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">{item.summary}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{item.detail}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
