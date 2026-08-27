import { Plus, Trash2 } from "lucide-react";
import type { EasyaskConfig, EasyaskProvider } from "./config";

// 纯受控组件：输入直连 onUpdate（useModuleConfig 防抖落盘），不持有本地状态副本
export function EasyaskSettings({
  cfg,
  onUpdate,
}: {
  cfg: EasyaskConfig;
  onUpdate: (patch: Partial<EasyaskConfig>) => void;
}) {
  const providers = cfg.providers ?? [];

  const updateProvider = (id: string, patch: Partial<EasyaskProvider>) => {
    onUpdate({ providers: providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  };

  const addProvider = () => {
    onUpdate({
      providers: [
        ...providers,
        { id: crypto.randomUUID(), name: `AI ${providers.length + 1}`, url: "https://" },
      ],
    });
  };

  const removeProvider = (id: string) => {
    const rest = providers.filter((p) => p.id !== id);
    onUpdate({
      providers: rest,
      activeProvider: cfg.activeProvider === id ? (rest[0]?.id ?? null) : cfg.activeProvider,
    });
  };

  return (
    <div className="space-y-2">
      {providers.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <input
            value={p.name}
            onChange={(e) => updateProvider(p.id, { name: e.target.value })}
            placeholder="名称"
            className="w-24 shrink-0 rounded-md border bg-transparent px-2 py-1 text-xs outline-none focus:border-primary"
          />
          <input
            value={p.url}
            onChange={(e) => updateProvider(p.id, { url: e.target.value })}
            placeholder="对话网页地址，如 chat.deepseek.com"
            className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-xs outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => removeProvider(p.id)}
            title="删除"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addProvider}
        className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors hover:bg-accent"
      >
        <Plus className="size-3.5" /> 添加 AI
      </button>
      <p className="text-xs leading-relaxed text-muted-foreground">
        顶栏每个标签对应一个对话网页。首次使用需在对话窗口内登录一次，登录状态会长期保持（Cookie
        存在 EasyTool 自己的数据目录，与系统浏览器互不影响）。
      </p>
    </div>
  );
}
