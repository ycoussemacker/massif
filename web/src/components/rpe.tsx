"use client";

import { useState, useTransition } from "react";
import { setRpe } from "@/app/actions";

/** Inline RPE picker for needs_manual_rpe sessions (climbing / strength / surf…).
 *  Shows "RPE ?" when unset (amber affordance) or "RPE n" when logged; click to open a 1–10 row. */
export function RpeControl({ activityId, value }: { activityId: string; value: number | null }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const choose = (n: number) =>
    start(async () => {
      await setRpe(activityId, n);
      setOpen(false);
    });

  if (open) {
    return (
      <span className="inline-flex flex-wrap items-center gap-0.5 align-middle">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            disabled={pending}
            onClick={() => choose(n)}
            className={`h-7 w-7 rounded border text-xs tabular-nums transition-colors disabled:opacity-40 ${
              n === value
                ? "border-alpine-500 bg-alpine-500 text-white"
                : "border-stone-300 hover:bg-alpine-100 dark:border-stone-600 dark:hover:bg-alpine-900/40"
            }`}
          >
            {n}
          </button>
        ))}
        <button type="button" onClick={() => setOpen(false)}
          className="ml-0.5 text-xs text-stone-400 hover:text-stone-600">✕</button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={pending}
      title="Saisir l'effort perçu (RPE 1–10) → charge réelle"
      className={`rounded px-2 py-1 text-xs transition-colors hover:bg-stone-100 dark:hover:bg-stone-800 ${
        value != null ? "font-medium text-alpine-700 dark:text-alpine-400" : "text-amber-600"
      }`}
    >
      {pending ? "…" : value != null ? `RPE ${value}` : "RPE ?"}
    </button>
  );
}
