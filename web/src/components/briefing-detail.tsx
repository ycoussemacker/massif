"use client";

import { useState } from "react";
import { SYSTEM_TAG_FR } from "@/lib/labels";

type WeekDay = { day_offset: number; focus: string; system_tag: string };

/** Collapsible "Afficher plus" under the briefing's one-sentence `why`: reveals the fuller state
 *  assessment (`reasoning`) + the week skeleton. Keeps the card minimal by default — the athlete pulls
 *  the detail only when they want it. (The ⚠️ flag stays always-visible in CoachHero — it's a warning.) */
export function BriefingDetail({
  reasoning,
  weekSkeleton,
}: {
  reasoning: string | null;
  weekSkeleton: WeekDay[] | null;
}) {
  const [open, setOpen] = useState(false);
  const hasWeek = !!weekSkeleton?.length;
  if (!reasoning && !hasWeek) return null;

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
        <div className="mt-2 space-y-3">
          {reasoning && (
            <p className="text-sm leading-relaxed text-stone-600 dark:text-stone-300">{reasoning}</p>
          )}
          {hasWeek && (
            <div className="flex flex-wrap gap-1.5">
              {weekSkeleton!.map((d) => (
                <span
                  key={d.day_offset}
                  title={d.focus}
                  className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-300"
                >
                  <span className="font-medium">+{d.day_offset} j</span> {SYSTEM_TAG_FR[d.system_tag] ?? d.system_tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
