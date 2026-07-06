"use client";

import { useState } from "react";

/** Collapsible "Afficher plus" under the briefing's one-sentence `why`: reveals the fuller state
 *  assessment (`reasoning`) + what the last regeneration CHANGED in the week plan (`changed` — one FR
 *  line per adjusted day, or the explicit "plan confirmé à l'identique"). Keeps the card minimal by
 *  default — the athlete pulls the detail only when they want it. (The ⚠️ flag stays always-visible in
 *  CoachHero — it's a warning.) */
export function BriefingDetail({ reasoning, changed }: { reasoning: string | null; changed?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!reasoning && !changed) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-alpine-700 transition-colors hover:text-alpine-800 dark:text-alpine-400 dark:hover:text-alpine-300"
      >
        {open ? "Afficher moins" : "Afficher plus"}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {reasoning && (
            <p className="text-sm leading-relaxed text-stone-600 dark:text-stone-300">{reasoning}</p>
          )}
          {/* Ce que la dernière régénération a changé dans le plan de la semaine — transparence : un plan
              réécrit à l'identique le dit explicitement (le coach a réévalué, pas ignoré). */}
          {changed && (
            <p className="border-t border-stone-100 pt-2 text-xs leading-relaxed text-stone-500 dark:border-stone-800 dark:text-stone-400">
              <span className="font-medium text-stone-600 dark:text-stone-300">Dernière régénération :</span>{" "}
              {changed}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
