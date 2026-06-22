"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncNow } from "@/app/actions";

/** On-demand sync control, mounted once (in Nav). Triggers a TS Strava pull + model recompute via the
 *  syncNow() server action, then refreshes the route. Two affordances:
 *   - desktop: a small floating "Synchroniser" button (bottom-right);
 *   - mobile: pull-to-refresh (drag down from the very top of the page).
 *  A top toast gives feedback (the only feedback for the gesture path). Single instance → one set of
 *  touch listeners, one in-flight guard. Garmin recovery isn't pulled here (no API) — Strava + the
 *  fitness model only; the nightly cron refreshes Garmin. */
export function SyncRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const running = useRef(false);

  function run() {
    if (running.current) return;
    running.current = true;
    setToast(null);
    startTransition(async () => {
      try {
        const res = await syncNow();
        setToast(res.pulled > 0 ? `${res.pulled} activité(s) synchronisée(s)` : "Déjà à jour");
        router.refresh();
      } catch (e) {
        setToast((e as Error)?.message ?? "Échec de la synchronisation");
      } finally {
        running.current = false;
        window.setTimeout(() => setToast(null), 4000);
      }
    });
  }

  // Pull-to-refresh (mobile): a downward drag of >90px while scrolled to the very top.
  useEffect(() => {
    let startY = 0;
    let armed = false;
    const onStart = (e: TouchEvent) => {
      armed = window.scrollY <= 0;
      startY = e.touches[0]?.clientY ?? 0;
    };
    const onMove = (e: TouchEvent) => {
      if (armed && window.scrollY <= 0 && (e.touches[0]?.clientY ?? 0) - startY > 90) {
        armed = false;
        run();
      }
    };
    const onEnd = () => {
      armed = false;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    // run() only reads stable refs/transition setters — safe to bind once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Desktop : bouton flottant discret, hors du flux (n'altère pas l'app-bar ni le contenu). */}
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="Synchroniser Strava (pull + recalcul de la charge)"
        className="fixed bottom-4 right-4 z-40 hidden items-center gap-1.5 rounded-full border border-stone-200 bg-white/90 px-3 py-2 text-sm font-medium text-stone-600 shadow-sm backdrop-blur transition-colors hover:border-alpine-300 hover:text-alpine-700 disabled:opacity-60 md:inline-flex dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-300 dark:hover:border-alpine-700 dark:hover:text-alpine-300"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 ${pending ? "animate-spin" : ""}`}
          aria-hidden
        >
          <path d="M21 2v6h-6" />
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M3 22v-6h6" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        </svg>
        {pending ? "Synchro…" : "Synchroniser"}
      </button>

      {/* Feedback haut d'écran — la seule indication pour le pull-to-refresh mobile. */}
      {(pending || toast) && (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-50 flex justify-center">
          <span className="rounded-full border border-stone-200 bg-white/90 px-3 py-1 text-xs font-medium text-stone-600 shadow-sm backdrop-blur dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-300">
            {pending ? "Synchronisation…" : toast}
          </span>
        </div>
      )}
    </>
  );
}
