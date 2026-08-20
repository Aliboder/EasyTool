import { Link } from "react-router-dom";
import { ArrowUpRight, Download, KeyRound, HardDrive, Boxes, Lock } from "lucide-react";
import BlurText from "@/components/bits/BlurText";
import Reveal from "@/components/reveal";
import { modules, about } from "@/data/modules";

function SectionHeader({
  no,
  title,
  en,
  lead,
}: {
  no: string;
  title: string;
  en: string;
  lead: string;
}) {
  return (
    <Reveal className="mb-12">
      <div className="flex items-baseline justify-between border-b-2 border-ink pb-3">
        <p className="kicker">{no} · {en}</p>
      </div>
      <h2 className="mt-5 font-display text-4xl font-bold text-ink md:text-5xl">{title}</h2>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-2">{lead}</p>
    </Reveal>
  );
}

export default function Home() {
  return (
    <div>
      {/* HERO */}
      <section className="border-b border-rule">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 md:grid-cols-12 md:py-28">
          <div className="md:col-span-8">
            <p className="kicker mb-6">EasyTool · Windows 效率工具箱 · Vol.01</p>
            <BlurText
              text="一个工具箱，装下日常的一切重复。"
              animateBy="characters"
              delay={40}
              direction="top"
              as="h1"
              className="font-display text-5xl font-bold leading-tight tracking-tight text-ink md:text-7xl"
            />
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-ink-2">
              剪贴板历史、AI 额度监控、表情面板、Everything 文件秒搜。
              <br className="hidden md:block" />
              单应用 + 模块注册表架构，本地优先，随用随装。
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <a
                href={about.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 bg-ink px-6 py-3 text-sm font-medium text-paper transition-colors hover:bg-ultra"
              >
                <Download className="size-4" />
                下载安装包
              </a>
              <a
                href="#modules"
                className="inline-flex items-center gap-2 border border-ink px-6 py-3 text-sm font-medium text-ink transition-colors hover:border-ultra hover:text-ultra"
              >
                浏览模块
                <ArrowUpRight className="size-4" />
              </a>
            </div>
          </div>
          <aside className="md:col-span-4 md:pl-8">
            <dl className="border-l-2 border-ultra pl-5 text-sm">
              {[
                ["版本", about.version],
                ["许可", about.license],
                ["测试", about.tests],
                ["平台", "Windows 10 / 11 x64"],
                ["主面板热键", about.mainHotkey],
              ].map(([k, v]) => (
                <div key={k} className="mb-4 flex items-baseline justify-between gap-4">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="num font-mono text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </section>

      {/* MODULES INDEX */}
      <section id="modules" className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHeader
            no="01"
            en="Modules"
            title="四大模块"
            lead="每个模块独立启停、独立配置、独立呼出；扩展新功能只需新增一个模块目录，不动其他部分。"
          />
          <div className="grid gap-px bg-rule md:grid-cols-2">
            {modules.map((m) => (
              <Reveal
                key={m.id}
                as="div"
                className="group bg-paper p-8 transition-colors hover:bg-paper-2"
              >
                <Link to={m.path} className="flex h-full flex-col">
                  <div className="flex items-center justify-between">
                    <span className="num font-display text-6xl font-bold text-rule transition-colors group-hover:text-ultra md:text-7xl">
                      {m.no}
                    </span>
                    <m.icon className="size-7 text-ink-3 transition-colors group-hover:text-ultra" />
                  </div>
                  <h3 className="mt-6 font-display text-2xl font-bold text-ink">{m.name}</h3>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-2">{m.oneLine}</p>
                  <span className="mt-6 inline-flex items-center gap-1 text-sm text-ultra">
                    查看模块
                    <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ARCHITECTURE */}
      <section className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHeader
            no="02"
            en="Architecture"
            title="不是小工具集合，是可扩展的框架"
            lead="单应用 + 模块注册表：主程序是壳，功能是模块。模块可以独立启停、排序、配置，也能像插件一样不断新增。"
          />
          <div className="grid gap-px bg-rule md:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Boxes, t: "模块注册表", d: "新增功能 = 新增模块目录 + manifest，不触碰其他模块。" },
              { icon: HardDrive, t: "本地优先", d: "数据存于本地 SQLite（WAL），不依赖任何第三方服务器。" },
              { icon: Lock, t: "密钥加密", d: "API 密钥进 Windows 凭据库，每账户独立槽位，绝不落盘明文。" },
              { icon: KeyRound, t: "全局热键", d: "一套呼出体系：统一面板 Ctrl+Shift+E，各模块独立热键。" },
            ].map((f, i) => (
              <Reveal key={f.t} as="div" className="bg-paper p-7">
                <f.icon className="size-6 text-ultra" />
                <h3 className="mt-4 font-display text-lg font-bold text-ink">{f.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{f.d}</p>
                <p className="kicker mt-6 num">{String(i + 1).padStart(2, "0")}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* HOTKEYS */}
      <section className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHeader
            no="03"
            en="Hotkeys"
            title="一手键盘，随叫随到"
            lead="热键支持录制式设置：按下想用的组合键即可录入，不必记一串默认值。"
          />
          <Reveal>
            <div className="border-2 border-ink">
              <div className="grid grid-cols-2 gap-px bg-rule text-sm md:grid-cols-5">
                <div className="bg-paper p-4 font-medium text-ink-3">功能</div>
                <div className="hidden bg-paper p-4 font-medium text-ink-3 md:block">热键</div>
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="hidden bg-paper p-4 font-medium text-ink-3 md:block">
                    {""}
                  </div>
                ))}
                <div className="hidden bg-paper p-4 font-medium text-ink-3 md:block">{""}</div>
              </div>
              <div className="grid grid-cols-2 gap-px bg-rule text-sm md:grid-cols-5">
                <div className="bg-paper p-4">主面板（统一呼出）</div>
                <div className="num bg-paper p-4 font-mono text-ultra">{about.mainHotkey}</div>
                {["剪贴板弹窗", "表情弹窗", "搜索弹窗"].map((n, i) => {
                  const m = modules[i];
                  return (
                    <div key={n} className="contents">
                      <div className="bg-paper p-4">{n}</div>
                      <div className="num bg-paper p-4 font-mono text-ultra">{m.hotkey}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-3">
              关闭「统一呼出主窗口」后，剪贴板 / 表情 / 搜索各自热键直接呼出对应弹窗；主面板改由托盘呼出。
            </p>
          </Reveal>
        </div>
      </section>

      {/* INSTALL */}
      <section className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHeader
            no="04"
            en="Install"
            title="双击安装，托盘常驻"
            lead="NSIS 安装包，无需管理员权限。关闭主窗口即最小化到托盘，数据卸载重装不丢失。"
          />
          <div className="grid gap-8 md:grid-cols-3">
            <Reveal as="div" className="border border-rule p-7">
              <span className="num font-display text-4xl font-bold text-ultra">1</span>
              <h3 className="mt-3 font-display text-lg font-bold text-ink">下载安装包</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">
                从 GitHub Releases 下载 EasyTool 安装程序，双击完成安装。
              </p>
              <a href={about.releaseUrl} target="_blank" rel="noreferrer" className="underline-mag mt-4 inline-block text-sm text-ultra">
                前往 Releases →
              </a>
            </Reveal>
            <Reveal as="div" className="border border-rule p-7">
              <span className="num font-display text-4xl font-bold text-ultra">2</span>
              <h3 className="mt-3 font-display text-lg font-bold text-ink">配置密钥与热键</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">
                设置页为各模块配置 API 密钥、热键与偏好；密钥存入系统凭据库。
              </p>
            </Reveal>
            <Reveal as="div" className="border border-rule p-7">
              <span className="num font-display text-4xl font-bold text-ultra">3</span>
              <h3 className="mt-3 font-display text-lg font-bold text-ink">选装 Everything</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">
                文件搜索依赖 Everything（免费 / MIT）。安装它，全盘搜索即刻可用。
              </p>
            </Reveal>
          </div>
          <Reveal as="div" className="mt-10 border-t border-rule pt-6">
            <p className="kicker mb-3">数据位置</p>
            <p className="num break-all font-mono text-sm text-ink-2">{about.dataDir}</p>
          </Reveal>
        </div>
      </section>

      {/* OPEN SOURCE */}
      <section>
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHeader
            no="05"
            en="Open Source"
            title="开源，且可以自由扩展"
            lead={`${about.version} · ${about.license} 许可 · ${about.tests}。桌面端 Tauri 2 + Rust，界面 React 19 + TypeScript + Tailwind。`}
          />
          <Reveal as="div" className="flex flex-wrap items-center gap-2">
            {about.stack.map((s) => (
              <span key={s} className="border border-rule px-3 py-1.5 font-mono text-sm text-ink-2">
                {s}
              </span>
            ))}
          </Reveal>
          <Reveal as="div" className="mt-10">
            <a
              href={about.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-ink px-6 py-3 text-sm font-medium text-paper transition-colors hover:bg-ultra"
            >
              在 GitHub 查看源码
              <ArrowUpRight className="size-4" />
            </a>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
