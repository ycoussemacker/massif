"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePlannedEvent, deletePlannedEvent } from "@/app/actions";
import { useRegen } from "./regen-provider";
import type { SportOption } from "@/lib/activities";

/** Edit / delete an athlete-declared event from its séance page. After a change, if the event falls in
 *  the next 7 days, offers to regenerate the week plan so the coach replans around (or without) it. */

export type EventEditInitial = {
  date: string;
  sportId: number | null;
  title: string;
  distanceKm: string;
  verticalM: string;
  altitudeM: string;
  durationMin: string;
  isKey: boolean;
};

const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 " +
  "placeholder:text-stone-400 focus:border-alpine-500 focus:outline-none focus:ring-1 focus:ring-alpine-500 " +
  "dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100";

export function EventEdit({
  id, sports, initial, daysOut,
}: {
  id: string;
  sports: SportOption[];
  initial: EventEditInitial;
  daysOut: number; // calendar days from today (0 = today)
}) {
  const router = useRouter();
  const regen = useRegen();
  const [mode, setMode] = useState<"view" | "edit" | "confirmDelete">("view");
  const [d, setD] = useState<EventEditInitial>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // After a successful change, when the event is in the next 7 days, ask to regenerate the week plan.
  const [regenFor, setRegenFor] = useState<null | "edit" | "delete">(null);

  const within7 = daysOut >= 0 && daysOut <= 7;
  const setField = <K extends keyof EventEditInitial>(k: K, v: EventEditInitial[K]) => setD((p) => ({ ...p, [k]: v }));

  function payload() {
    const km = parseFloat(d.distanceKm.replace(",", "."));
    const vert = parseInt(d.verticalM, 10);
    const alt = parseInt(d.altitudeM, 10);
    const min = parseInt(d.durationMin, 10);
    return {
      planned_date: d.date,
      sport_id: d.sportId!,
      title: d.title,
      is_key: d.isKey,
      target_distance_m: Number.isFinite(km) ? Math.round(km * 1000) : null,
      target_vertical_m: Number.isFinite(vert) ? vert : null,
      target_duration_s: Number.isFinite(min) ? min * 60 : null,
      expected_altitude_m: Number.isFinite(alt) ? alt : null,
    };
  }

  function save() {
    if (d.sportId == null) { setError("Choisis un sport."); return; }
    setError(null);
    startTransition(async () => {
      try {
        await updatePlannedEvent(id, payload());
        setMode("view");
        if (within7) setRegenFor("edit");
        else router.refresh();
      } catch (e) { setError((e as Error)?.message ?? "Échec de l'enregistrement."); }
    });
  }

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deletePlannedEvent(id);
        if (within7) setRegenFor("delete");
        else router.push("/calendrier");
      } catch (e) { setError((e as Error)?.message ?? "Échec de la suppression."); }
    });
  }

  function regenerate() {
    regen.regenerate(); // background — non-blocking; the global banner + push report completion
    if (regenFor === "delete") router.push("/calendrier");
    else { setRegenFor(null); router.refresh(); }
  }
  function skipRegen() {
    if (regenFor === "delete") router.push("/calendrier");
    else { setRegenFor(null); router.refresh(); }
  }

  // Post-change: offer to regenerate the week plan (event within 7 days).
  if (regenFor) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <p className="text-sm text-stone-700 dark:text-stone-200">
          {regenFor === "delete" ? "Activité supprimée." : "Activité mise à jour."} Elle tombe dans les 7 prochains
          jours — régénérer le plan de la semaine pour que le coach en tienne compte&nbsp;? (la régénération
          tourne en arrière-plan, tu peux continuer à naviguer)
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={regenerate}
            className="rounded-lg bg-alpine-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-alpine-700">
            Régénérer le plan
          </button>
          <button type="button" onClick={skipRegen}
            className="rounded-lg px-3 py-2 text-sm font-medium text-stone-500 transition hover:text-stone-700 dark:hover:text-stone-300">
            Plus tard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      {mode === "view" && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setMode("edit")}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-alpine-300 hover:text-alpine-700 dark:border-stone-700 dark:text-stone-200 dark:hover:border-alpine-700 dark:hover:text-alpine-300">
            Modifier
          </button>
          <button type="button" onClick={() => setMode("confirmDelete")}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-500 transition-colors hover:text-red-600 dark:text-stone-400">
            Supprimer
          </button>
        </div>
      )}

      {mode === "confirmDelete" && (
        <div>
          <p className="text-sm text-stone-700 dark:text-stone-200">Supprimer cette activité prévue&nbsp;?</p>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={confirmDelete} disabled={pending}
              className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60">
              {pending ? "Suppression…" : "Confirmer la suppression"}
            </button>
            <button type="button" onClick={() => { setMode("view"); setError(null); }} disabled={pending}
              className="rounded-lg px-3 py-2 text-sm font-medium text-stone-500 transition hover:text-stone-700 dark:hover:text-stone-300">
              Annuler
            </button>
          </div>
        </div>
      )}

      {mode === "edit" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-stone-500">
              Sport
              <select className={inputCls} value={d.sportId ?? ""} onChange={(e) => setField("sportId", e.target.value ? Number(e.target.value) : null)}>
                <option value="">— choisir —</option>
                {sports.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
              Date
              <input type="date" className={inputCls} value={d.date} onChange={(e) => setField("date", e.target.value)} />
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs font-medium text-stone-600">
              <input type="checkbox" checked={d.isKey} onChange={(e) => setField("isKey", e.target.checked)} className="h-4 w-4 accent-alpine-600" />
              Séance clé
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
            Titre
            <input className={inputCls} value={d.title} onChange={(e) => setField("title", e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
              Distance (km)
              <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={d.distanceKm} onChange={(e) => setField("distanceKm", e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
              D+ (m)
              <input className={`${inputCls} tabular-nums`} inputMode="numeric" value={d.verticalM} onChange={(e) => setField("verticalM", e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
              Altitude (m)
              <input className={`${inputCls} tabular-nums`} inputMode="numeric" value={d.altitudeM} placeholder="ex. 2400" onChange={(e) => setField("altitudeM", e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
              Durée (min)
              <input className={`${inputCls} tabular-nums`} inputMode="numeric" value={d.durationMin} onChange={(e) => setField("durationMin", e.target.value)} />
            </label>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={pending}
              className="rounded-lg bg-alpine-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-alpine-700 disabled:opacity-50">
              {pending ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" onClick={() => { setMode("view"); setD(initial); setError(null); }} disabled={pending}
              className="rounded-lg px-3 py-2 text-sm font-medium text-stone-500 transition hover:text-stone-700 dark:hover:text-stone-300">
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
