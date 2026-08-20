import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Github } from "lucide-react";
import { modules, about } from "@/data/modules";
import { cn } from "@/lib/utils";

function Wordmark() {
  return (
    <Link to="/" className="flex items-baseline gap-2">
      <span className="font-display text-2xl font-bold tracking-tight text-ink">
        EasyTool
      </span>
      <span className="kicker hidden sm:inline">Windows</span>
    </Link>
  );
}

function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-paper/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Wordmark />
        <nav className="flex items-center gap-5 overflow-x-auto whitespace-nowrap text-sm">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                "underline-mag py-1",
                isActive ? "text-ultra" : "text-ink",
              )
            }
          >
            首页
          </NavLink>
          {modules.map((m) => (
            <NavLink
              key={m.id}
              to={m.path}
              className={({ isActive }) =>
                cn("underline-mag py-1", isActive ? "text-ultra" : "text-ink")
              }
            >
              {m.name}
            </NavLink>
          ))}
          <a
            href={about.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 py-1 text-ink hover:text-ultra"
            aria-label="GitHub 仓库"
          >
            <Github className="size-4" />
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-24 border-t-2 border-ink">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <p className="font-display text-3xl font-bold text-ink">EasyTool</p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-2">
              Windows 效率工具箱。剪贴板历史、AI 额度监控、表情面板、文件秒搜——单应用 + 模块注册表架构，本地优先，可自由扩展。
            </p>
            <p className="kicker mt-6">Vol.01 · v{about.version.replace("v", "")} · 2026</p>
          </div>
          <div>
            <p className="kicker mb-3">模块</p>
            <ul className="space-y-2 text-sm">
              {modules.map((m) => (
                <li key={m.id}>
                  <Link to={m.path} className="underline-mag text-ink">
                    {m.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="kicker mb-3">项目</p>
            <ul className="space-y-2 text-sm">
              <li>
                <a href={about.repoUrl} target="_blank" rel="noreferrer" className="underline-mag text-ink">
                  GitHub 仓库
                </a>
              </li>
              <li>
                <a href={about.releaseUrl} target="_blank" rel="noreferrer" className="underline-mag text-ink">
                  下载安装包
                </a>
              </li>
              <li className="text-ink-2">
                {about.license} 许可
              </li>
              <li className="text-ink-2">
                {about.platform}
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5 text-xs text-ink-3">
          <span>© 2026 EasyTool · 数据本地存储，密钥只进系统凭据库。</span>
          <span className="font-mono">Tauri 2 · Rust · React 19</span>
        </div>
      </div>
    </footer>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
