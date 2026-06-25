"use client";

import { useState, useTransition } from "react";
import { setRpe } from "@/app/actions";

/** Foster CR10 session-RPE verbal anchors (FR), per docs/research/descent-neuromuscular-rpe.md (part B).
 *  The validated scale runs 0–10 (0 = repos); a *logged* session is by definition ≥ 1, so the picker
 *  offers 1–10 while the legend keeps the 0 = repos reference. Intermediate 6/8/9 are interpolated. */
const ANCHORS: Record<number, string> = {
  1: "très très facile",
  2: "facile",
  3: "modéré",
  4: "assez dur",
  5: "dur",
  6: "dur",
  7: "très dur",
  8: "très dur",
  9: "presque maximal",
  10: "maximal",
};

/** Differential RPE channels (Phase 2): cardio → aerobic (Alpine), legs/grip → neuromuscular (Summit). */
const CHANNELS = [
  { key: "cardio", label: "Souffle / cardio", tint: "text-alpine-700 dark:text-alpine-400" },
  { key: "legs", label: "Jambes", tint: "text-summit-700 dark:text-summit-400" },
  { key: "grip", label: "Avant-bras / prise", tint: "text-summit-700 dark:text-summit-400" },
] as const;
type ChannelKey = (typeof CHANNELS)[number]["key"];

/** Inline RPE picker for needs_manual_rpe sessions (climbing / strength / surf…).
 *  Global Foster CR10 (one tap = log), with an optional "préciser par système" panel that captures the
 *  differential sub-scores (souffle / jambes / avant-bras) → a perception-derived aerobic/neuro split. */
export function RpeControl(
  { activityId, value, differential }: {
    activityId: string;
    value: number | null;
    differential?: { cardio: number | null; legs: number | null; grip: number | null };
  },
) {
  const initSub = (): Record<ChannelKey, number | null> => ({
    cardio: differential?.cardio ?? null, legs: differential?.legs ?? null, grip: differential?.grip ?? null,
  });
  const hasDiff = differential != null && (differential.cardio != null || differential.legs != null || differential.grip != null);
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState(hasDiff); // auto-expand the panel when sub-scores already exist
  const [global, setGlobal] = useState<number | null>(value);
  const [sub, setSub] = useState<Record<ChannelKey, number | null>>(initSub);
  const [pending, start] = useTransition();

  const reset = () => { setDiff(hasDiff); setGlobal(value); setSub(initSub()); };
  const close = () => { setOpen(false); reset(); };

  // One-tap global log (fast path) when the differential panel is closed.
  const logGlobal = (n: number) =>
    start(async () => { await setRpe(activityId, n); close(); });

  // Submit global + differential together.
  const submitDiff = () =>
    start(async () => {
      if (global == null) return;
      await setRpe(activityId, global, sub);
      close();
    });

  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        disabled={pending}
        title="Effort perçu de la séance (CR10, 1–10) → charge réelle"
        className={`rounded px-2 py-1 text-xs transition-colors hover:bg-stone-100 dark:hover:bg-stone-800 ${
          value != null ? "font-medium text-alpine-700 dark:text-alpine-400" : "text-amber-600"
        }`}
      >
        {pending ? "…" : value != null ? `RPE ${value}` : "RPE ?"}
      </button>

      {open && (
        <>
          <button type="button" aria-label="Fermer" onClick={close} className="fixed inset-0 z-40 cursor-default" />
          <div
            role="dialog"
            className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-stone-200 bg-page p-3 text-left shadow-sm dark:border-stone-700 dark:bg-stone-900"
          >
            <p className="text-xs font-medium text-ink dark:text-stone-100">
              Globalement, à quel point cette séance était-elle difficile&nbsp;?
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-stone-500 dark:text-stone-400">
              Pense à toute la séance, pas seulement à la fin. Idéalement 20–30&nbsp;min après.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={pending}
                  onClick={() => (diff ? setGlobal(n) : logGlobal(n))}
                  title={`${n} — ${ANCHORS[n]}`}
                  className={`h-7 w-7 rounded border text-xs tabular-nums transition-colors disabled:opacity-40 ${
                    n === global
                      ? "border-alpine-500 bg-alpine-500 text-white"
                      : "border-stone-300 hover:bg-alpine-100 dark:border-stone-600 dark:hover:bg-alpine-900/40"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-stone-400 tabular-nums dark:text-stone-500">
              <span className="font-medium">0</span> repos · <span className="font-medium">3</span> modéré ·{" "}
              <span className="font-medium">5</span> dur · <span className="font-medium">7</span> très dur ·{" "}
              <span className="font-medium">10</span> maximal
            </p>

            {/* Optional differential RPE — splits the load into aérobie (souffle) vs neuro (jambes/prise). */}
            <button
              type="button"
              onClick={() => setDiff((d) => !d)}
              className="mt-2 text-[11px] text-stone-500 underline-offset-2 hover:underline dark:text-stone-400"
            >
              {diff ? "▾" : "▸"} Préciser par système (optionnel)
            </button>
            {diff && (
              <div className="mt-2 space-y-1.5 border-t border-stone-200 pt-2 dark:border-stone-700">
                <p className="text-[11px] leading-snug text-stone-500 dark:text-stone-400">
                  Effort ressenti par système (0–10). On en répartit la charge aéro/neuro.
                </p>
                {CHANNELS.map((ch) => (
                  <label key={ch.key} className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] font-medium ${ch.tint}`}>{ch.label}</span>
                    <select
                      value={sub[ch.key] ?? ""}
                      disabled={pending}
                      onChange={(e) =>
                        setSub((s) => ({ ...s, [ch.key]: e.target.value === "" ? null : Number(e.target.value) }))}
                      className="rounded border border-stone-300 bg-page px-1.5 py-0.5 text-xs tabular-nums dark:border-stone-600 dark:bg-stone-900"
                    >
                      <option value="">—</option>
                      {Array.from({ length: 11 }, (_, i) => i).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <button
                  type="button"
                  disabled={pending || global == null}
                  onClick={submitDiff}
                  className="mt-1 w-full rounded border border-alpine-500 bg-alpine-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-alpine-600 disabled:opacity-40"
                >
                  {pending ? "…" : global == null ? "Choisis le RPE global" : "Valider"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </span>
  );
}
