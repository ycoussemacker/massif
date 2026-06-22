"use client";

/** A-vs-B period picker for the analysis page. URL-driven (preset or 4 custom dates) so the page stays
 *  a server component. Selection highlight uses alpine to mean "active" (same affordance as the nav). */
import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const PRESETS: { key: string; label: string }[] = [
  { key: "7d", label: "7 jours" },
  { key: "28d", label: "28 jours" },
  { key: "90d", label: "90 jours" },
  { key: "week", label: "Cette semaine" },
  { key: "month", label: "Ce mois" },
  { key: "custom", label: "Personnalisé" },
];

export function PeriodPicker() {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const preset = sp.get("preset") ?? "28d";

  const push = (mut: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(sp.toString());
    mut(p);
    start(() => router.replace(`/analyse?${p.toString()}`, { scroll: false }));
  };

  const choosePreset = (key: string) =>
    push((p) => {
      p.set("preset", key);
      if (key !== "custom") ["aFrom", "aTo", "bFrom", "bTo"].forEach((k) => p.delete(k));
    });

  const inputCls =
    "rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-alpine-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100";
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      on
        ? "border-alpine-300 bg-alpine-100 text-alpine-700 dark:border-alpine-700 dark:bg-alpine-900/50 dark:text-alpine-300"
        : "border-stone-200 text-stone-600 hover:border-stone-300 dark:border-stone-700 dark:text-stone-300"
    }`;

  const dateField = (key: string, label: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{label}</span>
      <input type="date" value={sp.get(key) ?? ""} onChange={(e) => push((p) => (e.target.value ? p.set(key, e.target.value) : p.delete(key)))} className={inputCls} />
    </label>
  );

  return (
    <div className={`rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 ${pending ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => choosePreset(p.key)} className={chip(preset === p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="flex flex-wrap items-end gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-400">Période A</span>
            {dateField("aFrom", "Du")}
            {dateField("aTo", "Au")}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-400">Période B</span>
            {dateField("bFrom", "Du")}
            {dateField("bTo", "Au")}
          </div>
        </div>
      )}
    </div>
  );
}
