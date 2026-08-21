import { Github } from "lucide-react";

const REPO = "https://github.com/Aliboder/EasyTool";

export function Footer() {
  return (
    <footer className="border-t border-white/5 bg-zinc-950">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          {/* brand */}
          <div>
            <p className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
              <span className="inline-block size-2.5 rounded-[4px] bg-emerald-500" />
              EASYTOOL
            </p>
            <p className="mt-2 max-w-[280px] text-sm leading-relaxed text-zinc-500">
              Windows 效率工具箱——剪贴板历史、AI 额度监控、表情面板、文件秒搜、快速启动。本地优先，开源免费。
            </p>
            <div className="mt-4 flex items-center gap-3">
              <a href={REPO} target="_blank" rel="noreferrer" className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-white">
                <Github className="size-4" />
              </a>
              <span className="text-xs text-zinc-600">MIT License · v0.4.5</span>
            </div>
          </div>

          {/* product */}
          <div>
            <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-zinc-400">产品</h4>
            <ul className="mt-3 space-y-2 text-sm text-zinc-500">
              <li><a href="#modules" className="transition-colors hover:text-white">功能模块</a></li>
              <li><a href="#hotkeys" className="transition-colors hover:text-white">快捷键</a></li>
              <li><a href="#screenshots" className="transition-colors hover:text-white">界面预览</a></li>
              <li><a href={`${REPO}/releases`} target="_blank" rel="noreferrer" className="transition-colors hover:text-white">下载安装</a></li>
            </ul>
          </div>

          {/* developers */}
          <div>
            <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-zinc-400">开发者</h4>
            <ul className="mt-3 space-y-2 text-sm text-zinc-500">
              <li><a href={REPO} target="_blank" rel="noreferrer" className="transition-colors hover:text-white">GitHub 仓库</a></li>
              <li><a href={`${REPO}/blob/master/docs/module-guide.md`} target="_blank" rel="noreferrer" className="transition-colors hover:text-white">模块开发指南</a></li>
              <li><a href={`${REPO}/issues`} target="_blank" rel="noreferrer" className="transition-colors hover:text-white">提交 Issue</a></li>
              <li><a href={`${REPO}/pulls`} target="_blank" rel="noreferrer" className="transition-colors hover:text-white">提交 PR</a></li>
            </ul>
          </div>

          {/* tech */}
          <div>
            <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-zinc-400">技术</h4>
            <ul className="mt-3 space-y-2 text-sm text-zinc-500">
              <li>Tauri 2 + Rust</li>
              <li>React 19 + TypeScript</li>
              <li>Tailwind CSS v4</li>
              <li>SQLite WAL</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/5 pt-6">
          <p className="font-display text-[11px] text-zinc-600">
            © 2026 Aliboder · Built with Tauri + React
          </p>
          <div className="flex items-center gap-4 text-[11px] text-zinc-600">
            <a href="#top" className="transition-colors hover:text-emerald-400">回到顶部 ↑</a>
            <span>·</span>
            <a href={REPO} target="_blank" rel="noreferrer" className="transition-colors hover:text-emerald-400">GitHub</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
