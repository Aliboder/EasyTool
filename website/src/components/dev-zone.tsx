import { Blocks, Cpu, FlaskConical } from "lucide-react";
import { useState } from "react";
import {
  siRust,
  siTauri,
  siReact,
  siTypescript,
  siTailwindcss,
  siVite,
  siSqlite,
} from "simple-icons";
import { Reveal } from "./reveal";

function CopyBtn({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`border border-zinc-700 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500 transition-colors hover:border-emerald-500/50 hover:text-emerald-400 ${copied ? "!border-emerald-500 !bg-emerald-500/20 !text-emerald-400" : ""} ${className}`}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

const REPO = "https://github.com/Aliboder/EasyTool";

const TECHS = [siRust, siTauri, siReact, siTypescript, siTailwindcss, siVite, siSqlite];

const HIGHLIGHTS = [
  {
    icon: FlaskConical,
    title: "116+ 后端单元测试",
    body: "去重、自写守卫、数据迁移、热键解析、重复日程展开、时长聚合等核心逻辑全覆盖；另有 48 个前端单测（纯函数双实现、双套用例）。",
  },
  {
    icon: Cpu,
    title: "Win32 原生集成",
    body: "WM_CLIPBOARDUPDATE 监听、SendInput 直输、全局热键、前台窗口钩子，全部走系统级 API。",
  },
  {
    icon: Blocks,
    title: "模块注册表架构",
    body: "一个 manifest.json 声明模块，壳 UI 自动识别，即插即用，互不侵入。",
  },
];

const TERMINAL = [
  { text: "git clone https://github.com/Aliboder/EasyTool.git", prompt: true },
  { text: "cd EasyTool", prompt: true },
  { text: "npm install", prompt: true },
  { text: "# 需要 Rust 工具链与 Node.js", comment: true },
  { text: "npm run tauri dev", prompt: true },
];

export function DevZone() {
  return (
    <section className="bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <Reveal>
          <p className="font-display text-xs uppercase tracking-[0.2em] text-emerald-400">
            Open Source · MIT
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-4xl">
            为开发者而建
          </h2>
          <p className="mt-3 max-w-[52ch] leading-relaxed text-zinc-400">
            整个项目开源在 GitHub 上，每一行代码都可以审阅、修改、重新分发。
          </p>
        </Reveal>

        <div className="mt-12 grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
          <Reveal>
            <div className="flex flex-wrap items-center gap-x-7 gap-y-4 opacity-90">
              {TECHS.map((s) => (
                <svg
                  key={s.slug}
                  viewBox="0 0 24 24"
                  role="img"
                  aria-label={s.title}
                  className="h-7 w-7"
                  fill={s.hex === "000000" ? "#a1a1aa" : `#${s.hex}`}
                >
                  <path d={s.path} />
                </svg>
              ))}
            </div>

            <p className="mt-6 text-sm leading-relaxed text-zinc-400">
              Tauri 2 + Rust 后端，React 19 + Tailwind v4 前端；SQLite WAL
              本地存储，系统凭据管理器管密钥。没有魔法依赖，clone 下来就能跑。
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-black shadow-xl shadow-black/40">
              <div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-3">
                <span className="size-2.5 rounded-full bg-zinc-700" />
                <span className="size-2.5 rounded-full bg-zinc-700" />
                <span className="size-2.5 rounded-full bg-emerald-500/70" />
                <span className="ml-2 font-display text-xs text-zinc-500">terminal</span>
                <CopyBtn
                  text={TERMINAL.filter((l) => !l.comment).map((l) => l.text).join("\n")}
                  className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
                />
              </div>
              <div className="space-y-2 p-5 font-mono text-xs leading-relaxed sm:text-sm">
                {TERMINAL.map((line, i) => {
                  const isLast = i === TERMINAL.length - 1;
                  return (
                    <p key={i} className={`whitespace-nowrap ${line.comment ? "text-zinc-500" : "text-zinc-200"}`}>
                      {line.prompt && <span className="mr-2 text-emerald-400">$</span>}
                      {line.text}
                      {isLast && <span className="caret" />}
                    </p>
                  );
                })}
              </div>
            </div>
          </Reveal>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {HIGHLIGHTS.map((h, i) => (
            <Reveal key={h.title} delay={i * 0.06}>
              <div className="h-full rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
                <h.icon className="size-5 text-emerald-400" />
                <h3 className="mt-3 font-display font-semibold">{h.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{h.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.15}>
          <p className="mt-10 text-center text-sm text-zinc-400">
            发现 Bug？有新想法？欢迎{" "}
            <a href={`${REPO}/issues`} target="_blank" rel="noreferrer" className="font-medium text-emerald-400 underline underline-offset-4 hover:text-emerald-300">
              提交 Issue
            </a>{" "}
            或直接{" "}
            <a href={REPO} target="_blank" rel="noreferrer" className="font-medium text-emerald-400 underline underline-offset-4 hover:text-emerald-300">
              提 PR
            </a>
            。想写自己的模块？先读{" "}
            <a href={`${REPO}/blob/master/docs/module-guide.md`} target="_blank" rel="noreferrer" className="font-medium text-emerald-400 underline underline-offset-4 hover:text-emerald-300">
              模块开发指南
            </a>
            。
          </p>
        </Reveal>
      </div>
    </section>
  );
}
