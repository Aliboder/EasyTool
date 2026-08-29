import { Check, Database, KeyRound, ServerOff, X } from "lucide-react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

const PROMISES = [
  { icon: Database, title: "本机 SQLite 存储", body: "历史与配置存在本机 SQLite（WAL 模式），读写快、断电不坏库。", color: "text-emerald-400", colorBg: "bg-emerald-500/15" },
  { icon: KeyRound, title: "密钥进系统凭据管理器", body: "API 密钥只存 Windows 凭据管理器，每个账户独立槽位，互不串用。", color: "text-blue-400", colorBg: "bg-blue-500/15" },
  { icon: ServerOff, title: "无服务器、无遥测", body: "EasyTool 没有自建服务器，也不需要注册账号，数据不出你的电脑。", color: "text-amber-400", colorBg: "bg-amber-500/15" },
];

const TREE: [string, string][] = [
  ["config.json", "应用配置 · 原子写入"],
  ["clipboard.db", "剪贴板历史 · SQLite WAL"],
  ["quota.db", "额度历史 / Go 用量周期"],
  ["apps.db", "已安装应用使用频率"],
  ["timetracker.db", "软件使用时长 · SQLite WAL"],
  ["images\\", "图片原文（最长边 ≤2048）"],
  ["thumbs\\", "256px 缩略图缓存"],
  ["easytool.log", "运行日志（自动轮转）"],
];

const COMPARE = [
  { feature: "数据存储位置", easytool: "本机 SQLite", cloud: "云端服务器" },
  { feature: "注册账号", easytool: false, cloud: true },
  { feature: "联网才能用", easytool: false, cloud: true },
  { feature: "免费使用", easytool: true, cloud: false },
  { feature: "开源代码", easytool: true, cloud: false },
  { feature: "数据可导出", easytool: true, cloud: "部分支持" },
];

export function LocalData() {
  return (
    <section id="data" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <SectionHead eyebrow="数据所有权" title="数据只属于你" sub="你的每一条复制记录、每一笔消费历史，都落在下面这个文件夹里，删了就是真没了。" />
      </Reveal>

      <div className="mt-12 grid gap-8 lg:grid-cols-2">
        {/* left: promises + tree */}
        <div className="space-y-6">
          <Reveal>
            <div className="space-y-4">
              {PROMISES.map((p) => (
                <div key={p.title} className="group flex gap-4 rounded-xl border border-white/5 bg-gradient-to-r from-white/[0.02] to-transparent p-4 transition-all hover:border-emerald-500/20">
                  <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${p.colorBg}`}>
                    <p.icon className={`size-5 ${p.color}`} />
                  </span>
                  <div>
                    <h3 className="font-display text-sm font-semibold">{p.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900 to-black p-6 font-mono text-xs leading-loose shadow-2xl shadow-black/40">
              <p className="text-emerald-400">%APPDATA%\com.aliboder.easytool\</p>
              {TREE.map(([name, comment], i) => (
                <p key={name} className="whitespace-nowrap text-zinc-300">
                  <span className="text-zinc-600">{i === TREE.length - 1 ? "└─" : "├─"}</span>{" "}
                  <span className="text-zinc-100">{name}</span>
                  <span className="text-zinc-500">　{comment}</span>
                </p>
              ))}
              <p className="mt-3 whitespace-nowrap text-zinc-600">
                ※ 旧版 balance_history_*.json 已一次性导入 quota.db，遗留文件不再写入
              </p>
            </div>
          </Reveal>
        </div>

        {/* right: comparison table */}
        <Reveal delay={0.08}>
          <div className="overflow-hidden rounded-2xl border-2 border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent">
            <div className="border-b border-white/5 px-5 py-3.5">
              <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-400">EasyTool vs. 云端工具</h3>
            </div>
            <div className="divide-y divide-white/5">
              {COMPARE.map((row) => (
                <div key={row.feature} className="flex items-center gap-4 px-5 py-3 text-sm transition-colors hover:bg-white/[0.02]">
                  <span className="min-w-[120px] text-zinc-500 dark:text-zinc-400">{row.feature}</span>
                  <span className="flex min-w-[100px] items-center gap-1.5 font-medium text-emerald-400">
                    {typeof row.easytool === "boolean" ? (
                      row.easytool ? <Check className="size-4" /> : <X className="size-4 text-zinc-600" />
                    ) : (
                      <>{row.easytool}</>
                    )}
                  </span>
                  <span className="flex min-w-[100px] items-center gap-1.5 text-zinc-500">
                    {typeof row.cloud === "boolean" ? (
                      row.cloud ? <Check className="size-4" /> : <X className="size-4 text-zinc-600" />
                    ) : (
                      <>{row.cloud}</>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 border-t border-white/5 px-5 py-2.5">
              <span className="min-w-[120px]" />
              <span className="min-w-[100px] text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-400">EasyTool</span>
              <span className="min-w-[100px] text-center text-[10px] uppercase tracking-wider text-zinc-500">云端工具</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
