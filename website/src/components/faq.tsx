import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Reveal } from "./reveal";

const REPO = "https://github.com/Aliboder/EasyTool";

const link = (href: string, text: string) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="font-medium text-emerald-600 underline underline-offset-2 dark:text-emerald-400"
  >
    {text}
  </a>
);

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "EasyTool 收费吗？",
    a: "不收费。MIT 许可证，个人和商业使用均无限制，没有内购、没有广告、没有账号体系。",
  },
  {
    q: "我的数据会被上传吗？",
    a: "不会。所有历史与配置都存在本机 SQLite，API 密钥只进 Windows 凭据管理器。EasyTool 没有自建服务器，也不收集任何遥测数据。",
  },
  {
    q: "为什么文件搜索需要单独安装 Everything？",
    a: "EasyTool 直接调用 Everything 的 NTFS 索引引擎，毫秒级返回全盘文件名，而不是自己重复造一个慢索引。Everything 同样免费开源（MIT），安装一次即可。",
  },
  {
    q: "支持 macOS 或 Linux 吗？",
    a: "目前仅支持 Windows 10 / 11 x64。剪贴板监听、全局热键、表情直输都深度依赖 Win32 API，暂无跨平台计划。",
  },
  {
    q: "如何参与贡献？",
    a: (
      <>
        欢迎在 GitHub 提交 {link(`${REPO}/issues`, "Issue")} 反馈问题，或直接提{" "}
        {link(`${REPO}/pulls`, "PR")}。想开发自己的功能模块，先读{" "}
        {link(`${REPO}/blob/master/docs/module-guide.md`, "模块开发指南")}
        ——一个 manifest 加两个文件即可接入。
      </>
    ),
  },
];

export function Faq() {
  return (
    <section className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
        <Reveal>
          <h2 className="text-center font-display text-3xl font-bold tracking-tight md:text-4xl">
            常见问题
          </h2>
        </Reveal>

        <div className="mt-10 space-y-3">
          {QA.map((item, i) => (
            <Reveal key={item.q} delay={i * 0.05}>
              <details className="group rounded-2xl border border-zinc-200 bg-white transition-shadow open:shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
                  <span className="text-sm font-medium">{item.q}</span>
                  <ChevronDown className="size-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {item.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
