import { Check, Database, KeyRound, ServerOff, X } from "lucide-react";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

const PROMISES = [
  {
    icon: Database,
    title: "本机 SQLite 存储",
    body: "历史与配置存在本机 SQLite（WAL 模式），读写快、断电不坏库。",
  },
  {
    icon: KeyRound,
    title: "密钥进系统凭据管理器",
    body: "API 密钥只存 Windows 凭据管理器，每个账户独立槽位，互不串用。",
  },
  {
    icon: ServerOff,
    title: "无服务器、无遥测",
    body: "EasyTool 没有自建服务器，也不需要注册账号，数据不出你的电脑。",
  },
];

const TREE: [string, string][] = [
  ["config.json", "应用配置"],
  ["clipboard.db", "剪贴板历史 · SQLite WAL"],
  ["images\\", "图片原文"],
  ["thumbs\\", "缩略图缓存"],
  ["balance_history_*.json", "额度消费历史（按账户分文件）"],
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
    <section className="border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <Reveal>
          <SectionHead no="06" title="数据只属于你" sub="你的每一条复制记录、每一笔消费历史，都落在下面这个文件夹里——删了就是真没了。" />
        </Reveal>

        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          {/* left: promises + tree */}
          <div>
            <Reveal>
              <div className="space-y-5">
                {PROMISES.map((p) => (
                  <div key={p.title} className="flex gap-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                      <p.icon className="size-4.5" />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold">{p.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                        {p.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal delay={0.1}>
              <div className="mt-8 overflow-x-auto rounded-2xl bg-zinc-900 p-6 font-mono text-xs leading-loose shadow-lg shadow-zinc-900/10 dark:bg-black dark:shadow-black/40">
                <p className="text-emerald-400">%APPDATA%\com.aliboder.easytool\</p>
                {TREE.map(([name, comment], i) => (
                  <p key={name} className="whitespace-nowrap text-zinc-300">
                    <span className="text-zinc-600">{i === TREE.length - 1 ? "└─" : "├─"}</span>{" "}
                    <span className="text-zinc-100">{name}</span>
                    <span className="text-zinc-500">　{comment}</span>
                  </p>
                ))}
              </div>
            </Reveal>
          </div>

          {/* right: comparison table */}
          <Reveal delay={0.08}>
            <div className="rounded-2xl border-2 border-zinc-200 dark:border-zinc-800">
              <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
                <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  EasyTool vs. 云端工具
                </h3>
              </div>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {COMPARE.map((row) => (
                  <div key={row.feature} className="flex items-center gap-4 px-5 py-3 text-sm">
                    <span className="min-w-[120px] text-zinc-500 dark:text-zinc-400">{row.feature}</span>
                    <span className="flex min-w-[100px] items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                      {typeof row.easytool === "boolean" ? (
                        row.easytool ? <Check className="size-4" /> : <X className="size-4 text-zinc-300 dark:text-zinc-600" />
                      ) : (
                        <>{row.easytool}</>
                      )}
                    </span>
                    <span className="flex min-w-[100px] items-center gap-1.5 text-zinc-400 dark:text-zinc-500">
                      {typeof row.cloud === "boolean" ? (
                        row.cloud ? <Check className="size-4" /> : <X className="size-4 text-zinc-300 dark:text-zinc-600" />
                      ) : (
                        <>{row.cloud}</>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 border-t border-zinc-200 px-5 py-2 dark:border-zinc-800">
                <span className="min-w-[120px] text-xs text-zinc-400 dark:text-zinc-500" />
                <span className="min-w-[100px] text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  EasyTool
                </span>
                <span className="min-w-[100px] text-center text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  云端工具
                </span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
