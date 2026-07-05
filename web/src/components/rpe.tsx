"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

/** RPE picker for needs_manual_rpe sessions (climbing / strength / surf…), en VRAIE MODALE :
 *  bottom-sheet plein écran sur mobile (l'ancienne popover ancrée débordait/se faisait couper dans les
 *  listes), centrée sur desktop — même patron que ActivityFlag. Global Foster CR10 (one tap = log) +
 *  panneau optionnel "préciser par système" (souffle / jambes / avant-bras) → split aéro/neuro perçu.
 *  L'action serveur recalcule la charge PUIS le rollup daily_metrics : les graphs de l'accueil bougent
 *  dès l'enregistrement (router.refresh en sortie). */
export function RpeControl(
  { activityId, value, differential }: {
    activityId: string;
    value: number | null;
    differential?: { cardio: number | null; legs: number | null; grip: number | null };
  },
) {
  const router = useRouter();
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

  // Verrou du scroll page tant que la modale est ouverte (comme help.tsx / activity-edit-modal) —
  // désarme aussi le pull-to-refresh, qui sinon se déclenchait en scrollant le contenu de la feuille.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
    // close est stable pour une ouverture donnée (recréé au render mais sans état capturé mutable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const saved = () => { setOpen(false); router.refresh(); };

  // One-tap global log (fast path) when the differential panel is closed.
  const logGlobal = (n: number) =>
    start(async () => { await setRpe(activityId, n); saved(); });

  // Submit global + differential together.
  const submitDiff = () =>
    start(async () => {
      if (global == null) return;
      await setRpe(activityId, global, sub);
      saved();
    });

  return (
    <>
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
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[1px] sm:items-center sm:p-4"
          onClick={() => !pending && close()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Effort perçu de la séance"
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-stone-200 bg-page p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-left dark:border-stone-800 sm:max-w-md sm:rounded-2xl sm:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-ink dark:text-stone-100">
                Globalement, à quel point cette séance était-elle difficile&nbsp;?
              </p>
              <button type="button" onClick={close} className="text-stone-400 hover:text-stone-600" aria-label="Fermer">
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs leading-snug text-stone-500 dark:text-stone-400">
              Pense à toute la séance, pas seulement à la fin. Idéalement 20–30&nbsp;min après.
            </p>

            {/* Grille 5×2 pleine largeur — cibles tactiles ≥ 44 px, fini la popover coupée sur mobile. */}
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={pending}
                  onClick={() => (diff ? setGlobal(n) : logGlobal(n))}
                  title={`${n} — ${ANCHORS[n]}`}
                  className={`h-11 rounded-lg border text-sm font-medium tabular-nums transition-colors disabled:opacity-40 ${
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
              className="mt-3 text-xs text-stone-500 underline-offset-2 hover:underline dark:text-stone-400"
            >
              {diff ? "▾" : "▸"} Préciser par système (optionnel)
            </button>
            {diff && (
              <div className="mt-2 space-y-2 border-t border-stone-200 pt-2 dark:border-stone-700">
                <p className="text-[11px] leading-snug text-stone-500 dark:text-stone-400">
                  Effort ressenti par système (0–10). On en répartit la charge aéro/neuro.
                </p>
                {CHANNELS.map((ch) => (
                  <label key={ch.key} className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-medium ${ch.tint}`}>{ch.label}</span>
                    <select
                      value={sub[ch.key] ?? ""}
                      disabled={pending}
                      onChange={(e) =>
                        setSub((s) => ({ ...s, [ch.key]: e.target.value === "" ? null : Number(e.target.value) }))}
                      className="rounded border border-stone-300 bg-page px-2 py-1 text-sm tabular-nums dark:border-stone-600 dark:bg-stone-900"
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
                  className="mt-1 w-full rounded-lg border border-alpine-500 bg-alpine-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-alpine-600 disabled:opacity-40"
                >
                  {pending ? "Recalcul de la charge…" : global == null ? "Choisis le RPE global" : "Valider"}
                </button>
              </div>
            )}

            {pending && !diff && (
              <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">Recalcul de la charge et des graphs…</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
