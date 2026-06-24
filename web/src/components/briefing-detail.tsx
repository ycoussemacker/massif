"use client";

import { useState } from "react";

/** Collapsible "Afficher plus" under the briefing's one-sentence `why`: reveals the fuller state
 *  assessment (`reasoning`). Keeps the card minimal by default — the athlete pulls the detail only when
 *  they want it. The 7-day plan strip now lives at the top of the dashboard ("Ton plan d'entraînement"),
 *  so it's no longer duplicated here. (The ⚠️ flag stays always-visible in CoachHero — it's a warning.) */
export function BriefingDetail({ reasoning }: { reasoning: string | null }) {
  const [open, setOpen] = useState(false);
  if (!reasoning) return null;

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
        <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-300">{reasoning}</p>
      )}
    </div>
  );
}
