import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, RotateCw, Settings2 } from "lucide-react";
import { ModuleHeader, HeaderButton } from "@/components/module-header";
import { Drawer } from "@/components/ui/drawer";
import { EasyaskSettings } from "./Settings";
import { EASYASK_DEFAULTS } from "./config";
import { useModuleConfig } from "@/hooks/useModuleConfig";
import { toast } from "@/lib/toast";

/**
 * EasyAsk 模块页：顶栏（provider 标签快速切换）+ 容器区覆盖的子 WebView
 * 直接加载 AI 对话网页。子 WebView 是原生层，不在 DOM 里：
 * 进入本页时创建/导航 → 定位到容器 → 显示；切走时隐藏（否则盖住其他模块）。
 */
export function EasyaskPage({ active }: { active: boolean }) {
  const { cfg, update } = useModuleConfig("easyask", EASYASK_DEFAULTS);
  const [showSettings, setShowSettings] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const providers = cfg.providers ?? [];
  const activeProvider =
    providers.find((p) => p.id === (cfg.activeProvider ?? null)) ?? providers[0] ?? null;

  // 把子 WebView 定位到容器（getBoundingClientRect 逻辑像素 → 物理像素）
  const pushBounds = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    invoke("easyask_set_bounds", {
      x: Math.round(r.x * dpr),
      y: Math.round(r.y * dpr),
      w: Math.round(r.width * dpr),
      h: Math.round(r.height * dpr),
    }).catch(() => {});
  }, []);

  // 容器尺寸变化（窗口缩放等）时重定位子 WebView（防抖）
  useEffect(() => {
    if (!active) return;
    const el = containerRef.current;
    if (!el) return;
    let t: number | null = null;
    const schedule = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(pushBounds, 100);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("resize", schedule);
    return () => {
      if (t) window.clearTimeout(t);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [active, pushBounds]);

  // 进入模块页：创建/导航子 WebView → 定位 → 显示；离开：隐藏。
  // 依赖用 id 而非 url：设置里改网址不会触发导航，点标签（id 变化）才导航
  useEffect(() => {
    if (!active || !activeProvider) {
      invoke("easyask_hide").catch(() => {});
      return;
    }
    const url = activeProvider.url;
    const name = activeProvider.name;
    let cancelled = false;
    (async () => {
      try {
        await invoke("easyask_ensure_webview", { url });
        if (cancelled) return;
        pushBounds();
        await invoke("easyask_show");
      } catch (e) {
        toast(`无法打开 ${name}：${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeProvider?.id]);

  // 模块被禁用卸载时收起子 WebView
  useEffect(() => {
    return () => {
      invoke("easyask_hide").catch(() => {});
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <ModuleHeader
        title="EasyAsk"
        meta={activeProvider ? `${activeProvider.name} · AI 对话网页` : "未配置 AI"}
        actions={
          <>
            <HeaderButton
              title="刷新页面"
              onClick={() =>
                invoke("easyask_reload").catch(() =>
                  toast("对话窗口尚未打开，请先进入 EasyAsk"),
                )
              }
            >
              <RotateCw className="size-4" />
            </HeaderButton>
            <HeaderButton
              title="在浏览器打开"
              disabled={!activeProvider}
              onClick={() => {
                if (activeProvider) {
                  openUrl(activeProvider.url).catch(() =>
                    toast("打开浏览器失败"),
                  );
                }
              }}
            >
              <ExternalLink className="size-4" />
            </HeaderButton>
            <HeaderButton
              title="EasyAsk 设置"
              active={showSettings}
              onClick={() => setShowSettings((v) => !v)}
            >
              <Settings2 className="size-4" />
            </HeaderButton>
          </>
        }
        tabs={providers.map((p) => ({ id: p.id, label: p.name }))}
        activeTab={activeProvider?.id ?? ""}
        onTabChange={(id) => {
          if (providers.some((p) => p.id === id)) update({ activeProvider: id });
        }}
      />

      <div ref={containerRef} className="relative min-h-0 flex-1">
        {!activeProvider && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            还没有配置 AI 对话。打开右上角设置，添加对话网页地址。
          </div>
        )}
      </div>

      <Drawer open={showSettings} onClose={() => setShowSettings(false)} title="EasyAsk 设置">
        <EasyaskSettings cfg={cfg} onUpdate={update} />
      </Drawer>
    </div>
  );
}
