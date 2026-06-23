"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateBriefingNow } from "@/app/actions";

/** Discreet ⋮ menu on the coach card. Hides the deliberate, rate-limited "Régénérer le briefing"
 *  action (a paid Claude call): pulls fresh Strava + recomputes the model, then rewrites today's
 *  briefing in the chosen coach voice with the latest profile/goals. Distinct from the cheap, LLM-free
 *  pull-to-refresh (lib syncNow) — that stays the quick data refresh. A top toast gives feedback. */
export function BriefingMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const running = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function regenerate() {
    setOpen(false);
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
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="Options du briefing"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className="flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 disabled:opacity-60 dark:hover:bg-stone-800 dark:hover:text-stone-300"
      >
        {pending ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 animate-spin" aria-hidden>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden>
            <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
          </svg>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-50 w-60 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg shadow-stone-900/10 dark:border-stone-700 dark:bg-stone-900"
        >
          <button
            type="button"
            role="menuitem"
            onClick={regenerate}
            className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0 text-stone-500 dark:text-stone-400" aria-hidden>
              <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-stone-800 dark:text-stone-100">Régénérer le briefing</span>
              <span className="block text-xs text-stone-500 dark:text-stone-400">Synchronise Strava puis recalcule la reco du jour</span>
            </span>
          </button>
        </div>
      )}

      {/* Feedback haut d'écran (la régénération peut prendre ~15 s). */}
      {(pending || toast) && (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[60] flex justify-center">
          <span className="rounded-full border border-stone-200 bg-white/90 px-3 py-1 text-xs font-medium text-stone-600 shadow-sm backdrop-blur dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-300">
            {pending ? "Régénération du briefing…" : toast}
          </span>
        </div>
      )}
    </div>
  );
}
