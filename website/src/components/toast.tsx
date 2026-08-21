import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

type Toast = { id: number; msg: string; key?: string };

const ToastCtx = createContext<(msg: string, key?: string) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);

  const add = useCallback((msg: string, key?: string) => {
    const id = next.current++;
    setToasts((t) => [...t, { id, msg, key }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 1800);
  }, []);

  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[200] flex flex-col-reverse items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2.5 border-2 border-zinc-900 bg-emerald-500 px-4 py-2.5 font-medium text-white shadow-lg dark:border-zinc-100"
            style={{ animation: "toast-in 0.25s ease-out, toast-out 0.3s ease-in 1.5s forwards" }}
          >
            {t.key && (
              <span className="rounded border border-white/40 px-1.5 py-0.5 font-display text-xs">
                {t.key}
              </span>
            )}
            <span className="text-sm">{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
