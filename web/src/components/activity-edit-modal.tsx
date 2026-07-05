"use client";

/** Édition des données d'une activité synchronisée — l'athlète corrige TOUT champ utile au calcul des
 *  impacts aéro/neuro (D− aberrant, FC fantôme, durée…). Bottom-sheet mobile / modale centrée desktop,
 *  même patron que ActivityFlag. Seuls les champs MODIFIÉS sont envoyés (updateActivityData), qui les
 *  écrit + les mémorise dans user_overrides (survivent aux re-syncs), recalcule la charge et fait le
 *  rollup — les graphs bougent immédiatement. Les champs déjà corrigés portent un point Summit. */
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateActivityData } from "@/app/actions";
import { fmt } from "@/lib/format";
import type { Activity } from "@/lib/data";

type FieldKey =
  | "duration_s" | "moving_s" | "distance_m" | "vertical_gain_m" | "vertical_loss_m"
  | "avg_hr" | "max_hr" | "avg_power_w" | "np_power_w"
  | "carried_load_kg" | "avg_altitude_m" | "avg_temp_c";

/** Descripteur d'affichage : libellé FR + unité + conversion affichage↔stockage (min↔s, km↔m). */
type FieldSpec = {
  key: FieldKey;
  label: string;
  unit: string;
  toDisplay: (v: number) => number;
  toStored: (v: number) => number;
  step?: string;
};
const min = (v: number) => Math.round(v / 60);
const sec = (v: number) => Math.round(v * 60);
const id = (v: number) => v;

const GROUPS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: "Effort",
    fields: [
      { key: "duration_s", label: "Durée totale", unit: "min", toDisplay: min, toStored: sec },
      { key: "moving_s", label: "Temps en mouvement", unit: "min", toDisplay: min, toStored: sec },
      { key: "distance_m", label: "Distance", unit: "km", toDisplay: (v) => Math.round(v / 10) / 100, toStored: (v) => Math.round(v * 1000), step: "0.01" },
      { key: "vertical_gain_m", label: "Dénivelé positif (D+)", unit: "m", toDisplay: Math.round, toStored: id },
      { key: "vertical_loss_m", label: "Dénivelé négatif (D−)", unit: "m", toDisplay: Math.round, toStored: id },
    ],
  },
  {
    title: "Capteurs",
    fields: [
      { key: "avg_hr", label: "FC moyenne", unit: "bpm", toDisplay: Math.round, toStored: Math.round },
      { key: "max_hr", label: "FC max", unit: "bpm", toDisplay: Math.round, toStored: Math.round },
      { key: "avg_power_w", label: "Puissance moyenne", unit: "W", toDisplay: Math.round, toStored: id },
      { key: "np_power_w", label: "Puissance normalisée", unit: "W", toDisplay: Math.round, toStored: id },
    ],
  },
  {
    title: "Contexte",
    fields: [
      { key: "carried_load_kg", label: "Charge portée", unit: "kg", toDisplay: id, toStored: id, step: "0.5" },
      { key: "avg_altitude_m", label: "Altitude moyenne", unit: "m", toDisplay: Math.round, toStored: id },
      { key: "avg_temp_c", label: "Température moyenne", unit: "°C", toDisplay: Math.round, toStored: id },
    ],
  },
];

/** Bouton + modale. `onOpen` permet à un parent (le panneau ⚠) de se fermer quand la modale s'ouvre. */
export function ActivityEditButton({
  a, onOpen, className, label = "Corriger les données ▾",
}: {
  a: Activity;
  onOpen?: () => void;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Valeurs initiales (affichage) — recalculées à chaque ouverture pour repartir des données actuelles.
  const initial = useMemo(() => {
    const out: Record<string, string> = {};
    for (const g of GROUPS) {
      for (const f of g.fields) {
        const v = (a as unknown as Record<string, number | null>)[f.key];
        out[f.key] = v == null ? "" : String(f.toDisplay(v));
      }
    }
    return out;
  }, [a]);

  const openModal = () => {
    setValues(initial);
    setError(null);
    setDone(null);
    setOpen(true);
    onOpen?.();
  };

  // Verrou du scroll page (comme help.tsx) — désarme aussi le pull-to-refresh pendant l'édition.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const overridden = (k: string) => a.user_overrides != null && k in a.user_overrides;

  const submit = () =>
    start(async () => {
      setError(null);
      const edits: Record<string, number> = {};
      for (const g of GROUPS) {
        for (const f of g.fields) {
          const raw = (values[f.key] ?? "").trim().replace(",", ".");
          if (raw === "" || raw === initial[f.key]) continue; // vide ou inchangé → pas envoyé
          const n = Number(raw);
          if (!Number.isFinite(n)) { setError(`Valeur invalide : ${f.label}`); return; }
          edits[f.key] = f.toStored(n);
        }
      }
      if (!Object.keys(edits).length) { setOpen(false); return; }
      try {
        const res = await updateActivityData(a.id, edits);
        setDone(`Charge recalculée — aéro ${fmt(res.aerobic, 0)} · neuro ${fmt(res.neuro, 0)} pts`);
        router.refresh();
        window.setTimeout(() => setOpen(false), 1200);
      } catch (e) {
        setError((e as Error)?.message ?? "Échec de l'enregistrement");
      }
    });

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={className ??
          "rounded-full border border-stone-300 px-2 py-0.5 text-xs text-stone-500 transition-colors hover:bg-stone-50 dark:border-stone-600 dark:text-stone-400 dark:hover:bg-stone-800/40"}
      >
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[1px] sm:items-center sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Corriger les données de l'activité"
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-stone-200 bg-page p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-stone-800 sm:max-w-md sm:rounded-2xl sm:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink dark:text-stone-100">Corriger les données</h2>
                <p className="mt-0.5 text-[11px] leading-snug text-stone-500 dark:text-stone-400">
                  La charge aéro/neuro est recalculée sur tes valeurs, qui survivent aux prochaines
                  synchronisations Strava.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-stone-400 hover:text-stone-600" aria-label="Fermer">
                ✕
              </button>
            </div>

            {GROUPS.map((g) => (
              <div key={g.title} className="mt-3 border-t border-stone-200 pt-3 first:border-0 dark:border-stone-800">
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{g.title}</h3>
                <div className="space-y-1.5">
                  {g.fields.map((f) => (
                    <label key={f.key} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300">
                        {f.label}
                        {overridden(f.key) && (
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full bg-summit-500"
                            title="Valeur déjà corrigée par toi (conservée à chaque sync)"
                          />
                        )}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <input
                          type="number"
                          inputMode="decimal"
                          step={f.step ?? "1"}
                          value={values[f.key] ?? ""}
                          disabled={pending}
                          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                          className="w-24 rounded border border-stone-300 bg-page px-2 py-1 text-right text-sm tabular-nums dark:border-stone-600 dark:bg-stone-900"
                        />
                        <span className="w-8 text-[11px] text-stone-400">{f.unit}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
            {done && <p className="mt-3 text-xs font-medium text-alpine-700 dark:text-alpine-400">✓ {done}</p>}

            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="mt-4 w-full rounded-lg bg-alpine-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-alpine-700 disabled:opacity-50"
            >
              {pending ? "Recalcul de la charge…" : "Enregistrer et recalculer"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
