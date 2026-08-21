import { ArrowRight } from "lucide-react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

const RELEASES = "https://github.com/Aliboder/EasyTool/releases";

const LOG = [
  {
    version: "v0.4.5",
    date: "2026-08-21",
    highlight: true,
    color: "text-emerald-400",
    colorBg: "bg-emerald-500/15",
    tag: "latest",
    summary: "新增快速启动模块：应用/文件/文件夹/网址快捷方式，拖拽排序 + 分组管理。",
    detail: "支持网格/列表双视图、格子大小可调（48-96px）、右键菜单、剪贴板粘贴路径添加、文件拖入添加。SQLite 存储，排序方式可选（手动/名称/创建时间）。",
  },
  {
    version: "v0.4.4",
    date: "2026-08-20",
    highlight: false,
    color: "text-blue-400",
    colorBg: "bg-blue-500/15",
    tag: "emoji",
    summary: "表情支持 SendInput 直输，不污染剪贴板历史；收藏夹 Tab 置顶并默认打开。",
    detail: "剪贴板自写守卫从 300ms 加固到 2s，覆盖写入→Ctrl+V→目标应用改写完整链路；focus 刷新防抖 150ms + loadCatalog 并发合并，修复呼出时焦点风暴导致冻结。",
  },
  {
    version: "v0.4.3",
    date: "",
    highlight: false,
    color: "text-amber-400",
    colorBg: "bg-amber-500/15",
    tag: "fix",
    summary: "窗口拖动标题栏时不再消失，启动闪默认尺寸问题修复。",
    detail: "拖动标题栏窗口首次消失是 WebView2 在 Windows 下的已知竞态；尺寸恢复不准源于隐藏/最小化时 WebView2 报 0x0 尺寸，现增加最小尺寸校验。",
  },
  {
    version: "v0.4.2",
    date: "",
    highlight: false,
    color: "text-cyan-400",
    colorBg: "bg-cyan-500/15",
    tag: "perf",
    summary: "表情模块切回不再卡顿 200ms+；剪贴板新增内容指纹比对防误记。",
    detail: "emoji 切回改为窗口 focus 刷新（不重载）、共享 canvas 分片检测 + localStorage 防抖；剪贴板对自身写入登记指纹，监听比对一致+窗口内则跳过。",
  },
  {
    version: "v0.4.1",
    date: "",
    highlight: false,
    color: "text-violet-400",
    colorBg: "bg-violet-500/15",
    tag: "audit",
    summary: "全量代码审查修复：锁外网络请求、热键解析缓存、图片编码优化。",
    detail: "涵盖 H1 quota 锁外网络请求 / H2 非统一主热键 / M1 剪贴板图片编码锁外化 / M2 搜索防抖 / M3 热键 unregister_all bug / M4 热键解析缓存 / L1 emoji 异步检测等 7 项。",
  },
];

export function Changelog() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHead no="07" title="持续更新" sub="小步快跑，每个版本都解决真实问题。" />
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
