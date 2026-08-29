import { motion, useReducedMotion } from "motion/react";
import {
  BellRing,
  CalendarDays,
  Clock,
  ClipboardList,
  Copy,
  FileUp,
  FolderOpen,
  Gauge,
  History,
  ImageDown,
  Languages,
  Layers,
  Move,
  Palette,
  Repeat,
  Search,
  SearchCode,
  SearchX,
  Send,
  ShieldAlert,
  Smile,
  SortAsc,
  Sparkles,
  StickyNote,
  TimerOff,
  WandSparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

type Feature = { icon: LucideIcon; text: string };

type ModuleInfo = {
  id: string;
  name: string;
  tagline: string;
  desc: string;
  features: Feature[];
  meta: string[];
  accent: string;
};

const MODULES: ModuleInfo[] = [
  {
    id: "clipboard",
    name: "剪贴板历史",
    tagline: "复制过的一切，随时找回",
    desc: "监听系统剪贴板，文本、图片、文件自动入历史。固定、拖拽、搜索、备注，跟手粘贴不打断工作流。",
    features: [
      { icon: Layers, text: "上限 500 条，内容指纹去重，按天分组（今日 / 昨天 / 日期头 + 计数）" },
      { icon: Copy, text: "「粘贴为纯文本」开关与右键复制纯文本，去格式一键完成" },
      { icon: SearchX, text: "空格分词搜索，多关键词全部命中并逐处高亮" },
      { icon: StickyNote, text: "条目备注、固定排序、使用过的记录自动置顶为最新" },
      { icon: ImageDown, text: "「列表模式」统一文本/图片/文件单行展示；图片降采样 2048 + 256 缩略图" },
    ],
    meta: ["跟手粘贴", "SQLite", "WM_CLIPBOARDUPDATE"],
    accent: "text-emerald-400",
  },
  {
    id: "quota",
    name: "额度监控",
    tagline: "AI 花销，心里有数",
    desc: "多账户额度与消费趋势，阈值告警直接弹 Windows 通知；消费突增自动提醒。",
    features: [
      { icon: Gauge, text: "DeepSeek / OpenCode Go 多账户，独立密钥与余额" },
      { icon: Move, text: "账户卡片自由拖拽排序，保存后密钥回显（掩码 / 明文切换）" },
      { icon: BellRing, text: "预警 + 紧急双阈值，跌破即弹系统通知（Toast）" },
      { icon: ShieldAlert, text: "消费突增检测：单日消费超近 7 天日均 3 倍时提醒" },
      { icon: History, text: "每账户 5000 条余额历史 + Go 用量周期自动追踪" },
    ],
    meta: ["后台轮询", "多账户", "凭据管理器", "reqwest"],
    accent: "text-cyan-400",
  },
  {
    id: "emoji",
    name: "表情面板",
    tagline: "1900+ 表情，一按即出",
    desc: "分类浏览、最近使用、收藏置顶、多语言搜索；文本表情直输不污染剪贴板，支持自定义图片表情。",
    features: [
      { icon: Sparkles, text: "最近使用区 + 收藏置顶，高频表情一步直达" },
      { icon: Languages, text: "中文名 / 英文名 / shortcode 三种方式搜索" },
      { icon: Send, text: "文本表情经 SendInput 直输，不写剪贴板、不打断粘贴" },
      { icon: ImageDown, text: "系统字体优先渲染，缺字形自动 Twemoji 兜底" },
      { icon: FolderOpen, text: "导入本地图片做自定义表情，分组管理" },
    ],
    meta: ["SendInput", "Twemoji", "自定义表情"],
    accent: "text-amber-400",
  },
  {
    id: "search",
    name: "文件秒搜",
    tagline: "全盘文件，输入即达",
    desc: "Everything NTFS 索引引擎毫秒返回；内置已安装应用中心，频率排序、一键启动、可置顶。",
    features: [
      { icon: Search, text: "Everything 引擎，文件名毫秒级返回（需装 Everything）" },
      { icon: SortAsc, text: "「应用」Tab = 应用中心：按使用频率排序，可右键置顶 / 打开位置" },
      { icon: SearchCode, text: "正则、大小写、全字、路径匹配随意组合" },
      { icon: History, text: "搜索历史记录与一键清空" },
      { icon: Copy, text: "复制路径自动进入剪贴板历史，跨模块联动" },
    ],
    meta: ["Everything", "DLL", "应用中心"],
    accent: "text-blue-400",
  },
  {
    id: "timetracker",
    name: "时长统计",
    tagline: "时间花在哪，一目了然",
    desc: "自动记录前台软件使用时长，多维度排行 + 甘特时间线 + 自动分类，数据全部本地。",
    features: [
      { icon: Clock, text: "今日 / 本周 / 本月总览，昨日对比" },
      { icon: SortAsc, text: "应用排行：总时长 + 活跃时长双维度" },
      { icon: Layers, text: "每日甘特时间线，翻看任意一天分布" },
      { icon: WandSparkles, text: "自动分类 + 自定义正则规则，规则变更存量自动重分类" },
      { icon: TimerOff, text: "AFK 离开剔除，播放音频（视频/直播/音乐）不计挂机" },
    ],
    meta: ["SQLite", "Win32 钩子", "WASAPI"],
    accent: "text-violet-400",
  },
  {
    id: "calendar",
    name: "日程表",
    tagline: "事件、待办，一个日历全装下",
    desc: "日/周/月/时间线/待办五视图，重复规则与「仅此一次」例外，按课程自动配色，到点系统提醒；.ics 导入导出与外部订阅，数据全部本地。",
    features: [
      { icon: CalendarDays, text: "日 / 周 / 月 / 时间线 / 待办五视图，平滑切换动画，窗口随内容自适应" },
      { icon: Repeat, text: "重复规则：每天 / 每周多选 / 每月同日 / 第 N 个星期几，可设截止与「仅此一次」例外" },
      { icon: Palette, text: "按课程名自动分配稳定配色，课程一键聚焦，课表一眼扫清" },
      { icon: BellRing, text: "事件提前提醒 + 待办逾期提醒，单个事件可单独覆盖" },
      { icon: FileUp, text: ".ics 导入导出（保留重复规则与例外）+ JSON 全量备份 + 外部日历只读订阅" },
    ],
    meta: ["RRULE", "calendar.db", "系统通知"],
    accent: "text-rose-400",
  },
];

export function DeepDive() {
  const reduce = useReducedMotion();

  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead
          eyebrow="模块深潜"
          title="每个模块，都有真功夫"
          sub="特性清单直接来自 v0.9.0 源码，没有营销话术。"
        />
      </Reveal>

      {/* 逐模块「规格单」：全宽横排，模块名左、特性右，板块间用细分隔线 */}
      <div className="mt-12">
        {MODULES.map((m, i) => (
          <Reveal key={m.id} delay={0.04}>
            <article
              id={`module-${m.id}`}
              className={`group grid scroll-mt-24 gap-6 py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-12 ${
                i > 0 ? "border-t border-white/5" : ""
              }`}
            >
              {/* 左：模块身份 */}
              <div>
                <div className="flex items-center gap-3">
                  <span className={`flex size-10 items-center justify-center rounded-xl bg-white/5 ${m.accent}`}>
                    {(() => {
                      const icons: Record<string, LucideIcon> = {
                        clipboard: ClipboardList,
                        quota: Gauge,
                        emoji: Smile,
                        search: Search,
                        timetracker: Clock,
                        calendar: CalendarDays,
                      };
                      const Icon = icons[m.id];
                      return <Icon className="size-5" />;
                    })()}
                  </span>
                  <h3 className="font-display text-xl font-bold">{m.name}</h3>
                </div>
                <p className={`mt-3 font-display text-sm font-semibold ${m.accent}`}>{m.tagline}</p>
                <p className="mt-2 max-w-[38ch] text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {m.desc}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {m.meta.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-emerald-500/15 bg-emerald-500/5 px-2.5 py-1 font-mono text-[11px] text-emerald-400/90"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* 右：特性清单 */}
              <div className="grid gap-2 sm:grid-cols-2">
                {m.features.map((f, j) => (
                  <motion.div
                    key={f.text}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-60px" }}
                    transition={{ duration: 0.3, delay: j * 0.03 }}
                    className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3.5 transition-colors hover:border-emerald-500/20"
                  >
                    <f.icon className={`mt-0.5 size-4 shrink-0 ${m.accent} opacity-80`} />
                    <span className="text-[13px] leading-snug text-zinc-300">{f.text}</span>
                  </motion.div>
                ))}
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}