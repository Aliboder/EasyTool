import { Database, KeyRound, ServerOff } from "lucide-react";
import { Reveal } from "./reveal";

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

export function LocalData() {
  return (
    <section className="border-y border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
        <Reveal>
          <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            数据只属于你
          </h2>
          <p className="mt-4 max-w-[46ch] leading-relaxed text-zinc-600 dark:text-zinc-400">
            你的每一条复制记录、每一笔消费历史，都落在下面这个文件夹里——删了就是真没了。
          </p>

          <div className="mt-8 space-y-5">
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
          <div className="overflow-x-auto rounded-2xl bg-zinc-900 p-6 font-mono text-xs leading-loose shadow-lg shadow-zinc-900/10 dark:bg-black dark:shadow-black/40">
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
    </section>
  );
}
