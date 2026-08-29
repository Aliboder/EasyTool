export function RealQuotaSettings() {
  return (
    <div className="flex h-[480px] w-full max-w-xl flex-col overflow-hidden rounded-2xl border-2 border-white/10 bg-zinc-900 font-sans text-zinc-100 shadow-2xl shadow-black/40">
      {/* header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <span className="text-sm font-semibold">设置</span>
        <span className="text-[10px] text-zinc-500">额度监控</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarColor: "rgba(255,255,255,0.1) transparent", scrollbarWidth: "thin" }}>
        {/* card 1: account management */}
        <div className="rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">账户管理</span>
            <span className="rounded-md border border-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-400">+ 添加</span>
          </div>

          <div className="mt-3 space-y-2">
            <div className="rounded-lg border border-white/5 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">DeepSeek</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">DeepSeek</span>
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-400">已配置</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 rounded-md border border-white/5 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-500">sk-****…****3f7a</div>
                <button className="rounded border border-white/10 px-2 py-1 text-[9px] text-zinc-500 hover:text-zinc-300">测试</button>
              </div>
            </div>
            <div className="rounded-lg border border-white/5 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">OpenCode Go</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">Go</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 rounded-md border border-white/5 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-500">未配置</div>
              </div>
            </div>
          </div>
        </div>

        {/* card 2: monitoring */}
        <div className="rounded-xl border border-white/10 p-4">
          <span className="text-xs font-semibold text-zinc-300">监控</span>

          <div className="mt-3 space-y-3">
            {[
              { label: "刷新间隔", value: "30 秒" },
              { label: "预警阈值", value: "¥10.00" },
              { label: "紧急阈值", value: "¥5.00" },
            ].map((s) => (
              <div key={s.label} className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">{s.label}</span>
                <span className="rounded-md border border-white/5 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400">{s.value}</span>
              </div>
            ))}

            {[
              { label: "余额不足通知", on: true },
              { label: "消费突增通知", on: true },
            ].map((s) => (
              <div key={s.label} className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">{s.label}</span>
                <div className={`w-8 h-4.5 rounded-full transition-colors ${s.on ? "bg-emerald-500" : "bg-zinc-700"}`}>
                  <div className={`size-3.5 rounded-full bg-white shadow transition-transform ${s.on ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
