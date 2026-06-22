"use client";

/** URL-driven filter bar for the activities page. Keeps the page a server component: every change
 *  rewrites the query string (debounced for the text input) and the server re-queries + re-renders.
 *  Selection highlight uses alpine to mean "active filter" (same affordance as the nav), never to
 *  colour a sport by physiology. */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sportIcon, sportName } from "@/lib/labels";

type SportOpt = { id: number; code: string | null; display_name: string };

const ORDER_LABELS: Record<string, string> = {
  date_desc: "Plus récentes",
  date_asc: "Plus anciennes",
  load_desc: "Charge décroissante",
};

export function ActivityFilters({ sports }: { sports: SportOpt[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  const selSports = new Set((sp.get("sport") ?? "").split(",").filter(Boolean).map(Number));
  const rpePending = sp.get("rpe") === "pending";

  // Push a new query string (always resetting to page 1 on any filter change).
  const apply = (mut: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(sp.toString());
    mut(p);
    p.delete("page");
    start(() => router.replace(`/activites?${p.toString()}`, { scroll: false }));
  };

  const setParam = (key: string, value: string | null) =>
    apply((p) => (value ? p.set(key, value) : p.delete(key)));

  const toggleSport = (id: number) =>
    apply((p) => {
      const next = new Set(selSports);
      next.has(id) ? next.delete(id) : next.add(id);
      next.size ? p.set("sport", [...next].join(",")) : p.delete("sport");
    });

  // Debounced keyword input (local state for snappy typing, pushed after a pause).
  const [q, setQ] = useState(sp.get("q") ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => setParam("q", q.trim() || null), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = [...sp.keys()].some((k) => k !== "page");
  const inputCls =
    "rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-alpine-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100";
  const chip = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      on
        ? "border-alpine-300 bg-alpine-100 text-alpine-700 dark:border-alpine-700 dark:bg-alpine-900/50 dark:text-alpine-300"
        : "border-stone-200 text-stone-600 hover:border-stone-300 dark:border-stone-700 dark:text-stone-300"
    }`;

  return (
    <div className={`rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 ${pending ? "opacity-70" : ""}`}>
      {/* Row 1: search + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un nom d'activité…"
          aria-label="Rechercher par mot-clé"
          className={`min-w-0 flex-1 ${inputCls}`}
        />
        <select
          value={sp.get("sort") ?? "date_desc"}
          onChange={(e) => setParam("sort", e.target.value === "date_desc" ? null : e.target.value)}
          aria-label="Trier"
          className={inputCls}
        >
          {Object.entries(ORDER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Row 2: sport chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {sports.map((s) => (
          <button key={s.id} type="button" onClick={() => toggleSport(s.id)} className={chip(selSports.has(s.id))}>
            <span aria-hidden>{sportIcon(s.code)}</span>
            {sportName(s.code, s.display_name)}
          </button>
        ))}
      </div>

      {/* Row 3: dates + load range + rpe + reset */}
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Du</span>
          <input type="date" value={sp.get("from") ?? ""} onChange={(e) => setParam("from", e.target.value || null)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Au</span>
          <input type="date" value={sp.get("to") ?? ""} onChange={(e) => setParam("to", e.target.value || null)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Charge min</span>
          <input type="number" min={0} inputMode="numeric" value={sp.get("min") ?? ""} onChange={(e) => setParam("min", e.target.value || null)} className={`w-24 ${inputCls}`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Charge max</span>
          <input type="number" min={0} inputMode="numeric" value={sp.get("max") ?? ""} onChange={(e) => setParam("max", e.target.value || null)} className={`w-24 ${inputCls}`} />
        </label>
        <button type="button" onClick={() => setParam("rpe", rpePending ? null : "pending")} className={chip(rpePending)}>
          RPE à saisir
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={() => start(() => router.replace("/activites", { scroll: false }))}
            className="text-xs font-medium text-stone-500 underline-offset-2 hover:text-alpine-700 hover:underline dark:text-stone-400"
          >
            Réinitialiser
          </button>
        )}
      </div>
    </div>
  );
}
