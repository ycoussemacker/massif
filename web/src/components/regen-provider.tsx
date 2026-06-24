"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** App-wide background regeneration of the week plan. The trigger fires a plain fetch to
 *  /api/coach/regen (NOT a Server Action), so the athlete can keep navigating while the coach replans.
 *  A persistent banner — mounted in the root layout, so it survives page changes — shows progress; on
 *  completion the page is refreshed and, if the athlete has left the PWA, a web push notifies them
 *  (sent server-side by the route). One run at a time (guarded). */

type RegenCtx = {
  regenerating: boolean;
  regenerate: () => void;
};

const Ctx = createContext<RegenCtx | null>(null);
const FALLBACK: RegenCtx = { regenerating: false, regenerate: () => {} };

export function useRegen(): RegenCtx {
  return useContext(Ctx) ?? FALLBACK;
}

export function RegenProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const running = useRef(false);

  const regenerate = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setState("running");
    setMsg(null);
    fetch("/api/coach/regen", { method: "POST" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d?.ok) throw new Error(d?.error ?? "Échec de la régénération.");
        const dot = { green: "🟢", amber: "🟡", red: "🔴" }[d.readiness as string] ?? "•";
        setState("done");
        setMsg(`${dot} Plan mis à jour`);
        router.refresh();
        window.setTimeout(() => { setState("idle"); setMsg(null); }, 6000);
      })
      .catch((e) => {
        setState("error");
        setMsg((e as Error)?.message ?? "Échec de la régénération.");
        window.setTimeout(() => { setState("idle"); setMsg(null); }, 6000);
      })
      .finally(() => { running.current = false; });
  }, [router]);

  return (
    <Ctx.Provider value={{ regenerating: state === "running", regenerate }}>
      {children}
      {state !== "idle" && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[70] flex justify-center px-4 md:bottom-4">
          <div className="pointer-events-auto flex max-w-[92vw] items-center gap-2 rounded-full border border-stone-200 bg-white/95 px-3.5 py-2 text-sm text-stone-700 shadow-lg backdrop-blur dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-200">
            {state === "running" && (
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-stone-300 border-t-stone-500 dark:border-stone-600 dark:border-t-stone-300" />
            )}
            <span className="min-w-0">
              {state === "running" ? "Ton plan se met à jour en arrière-plan…" : msg}
            </span>
            {state === "done" && (
              <button type="button" onClick={() => router.refresh()}
                className="shrink-0 font-semibold text-alpine-700 hover:underline dark:text-alpine-300">
                Actualiser
              </button>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
