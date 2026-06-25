"use client";

import { useBriefingRegen } from "./briefing-regen";

/** Prominent, actionable notice shown when the displayed briefing is NOT today's (the cron/regen hasn't
 *  produced one for the current day, so yesterday's is carried over). The morning briefing is the whole
 *  point of the dashboard, so a stale one gets a clear call-to-action rather than the discreet ⋮ menu:
 *  tap "Régénérer" → the same background regeneration the menu fires (useBriefingRegen → /api/coach/regen),
 *  with the app-wide progress banner. `dayLabel` is the briefing's day in the athlete's words ("hier",
 *  "12 juin"). */
export function StaleBriefingNotice({ dayLabel }: { dayLabel: string }) {
  const { regenerate, regenerating } = useBriefingRegen();
  return (
    <div className="mt-4 flex flex-col gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
        <span aria-hidden className="leading-snug">⚠️</span>
        <span>
          Ce briefing date d&apos;{dayLabel} — régénère-le pour la reco d&apos;aujourd&apos;hui.
        </span>
      </p>
      <button
        type="button"
        onClick={regenerate}
        disabled={regenerating}
        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-summit-500 to-alpine-600 px-4 py-2 text-sm font-semibold text-white transition hover:from-summit-600 hover:to-alpine-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {regenerating ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 animate-spin" aria-hidden>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Régénération…
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
              <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            Régénérer le briefing
          </>
        )}
      </button>
    </div>
  );
}
