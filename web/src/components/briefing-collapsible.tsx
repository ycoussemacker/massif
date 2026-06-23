"use client";

import { useState } from "react";

/** Collapsible wrapper used when the day VERDICT takes the headline of the coach card: the morning
 *  briefing (recommended session, why, reasoning, week skeleton) folds away under "Voir le plan du
 *  coach" so nothing is lost. (The ⚠️ flag stays OUTSIDE this — it's a warning, always visible.) */
export function BriefingCollapsible({
  label = "Voir le plan du coach",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-alpine-700 transition-colors hover:text-alpine-800 dark:text-alpine-400 dark:hover:text-alpine-300"
      >
        {open ? "Masquer le plan du coach" : label}
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
      {open && <div className="mt-3 space-y-2">{children}</div>}
    </div>
  );
}
