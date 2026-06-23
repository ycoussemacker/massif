"use client";

import { useState, useTransition } from "react";
import { setSoreness } from "@/app/actions";

/** Optional morning self-report of leg/muscle soreness (1 fresh – 5 cooked) — the neuromuscular
 *  ground-truth wearables can't see (prio 3c). Non-blocking: tap a number to log, tap it again to
 *  clear. Neutral stone palette on purpose (a self-report input, not a computed readiness verdict). */
export function SorenessInput({ initial }: { initial: number | null }) {
  const [value, setValue] = useState<number | null>(initial);
  const [pending, start] = useTransition();

  const pick = (v: number) => {
    const next = value === v ? null : v; // tap the active one again to clear
    const prev = value;
    setValue(next);
    start(() => {
      setSoreness(next).catch(() => setValue(prev)); // revert the optimistic update on failure
    });
  };

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
          Jambes ce matin&nbsp;?
          <span
            className="ml-1.5 cursor-help text-xs text-stone-400"
            title="Auto-évaluation facultative des courbatures (1 = fraîches, 5 = cuites). La VFC / Body Battery ne voient pas la fatigue musculaire et tendineuse ; ce signal sert à personnaliser le canal neuromusculaire avec le temps. Aucune obligation."
          >
            ?
          </span>
        </span>
        <span className="text-xs text-stone-400">facultatif</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => pick(v)}
            disabled={pending}
            aria-pressed={value === v}
            aria-label={`Courbatures ${v} sur 5`}
            className={`h-9 flex-1 rounded-lg border text-sm font-medium tabular-nums transition-colors disabled:opacity-60 ${
              value === v
                ? "border-stone-800 bg-stone-800 text-white dark:border-stone-200 dark:bg-stone-200 dark:text-stone-900"
                : "border-stone-200 text-stone-600 hover:border-stone-400 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-500"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-stone-400">
        <span>fraîches</span>
        <span>cuites</span>
      </div>
    </div>
  );
}
