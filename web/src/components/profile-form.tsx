"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateProfile, type SaveState } from "@/app/profil/actions";
import { ageFrom, type AthleteProfile } from "@/lib/profile-types";

function Field({
  label, name, defaultValue, type = "text", placeholder, unit, step, min, max, className = "",
}: {
  label: string; name: string; defaultValue?: string | number | null; type?: string;
  placeholder?: string; unit?: string; step?: string; min?: number; max?: number; className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{label}</span>
      <span className="flex items-center gap-2">
        <input
          name={name}
          type={type}
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          step={step}
          min={min}
          max={max}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 outline-none transition-colors focus:border-alpine-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
        />
        {unit && <span className="shrink-0 text-xs text-stone-400">{unit}</span>}
      </span>
    </label>
  );
}

// Monday-first week; `key` is the stable identifier stored in constraints.no_hard_days
// (two days share the letter "M", so the letter is display-only — never the key).
const WEEKDAYS = [
  { key: "lundi", letter: "L" },
  { key: "mardi", letter: "M" },
  { key: "mercredi", letter: "M" },
  { key: "jeudi", letter: "J" },
  { key: "vendredi", letter: "V" },
  { key: "samedi", letter: "S" },
  { key: "dimanche", letter: "D" },
] as const;

/** Round, toggleable weekday selector. Emits one hidden input per selected day so the server
 *  action reads them via FormData.getAll(name). */
function WeekdayPicker({ name, initial }: { name: string; initial: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="flex flex-wrap gap-2">
      {WEEKDAYS.map((d, i) => {
        const on = selected.has(d.key);
        return (
          <button
            key={i}
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={d.key}
            title={d.key}
            onClick={() => toggle(d.key)}
            className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition-colors ${
              on
                ? "border-alpine-500 bg-alpine-500 text-white"
                : "border-stone-300 text-stone-600 hover:border-alpine-400 hover:text-alpine-600 dark:border-stone-700 dark:text-stone-300 dark:hover:border-alpine-500"
            }`}
          >
            {d.letter}
          </button>
        );
      })}
      {[...selected].map((k) => (
        <input key={k} type="hidden" name={name} value={k} />
      ))}
    </div>
  );
}

function SaveBar({ state }: { state: SaveState }) {
  const { pending } = useFormStatus();
  return (
    <div className="mt-5 flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-alpine-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-alpine-500 disabled:opacity-50"
      >
        {pending ? "Enregistrement…" : "Enregistrer"}
      </button>
      {!pending && state?.ok && <span className="text-sm text-emerald-600 dark:text-emerald-400">Enregistré ✓</span>}
      {!pending && state?.ok === false && (
        <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

/** Edit identity + personal data + physiological baselines + training preferences (jsonb). */
export function ProfileForm({ profile }: { profile: AthleteProfile | null }) {
  const [state, formAction] = useActionState(updateProfile, null);
  const [advanced, setAdvanced] = useState(false);
  const age = ageFrom(profile?.birthdate);
  const weekly = (profile?.weekly_structure as any) ?? {};
  const constraints = (profile?.constraints as any) ?? {};
  // no_hard_days is now an array of day keys; accept a legacy comma-string for back-compat.
  const rawDays = constraints.no_hard_days;
  const noHardDaysInitial: string[] = Array.isArray(rawDays)
    ? rawDays.map(String)
    : typeof rawDays === "string"
      ? rawDays.split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean)
      : [];

  return (
    <form action={formAction} className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <Section title="Identité">
        <Field label="Nom / pseudo" name="name" defaultValue={profile?.name} placeholder="Ton nom d'affichage" className="sm:col-span-2" />
      </Section>

      <Section title="Données personnelles">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
            Date de naissance{age != null && <span className="ml-1 font-normal text-stone-400">· {age} ans</span>}
          </span>
          <input
            name="birthdate"
            type="date"
            defaultValue={profile?.birthdate ?? ""}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 outline-none focus:border-alpine-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Sexe</span>
          <select
            name="sex"
            defaultValue={profile?.sex ?? ""}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 outline-none focus:border-alpine-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
          >
            <option value="">—</option>
            <option value="M">Homme</option>
            <option value="F">Femme</option>
            <option value="other">Autre</option>
          </select>
        </label>
        <Field label="Taille" name="height_cm" defaultValue={profile?.height_cm} type="number" unit="cm" min={50} max={250} step="1" />
        <Field label="Poids" name="weight_kg" defaultValue={profile?.weight_kg} type="number" unit="kg" min={20} max={250} step="0.1" />
      </Section>

      <Section title="Repères physiologiques">
        <Field label="FC max" name="max_hr" defaultValue={profile?.max_hr} type="number" unit="bpm" min={100} max={250} step="1" />
        <Field label="FC repos (base)" name="resting_hr" defaultValue={profile?.resting_hr} type="number" unit="bpm" min={25} max={120} step="1" />
        <Field label="LTHR (seuil)" name="lthr" defaultValue={profile?.lthr} type="number" unit="bpm" min={100} max={230} step="1" />
        <Field label="VFC de référence" name="hrv_baseline_ms" defaultValue={profile?.hrv_baseline_ms} type="number" unit="ms" min={5} max={300} step="1" />
      </Section>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="mt-6 text-xs font-medium text-alpine-600 hover:underline dark:text-alpine-400"
      >
        {advanced ? "− Masquer les préférences" : "+ Préférences d'entraînement (avancé)"}
      </button>

      {advanced && (
        <div className="mt-4 space-y-4">
          <div className="sm:max-w-xs">
            <Field label="Heures max / semaine" name="max_weekly_hours" defaultValue={constraints.max_weekly_hours} type="number" unit="h" min={0} max={60} step="0.5" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Jours sans intensité</span>
            <WeekdayPicker name="no_hard_days" initial={noHardDaysInitial} />
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Structure de semaine préférée</span>
            <textarea
              name="weekly_structure_notes"
              defaultValue={weekly.notes ?? ""}
              rows={2}
              placeholder="ex. sortie longue le dimanche, escalade le mardi soir…"
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 outline-none focus:border-alpine-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Contraintes / antécédents (blessures, etc.)</span>
            <textarea
              name="constraints_notes"
              defaultValue={constraints.notes ?? ""}
              rows={2}
              placeholder="ex. tendinite d'Achille en 2024, pas de fractionné le lendemain d'une grosse séance…"
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 outline-none focus:border-alpine-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
            />
          </label>
        </div>
      )}

      <SaveBar state={state} />
    </form>
  );
}
