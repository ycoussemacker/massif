"use client";

import { useState, useTransition } from "react";
import { createGoal, updateGoal, deleteGoal, setGoalStatus, reorderGoals, type GoalInput } from "@/app/profil/actions";
import { sportIcon } from "@/lib/labels";
import type { Goal, SportOption } from "@/lib/profile-types";

const KIND_FR: Record<string, string> = {
  race: "Course", performance: "Performance", volume: "Volume", skill: "Technique", other: "Autre",
};

/** Whole days from today (athlete-agnostic, UTC midnight) to an ISO date; null if no date. */
function daysTo(dateISO: string | null): number | null {
  if (!dateISO) return null;
  const ms = Date.parse(dateISO + "T00:00:00Z") - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function deadlineLabel(g: Goal): string | null {
  const d = daysTo(g.target_date);
  if (d != null) return d >= 0 ? `J−${d}` : `passé (${-d} j)`;
  return g.target_horizon ?? null;
}

const inputCls =
  "rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-alpine-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100";

/** Add/edit form for one goal. Title + optional sport/type + deadline (date OR horizon) + detail. */
function GoalForm({
  sports, initial, onSubmit, onCancel, pending, submitLabel,
}: {
  sports: SportOption[];
  initial?: Partial<Goal>;
  onSubmit: (input: GoalInput) => void;
  onCancel?: () => void;
  pending: boolean;
  submitLabel: string;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [sportId, setSportId] = useState<string>(initial?.sport_id != null ? String(initial.sport_id) : "");
  const [kind, setKind] = useState<string>(initial?.kind ?? "");
  const [date, setDate] = useState(initial?.target_date ?? "");
  const [horizon, setHorizon] = useState(initial?.target_horizon ?? "");
  const [detail, setDetail] = useState(initial?.target_detail ?? "");

  const submit = () => {
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      sport_id: sportId ? Number(sportId) : null,
      kind: kind || null,
      target_date: date || null,
      target_horizon: horizon.trim() || null,
      target_detail: detail.trim() || null,
    });
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800/50">
      <div className="flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Objectif (ex. Roubion-Nice 100K, réussir un 7a…)"
          autoFocus
          className={`${inputCls} min-w-[12rem] flex-1`}
        />
        <select value={sportId} onChange={(e) => setSportId(e.target.value)} className={inputCls} title="Sport (optionnel)">
          <option value="">Sport : aucun</option>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls} title="Type (optionnel)">
          <option value="">Type</option>
          {Object.entries(KIND_FR).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-stone-500">
          Échéance
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </label>
        <span className="text-xs text-stone-400">ou</span>
        <input
          value={horizon}
          onChange={(e) => setHorizon(e.target.value)}
          placeholder="échéance libre (ex. avant mes 30 ans)"
          className={`${inputCls} min-w-[10rem] flex-1`}
        />
        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="détail (ex. 100 km / 5000 D+)"
          className={`${inputCls} min-w-[10rem] flex-1`}
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !title.trim()}
          className="rounded-lg bg-alpine-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-alpine-500 disabled:opacity-50"
        >
          {pending ? "…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={pending}
            className="rounded-lg px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-700">
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}

export function GoalsEditor({ goals, sports }: { goals: Goal[]; sports: SportOption[] }) {
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = goals.filter((g) => g.status === "active");
  const done = goals.filter((g) => g.status !== "active");

  const run = (fn: () => Promise<void>, after?: () => void) =>
    start(async () => {
      setError(null);
      try {
        await fn();
        after?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      }
    });

  const move = (index: number, dir: -1 | 1) => {
    const next = [...active];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    run(() => reorderGoals(next.map((g) => g.id)));
  };

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">
          Objectifs <span className="font-normal text-stone-400">· classés par importance</span>
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => { setAdding(true); setEditingId(null); }}
            className="rounded-lg bg-alpine-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-alpine-500"
          >
            + Objectif
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {adding && (
        <div className="mb-3">
          <GoalForm
            sports={sports}
            pending={pending}
            submitLabel="Ajouter"
            onSubmit={(input) => run(() => createGoal(input), () => setAdding(false))}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      <ol className="space-y-2">
        {active.map((g, i) =>
          editingId === g.id ? (
            <li key={g.id}>
              <GoalForm
                sports={sports}
                initial={g}
                pending={pending}
                submitLabel="Enregistrer"
                onSubmit={(input) => run(() => updateGoal(g.id, input), () => setEditingId(null))}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li
              key={g.id}
              className="flex items-start gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800"
            >
              <div className="flex flex-col items-center pt-0.5">
                <button type="button" disabled={pending || i === 0} onClick={() => move(i, -1)}
                  className="text-stone-400 hover:text-stone-700 disabled:opacity-20 dark:hover:text-stone-200" title="Monter">▲</button>
                <span className="text-xs font-semibold tabular-nums text-stone-400">{i + 1}</span>
                <button type="button" disabled={pending || i === active.length - 1} onClick={() => move(i, 1)}
                  className="text-stone-400 hover:text-stone-700 disabled:opacity-20 dark:hover:text-stone-200" title="Descendre">▼</button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {g.sport_code && <span aria-hidden>{sportIcon(g.sport_code)}</span>}
                  <span className="font-medium text-stone-900 dark:text-stone-100">{g.title}</span>
                  {g.kind && (
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                      {KIND_FR[g.kind] ?? g.kind}
                    </span>
                  )}
                  {deadlineLabel(g) && (
                    <span className="rounded bg-alpine-50 px-1.5 py-0.5 text-xs font-medium text-alpine-700 dark:bg-alpine-950/50 dark:text-alpine-300">
                      {deadlineLabel(g)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-stone-500 dark:text-stone-400">
                  {g.sport_name && <span>{g.sport_name}</span>}
                  {g.target_detail && <span>{g.target_detail}</span>}
                  {g.target_date && <span className="tabular-nums">{g.target_date}</span>}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1 text-xs">
                <button type="button" disabled={pending} onClick={() => { setEditingId(g.id); setAdding(false); }}
                  className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" title="Modifier">Modifier</button>
                <button type="button" disabled={pending} onClick={() => run(() => setGoalStatus(g.id, "achieved"))}
                  className="rounded px-2 py-1 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40" title="Marquer atteint">✓ Atteint</button>
                <button type="button" disabled={pending}
                  onClick={() => { if (confirm(`Supprimer « ${g.title} » ?`)) run(() => deleteGoal(g.id)); }}
                  className="rounded px-2 py-1 text-stone-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40" title="Supprimer">✕</button>
              </div>
            </li>
          )
        )}
        {active.length === 0 && !adding && (
          <li className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500 dark:border-stone-700">
            Aucun objectif. Ajoute-en un — le coach raisonnera dessus par ordre d&apos;importance.
          </li>
        )}
      </ol>

      {done.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-stone-400 hover:text-stone-600">
            {done.length} objectif{done.length > 1 ? "s" : ""} atteint{done.length > 1 ? "s" : ""} / abandonné{done.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {done.map((g) => (
              <li key={g.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-stone-500 dark:text-stone-400">
                {g.sport_code && <span aria-hidden>{sportIcon(g.sport_code)}</span>}
                <span className={g.status === "achieved" ? "line-through" : ""}>{g.title}</span>
                <span className="text-xs text-stone-400">· {g.status === "achieved" ? "atteint" : "abandonné"}</span>
                <button type="button" disabled={pending} onClick={() => run(() => setGoalStatus(g.id, "active"))}
                  className="ml-auto rounded px-2 py-0.5 text-xs text-alpine-600 hover:bg-alpine-50 dark:text-alpine-400 dark:hover:bg-alpine-950/40">
                  Réactiver
                </button>
                <button type="button" disabled={pending}
                  onClick={() => { if (confirm(`Supprimer « ${g.title} » ?`)) run(() => deleteGoal(g.id)); }}
                  className="rounded px-2 py-0.5 text-xs text-stone-400 hover:text-red-600">✕</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
