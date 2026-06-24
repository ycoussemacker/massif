"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseEventText } from "@/lib/event-parse";
import { createPlannedEvent, estimatePlannedEvent } from "@/app/actions";
import { sportIcon } from "@/lib/labels";
import { daysBetween } from "@/lib/coach-context";
import { useRegen } from "./regen-provider";
import type { SportOption } from "@/lib/activities";
import type { LoadEstimate } from "@/lib/estimate";

/** Quick-add for a planned activity the athlete declares ("samedi grosse rando 1500 D+ avec les potes").
 *  Free-text → heuristic parse → EDITABLE draft (sport/date/D+/charge estimée) → save as a planned_sessions
 *  row (the coach then plans around it). Bordered card — never the bg-massif gradient (reserved for the
 *  coach CTA). Design system: sports = glyph + name, never coloured; numbers tabular-nums. */

type Draft = {
  date: string;
  sportId: number | null;
  title: string;
  distanceKm: string;
  verticalM: string;
  altitudeM: string;
  durationMin: string;
  isKey: boolean;
  description: string;
};

const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 " +
  "placeholder:text-stone-400 focus:border-alpine-500 focus:outline-none focus:ring-1 focus:ring-alpine-500 " +
  "dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100";

export function QuickAddEvent({
  sports,
  defaultDate,
  variant = "inline",
  onSaved,
}: {
  sports: SportOption[];
  defaultDate?: string;
  variant?: "inline" | "modal";
  onSaved?: (date: string) => void;
}) {
  const router = useRouter();
  const regen = useRegen();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [estimate, setEstimate] = useState<LoadEstimate | null>(null);
  const [estimating, startEstimate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  // When the saved event falls in the next 7 days, offer to regenerate the week plan (background).
  const [regenAsk, setRegenAsk] = useState<string | null>(null);

  const today = (defaultDate && /^\d{4}-\d{2}-\d{2}$/.test(defaultDate))
    ? defaultDate
    : new Date().toISOString().slice(0, 10);
  const sportName = (id: number | null) => sports.find((s) => s.id === id)?.code ?? null;

  function toDeclared(d: Draft) {
    const km = parseFloat(d.distanceKm.replace(",", "."));
    const vert = parseInt(d.verticalM, 10);
    const alt = parseInt(d.altitudeM, 10);
    const min = parseInt(d.durationMin, 10);
    return {
      sport_id: d.sportId!,
      title: d.title,
      target_distance_m: Number.isFinite(km) ? Math.round(km * 1000) : null,
      target_vertical_m: Number.isFinite(vert) ? vert : null,
      target_duration_s: Number.isFinite(min) ? min * 60 : null,
      expected_altitude_m: Number.isFinite(alt) ? alt : null,
    };
  }

  function openDraft() {
    setError(null);
    setSavedMsg(null);
    const parsed = parseEventText(text, { today, sports: sports.map((s) => ({ code: s.code, name: s.display_name })) });
    const sportId = parsed.sportCode ? (sports.find((s) => s.code === parsed.sportCode)?.id ?? null) : null;
    const d: Draft = {
      date: parsed.date ?? today,
      sportId,
      title: parsed.title || "Sortie prévue",
      distanceKm: parsed.distanceM != null ? (parsed.distanceM / 1000).toString() : "",
      verticalM: parsed.verticalGainM != null ? String(parsed.verticalGainM) : "",
      altitudeM: "",
      durationMin: parsed.durationS != null ? String(Math.round(parsed.durationS / 60)) : "",
      isKey: false,
      description: parsed.description ?? "",
    };
    setDraft(d);
    setEstimate(null);
    if (sportId != null) runEstimate(d);
  }

  function runEstimate(d: Draft) {
    if (d.sportId == null) return;
    startEstimate(async () => {
      try {
        setEstimate(await estimatePlannedEvent(toDeclared(d)));
      } catch {
        setEstimate(null);
      }
    });
  }

  function save() {
    if (!draft) return;
    if (draft.sportId == null) { setError("Choisis un sport."); return; }
    setError(null);
    const d = draft;
    startTransition(async () => {
      try {
        await createPlannedEvent({
          planned_date: d.date,
          ...toDeclared(d),
          description: d.description || null,
          is_key: d.isKey,
        });
        setText("");
        setDraft(null);
        setEstimate(null);
        router.refresh();
        // Within the next 7 days → keep the panel open with a regen prompt (defer onSaved/close until
        // the athlete answers). Otherwise confirm + let the parent close.
        const realToday = new Date().toISOString().slice(0, 10);
        const offset = daysBetween(realToday, d.date);
        if (offset >= 0 && offset <= 7) { setRegenAsk(d.date); setSavedMsg(null); }
        else { setSavedMsg("Enregistré ✓"); onSaved?.(d.date); }
      } catch (e) {
        setError((e as Error)?.message ?? "Échec de l'enregistrement.");
      }
    });
  }

  const setField = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div className={variant === "inline"
      ? "rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
      : ""}>
      {!draft ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputCls}
            placeholder="Note une sortie prévue… (ex. samedi grosse rando 1500 D+)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { e.preventDefault(); openDraft(); } }}
          />
          <button
            type="button"
            onClick={openDraft}
            disabled={!text.trim()}
            className="shrink-0 rounded-lg bg-alpine-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-alpine-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Préparer
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-stone-500 sm:col-span-2">
              Sport
              <select
                className={inputCls}
                value={draft.sportId ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const next = { ...draft, sportId: id };
                  setDraft(next);
                  runEstimate(next);
                }}
              >
                <option value="">— choisir —</option>
                {sports.map((s) => (
                  <option key={s.id} value={s.id}>{s.display_name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
              Date
              <input type="date" className={inputCls} value={draft.date}
                onChange={(e) => setField("date", e.target.value)} />
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs font-medium text-stone-600">
              <input type="checkbox" checked={draft.isKey}
                onChange={(e) => setField("isKey", e.target.checked)} className="h-4 w-4 accent-alpine-600" />
              Séance clé
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
            Titre
            <input className={inputCls} value={draft.title} onChange={(e) => setField("title", e.target.value)} />
          </label>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
              Distance (km)
              <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={draft.distanceKm}
                onChange={(e) => setField("distanceKm", e.target.value)} onBlur={() => runEstimate(draft)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
              D+ (m)
              <input className={`${inputCls} tabular-nums`} inputMode="numeric" value={draft.verticalM}
                onChange={(e) => setField("verticalM", e.target.value)} onBlur={() => runEstimate(draft)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
              Altitude (m)
              <input className={`${inputCls} tabular-nums`} inputMode="numeric" value={draft.altitudeM}
                placeholder="ex. 2400" onChange={(e) => setField("altitudeM", e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
              Durée (min)
              <input className={`${inputCls} tabular-nums`} inputMode="numeric" value={draft.durationMin}
                onChange={(e) => setField("durationMin", e.target.value)} onBlur={() => runEstimate(draft)} />
            </label>
          </div>

          {/* Charge estimée — read-only, from the athlete's similar past efforts */}
          <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm dark:bg-stone-800/60">
            <span className="text-stone-500">Charge estimée</span>
            {estimating ? (
              <span className="text-stone-400">…</span>
            ) : estimate ? (
              <span className="tabular-nums text-stone-700 dark:text-stone-200">
                ~{Math.round(estimate.total)} pts
                <span className="ml-1 text-xs text-stone-400">
                  (aéro {Math.round(estimate.aerobic)} · neuro {Math.round(estimate.neuro)})
                </span>
              </span>
            ) : (
              <span className="text-xs text-stone-400">renseigne un sport + durée/D+</span>
            )}
          </div>
          {estimate?.basisLabel && !estimating && (
            <p className="-mt-1 text-[11px] text-stone-400">{estimate.basisLabel}</p>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={pending}
              className="rounded-lg bg-alpine-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-alpine-700 disabled:cursor-not-allowed disabled:opacity-50">
              {pending ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" onClick={() => { setDraft(null); setError(null); }}
              className="rounded-lg px-3 py-2 text-sm font-medium text-stone-500 transition hover:text-stone-700 dark:hover:text-stone-300">
              Annuler
            </button>
          </div>
        </div>
      )}

      {savedMsg && !draft && !regenAsk && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{savedMsg}</p>}

      {/* Activité dans les 7 j → proposer de régénérer le plan (en arrière-plan, non bloquant). */}
      {regenAsk && !draft && (
        <div className="mt-2 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
          <p className="text-sm text-stone-700 dark:text-stone-200">
            Enregistré ✓ — c&apos;est dans les 7 jours. Régénérer le plan de la semaine pour que le coach
            en tienne compte&nbsp;? <span className="text-stone-400">(en arrière-plan, tu peux continuer)</span>
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => { regen.regenerate(); const dt = regenAsk; setRegenAsk(null); onSaved?.(dt); }}
              className="rounded-lg bg-alpine-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-alpine-700">
              Régénérer le plan
            </button>
            <button type="button" onClick={() => { const dt = regenAsk; setRegenAsk(null); onSaved?.(dt); }}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-500 transition hover:text-stone-700 dark:hover:text-stone-300">
              Plus tard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
