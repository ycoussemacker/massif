"use client";

import { useState, useTransition } from "react";
import { setBriefingMode } from "@/app/actions";

/** Profil control — choose how the daily briefing is generated. Saves immediately (column-scoped action,
 *  never touches the coach persona/voice). On the design system: neutral stone, bordered-not-shadowed. */
export function BriefingModeSetting({ initial }: { initial: "free" | "ai" }) {
  const [mode, setMode] = useState<"free" | "ai">(initial);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(m: "free" | "ai") {
    if (m === mode || isPending) return;
    const prev = mode;
    setMode(m); setSaved(false); setError(null);
    startTransition(async () => {
      try {
        await setBriefingMode(m);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2500);
      } catch (e) {
        setMode(prev);
        setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
      }
    });
  }

  const OPTIONS: { v: "free" | "ai"; label: string; hint: string }[] = [
    { v: "free", label: "Gratuit", hint: "100 % automatique · 0 token" },
    { v: "ai", label: "IA", hint: "voix du coach · consomme des tokens" },
  ];

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">Briefing du coach</h2>
        {isPending ? <span className="text-xs text-stone-400">Enregistrement…</span>
          : saved ? <span className="text-xs text-emerald-600 dark:text-emerald-400">Enregistré ✓</span> : null}
      </div>
      <p className="mb-3 text-xs text-stone-500 dark:text-stone-400">
        Comment ta séance du jour + ton plan de la semaine sont générés.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => {
          const active = mode === o.v;
          return (
            <button
              key={o.v}
              type="button"
              aria-pressed={active}
              disabled={isPending}
              onClick={() => choose(o.v)}
              className={`flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition disabled:opacity-60 ${
                active
                  ? "border-alpine-500 bg-alpine-50 dark:bg-alpine-950/30"
                  : "border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800"
              }`}
            >
              <span className={`text-sm font-semibold ${active ? "text-alpine-700 dark:text-alpine-300" : "text-stone-700 dark:text-stone-200"}`}>
                {o.label}
              </span>
              <span className="text-xs text-stone-500 dark:text-stone-400">{o.hint}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
        {mode === "ai"
          ? "Le plan reste calculé automatiquement ; un petit appel IA réécrit la séance du jour et le résumé dans la voix de ton coach."
          : "Briefing 100 % automatique, gratuit et instantané. Le chat avec ton coach reste disponible quand tu le sollicites, dans les deux modes."}
      </p>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    </section>
  );
}
