"use client";

/** Déclaration/édition d'une FENÊTRE DE CONTRAINTE (Upgrade 10) : « du 8 au 21 juillet je suis en
 *  déplacement, pas de montagne ». Le plan s'y adapte automatiquement : décharge reportée sur la
 *  fenêtre, D+ chargé avant, séances sur plat pendant. Modale sobre, même patron que QuickAddEvent. */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTrainingWindow, updateTrainingWindow, type TrainingWindowInput } from "@/app/actions";
import type { CalWindow } from "@/lib/calendar";

const EFFECT_OPTIONS: { value: NonNullable<TrainingWindowInput["effect"]>; label: string; hint: string }[] = [
  { value: "auto", label: "Automatique", hint: "décharge si la capacité est réduite sur ≥ 5 j, sinon entretien" },
  { value: "deload", label: "Décharge — on encaisse", hint: "volume −35 %, une qualité max ; la décharge du bloc se reporte ici" },
  { value: "maintain", label: "Entretien", hint: "on garde le moteur (volume −15 %), sans creuser la fatigue" },
  { value: "charge", label: "Charge (stage)", hint: "période d'entraînement assumée : plan normal, progression active" },
];

export function TrainingWindowModal({
  open, initial, defaultStart, onClose,
}: {
  open: boolean;
  initial?: CalWindow | null; // présent = édition
  defaultStart?: string;      // date pré-remplie à la création (jour tapé dans l'agenda)
  onClose: () => void;
}) {
  // Le formulaire n'est monté QUE ouvert : son état s'initialise au montage (pas de setState dans un
  // effect) et repart proprement à chaque ouverture.
  if (!open) return null;
  return <WindowForm initial={initial ?? null} defaultStart={defaultStart} onClose={onClose} />;
}

function WindowForm({
  initial, defaultStart, onClose,
}: {
  initial: CalWindow | null;
  defaultStart?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<TrainingWindowInput>(() =>
    initial
      ? {
          starts_on: initial.starts_on, ends_on: initial.ends_on, label: initial.label,
          effect: initial.effect, no_mountains: initial.no_mountains,
          limited_hills: initial.limited_hills, reduced_volume: initial.reduced_volume,
          notes: initial.notes,
        }
      : { starts_on: defaultStart ?? "", ends_on: defaultStart ?? "", label: "", effect: "auto" });

  // Verrou du scroll page + Échap (comme les autres modales) — actif toute la vie du formulaire.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
    // onClose est stable pour une ouverture donnée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Partial<TrainingWindowInput>) => setForm((f) => ({ ...f, ...patch }));
  const submit = () =>
    start(async () => {
      setError(null);
      try {
        if (initial) await updateTrainingWindow(initial.id, form);
        else await createTrainingWindow(form);
        router.refresh();
        onClose();
      } catch (e) {
        setError((e as Error)?.message ?? "Échec de l'enregistrement");
      }
    });

  const inputCls =
    "w-full rounded-lg border border-stone-300 bg-page px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-900";
  const checkRow = (key: "no_mountains" | "limited_hills" | "reduced_volume", label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm text-stone-700 dark:text-stone-200">
      <input
        type="checkbox"
        checked={!!form[key]}
        disabled={pending}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<TrainingWindowInput>)}
        className="mt-0.5 accent-alpine-600"
      />
      <span>
        {label} <span className="text-xs text-stone-400">— {hint}</span>
      </span>
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[1px] sm:items-center sm:p-4"
      onClick={() => !pending && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Contrainte d'entraînement"
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-stone-200 bg-page p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-stone-800 sm:max-w-md sm:rounded-2xl sm:pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink dark:text-stone-100">
              {initial ? "Modifier la contrainte" : "Déclarer une contrainte"}
            </h2>
            <p className="mt-0.5 text-[11px] leading-snug text-stone-500 dark:text-stone-400">
              Déplacement, terrain plat, semaine chargée… Le plan s&apos;adapte : décharge reportée sur la
              période, dénivelé chargé avant, séances adaptées pendant.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600" aria-label="Fermer">✕</button>
        </div>

        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">Nom</span>
            <input
              type="text"
              value={form.label}
              disabled={pending}
              placeholder="Déplacement Bordeaux"
              onChange={(e) => set({ label: e.target.value })}
              className={inputCls}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">Du</span>
              <input type="date" value={form.starts_on} disabled={pending}
                onChange={(e) => set({ starts_on: e.target.value })} className={`${inputCls} tabular-nums`} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">Au (inclus)</span>
              <input type="date" value={form.ends_on} disabled={pending}
                onChange={(e) => set({ ends_on: e.target.value })} className={`${inputCls} tabular-nums`} />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">Pendant cette période</span>
            <select
              value={form.effect ?? "auto"}
              disabled={pending}
              onChange={(e) => set({ effect: e.target.value as TrainingWindowInput["effect"] })}
              className={inputCls}
            >
              {EFFECT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="mt-1 block text-[11px] leading-snug text-stone-400">
              {EFFECT_OPTIONS.find((o) => o.value === (form.effect ?? "auto"))?.hint}
            </span>
          </label>

          <div className="space-y-1.5 border-t border-stone-200 pt-3 dark:border-stone-800">
            {checkRow("no_mountains", "Pas de montagne", "D+/D− indisponibles : on charge le dénivelé avant")}
            {checkRow("limited_hills", "Très peu de côtes", "la qualité passe sur du seuil à plat")}
            {checkRow("reduced_volume", "Temps réduit", "moins de créneaux d'entraînement")}
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="button"
          disabled={pending || !form.label.trim() || !form.starts_on || !form.ends_on}
          onClick={submit}
          className="mt-4 w-full rounded-lg bg-alpine-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-alpine-700 disabled:opacity-50"
        >
          {pending ? "Enregistrement…" : initial ? "Enregistrer" : "Déclarer la contrainte"}
        </button>
      </div>
    </div>
  );
}
