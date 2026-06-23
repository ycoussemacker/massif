"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { generateBriefingNow } from "@/app/actions";

/** Shared regeneration state for the coach card. Owns the (paid, rate-limited) "Régénérer le
 *  briefing" flow — the `useTransition`, the in-flight guard, the top-screen toast, and the
 *  `generateBriefingNow()` + `router.refresh()` call — so BOTH the discreet ⋮ menu (`BriefingMenu`,
 *  the trigger) and the displayed brief content (`BriefingBody`, dimmed while running) can read one
 *  `regenerating` flag. Because the transition stays pending through the server re-fetch, dimming on
 *  `regenerating` clears exactly when the fresh briefing renders. */
type RegenContext = {
  /** True from the moment regenerate() is called until router.refresh() resolves. */
  regenerating: boolean;
  regenerate: () => void;
};

const Ctx = createContext<RegenContext | null>(null);

/** Sensible no-op fallback if a consumer renders outside the provider (e.g. a stray mount). */
const FALLBACK: RegenContext = { regenerating: false, regenerate: () => {} };

export function useBriefingRegen(): RegenContext {
  return useContext(Ctx) ?? FALLBACK;
}

export function BriefingRegenProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const running = useRef(false);

  const regenerate = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setToast(null);
    startTransition(async () => {
      try {
        const { briefing, pulled } = await generateBriefingNow();
        const dot = { green: "🟢", amber: "🟡", red: "🔴" }[briefing.readiness] ?? "•";
        const sync = pulled > 0 ? `${pulled} activité(s) · ` : "";
        setToast(`${sync}${dot} Briefing régénéré`);
        router.refresh();
      } catch (e) {
        setToast((e as Error)?.message ?? "Échec de la régénération");
      } finally {
        running.current = false;
        window.setTimeout(() => setToast(null), 4500);
      }
    });
  }, [router]);

  return (
    <Ctx.Provider value={{ regenerating: pending, regenerate }}>
      {children}
      {/* Feedback haut d'écran (la régénération peut prendre ~15 s). */}
      {(pending || toast) && (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[60] flex justify-center">
          <span className="rounded-full border border-stone-200 bg-white/90 px-3 py-1 text-xs font-medium text-stone-600 shadow-sm backdrop-blur dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-300">
            {pending ? "Régénération du briefing…" : toast}
          </span>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Wraps brief-derived display: dims to ~40% + becomes non-interactive while a regeneration is in
 *  flight, un-dimming when the fresh briefing renders. Children pass through untouched otherwise. */
export function BriefingBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { regenerating } = useBriefingRegen();
  return (
    <div
      aria-busy={regenerating}
      className={`transition-opacity ${regenerating ? "pointer-events-none opacity-40" : ""} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
