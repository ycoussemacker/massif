"use client";

/** URL-driven filters for the activities page. Keeps the page a server component: every change rewrites
 *  the query string (debounced for the text input) and the server re-queries + re-renders.
 *
 *  Two responsive shapes, ONE source of truth (the URL — both shapes read `useSearchParams`):
 *   - **< lg**: a slim sticky bar (search + a "Filtres" button with an active-count badge) that opens a
 *     bottom-sheet holding every control; applied filters surface as removable chips under the bar.
 *   - **lg+**: a persistent left rail with the full control set always visible (uses the horizontal space).
 *
 *  Selection highlight uses alpine to mean "active filter" (same affordance as the nav), never to colour a
 *  sport by physiology — sports stay glyph + name (design system). */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sportIcon, sportName, TAXONOMY_FR, TAXONOMY_ORDER } from "@/lib/labels";

type SportOpt = { id: number; code: string | null; display_name: string; taxonomy_group: string | null };

const ORDER_LABELS: Record<string, string> = {
  date_desc: "Plus récentes",
  date_asc: "Plus anciennes",
  load_desc: "Charge décroissante",
};

const inputCls =
  "rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-alpine-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100";

const chipCls = (on: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
    on
      ? "border-alpine-300 bg-alpine-100 text-alpine-700 dark:border-alpine-700 dark:bg-alpine-900/50 dark:text-alpine-300"
      : "border-stone-200 text-stone-600 hover:border-stone-300 dark:border-stone-700 dark:text-stone-300"
  }`;

const FunnelIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </svg>
);

export function ActivityFilters({ sports, resultCount }: { sports: SportOpt[]; resultCount: number }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [sheet, setSheet] = useState(false);

  const selSports = useMemo(
    // .filter(Number.isFinite) matches the server's parse (page.tsx) — a stale/edited `?sport=abc`
    // must not yield a NaN in the set (ghost chip + inflated count while the server ignores it).
    () => new Set((sp.get("sport") ?? "").split(",").filter(Boolean).map(Number).filter(Number.isFinite)),
    [sp],
  );
  const rpePending = sp.get("rpe") === "pending";
  const sort = sp.get("sort") ?? "date_desc";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const min = sp.get("min") ?? "";
  const max = sp.get("max") ?? "";

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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size) p.set("sport", [...next].join(","));
      else p.delete("sport");
    });

  // Debounced keyword input (local state for snappy typing, pushed after a pause).
  const [q, setQ] = useState(sp.get("q") ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      // Read the LIVE URL at fire time (not the captured `sp`), so a filter toggled within the 300 ms
      // window isn't clobbered; and skip a redundant navigation when q already matches the URL.
      const v = q.trim();
      const p = new URLSearchParams(window.location.search);
      if ((p.get("q") ?? "") === v) return;
      if (v) p.set("q", v); else p.delete("q");
      p.delete("page");
      start(() => router.replace(`/activites?${p.toString()}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const reset = () => {
    setQ("");
    start(() => router.replace("/activites", { scroll: false }));
  };

  // Lock body scroll + Escape-to-close while the mobile sheet is open (mirrors help.tsx).
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [sheet]);

  const hasFilters = q.trim() !== "" || [...sp.keys()].some((k) => k !== "page" && k !== "sort");
  const activeCount =
    (q.trim() ? 1 : 0) + selSports.size + (from || to ? 1 : 0) + (min || max ? 1 : 0) + (rpePending ? 1 : 0);

  // Sports grouped by family (taxonomy) → scannable sections instead of a 27-chip wall.
  const groups = TAXONOMY_ORDER
    .map((g) => ({ g, label: TAXONOMY_FR[g], items: sports.filter((s) => (s.taxonomy_group ?? "other") === g) }))
    .filter((x) => x.items.length > 0);

  // Applied-filter chips (mobile, under the bar) — each removes just its own filter.
  const sportById = new Map(sports.map((s) => [s.id, s]));
  const activeChips: { key: string; label: React.ReactNode; aria: string; remove: () => void }[] = [];
  if (q.trim()) activeChips.push({ key: "q", label: <>« {q.trim()} »</>, aria: `recherche « ${q.trim()} »`, remove: () => { setQ(""); setParam("q", null); } });
  for (const id of selSports) {
    const s = sportById.get(id);
    const name = sportName(s?.code, s?.display_name ?? "");
    activeChips.push({
      key: `s${id}`,
      label: <><span aria-hidden>{sportIcon(s?.code)}</span> {name}</>,
      aria: name,
      remove: () => toggleSport(id),
    });
  }
  if (from || to) activeChips.push({
    key: "date",
    label: <>{from ? `du ${from}` : ""}{from && to ? " " : ""}{to ? `au ${to}` : ""}</>,
    aria: `période ${from ? `du ${from}` : ""}${from && to ? " " : ""}${to ? `au ${to}` : ""}`.trim(),
    remove: () => apply((p) => { p.delete("from"); p.delete("to"); }),
  });
  if (min || max) activeChips.push({
    key: "load",
    label: <>charge {min ? `≥ ${min}` : ""}{min && max ? " · " : ""}{max ? `≤ ${max}` : ""}</>,
    aria: `charge ${min ? `≥ ${min}` : ""}${min && max ? " " : ""}${max ? `≤ ${max}` : ""}`.trim(),
    remove: () => apply((p) => { p.delete("min"); p.delete("max"); }),
  });
  if (rpePending) activeChips.push({ key: "rpe", label: <>RPE à saisir</>, aria: "RPE à saisir", remove: () => setParam("rpe", null) });

  // --- Shared control fragments (reused by the rail and the sheet) --------------------------------
  const SearchField = (
    <input
      type="search"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Rechercher un nom d'activité…"
      aria-label="Rechercher par mot-clé"
      className={`w-full ${inputCls}`}
    />
  );

  const SortField = (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Trier</span>
      <select
        value={sort}
        onChange={(e) => setParam("sort", e.target.value === "date_desc" ? null : e.target.value)}
        aria-label="Trier"
        className={inputCls}
      >
        {Object.entries(ORDER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  );

  const SportGroups = (
    <div className="space-y-3">
      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Sports</span>
      {groups.map(({ g, label, items }) => (
        <div key={g}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{label}</div>
          <div className="flex flex-wrap gap-1.5">
            {items.map((s) => (
              <button key={s.id} type="button" onClick={() => toggleSport(s.id)} className={chipCls(selSports.has(s.id))}>
                <span aria-hidden>{sportIcon(s.code)}</span>
                {sportName(s.code, s.display_name)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const RangeFields = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Du</span>
          <input type="date" value={from} onChange={(e) => setParam("from", e.target.value || null)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Au</span>
          <input type="date" value={to} onChange={(e) => setParam("to", e.target.value || null)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Charge min</span>
          <input type="number" min={0} inputMode="numeric" value={min} onChange={(e) => setParam("min", e.target.value || null)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Charge max</span>
          <input type="number" min={0} inputMode="numeric" value={max} onChange={(e) => setParam("max", e.target.value || null)} className={inputCls} />
        </label>
      </div>
      <button type="button" onClick={() => setParam("rpe", rpePending ? null : "pending")} className={chipCls(rpePending)}>
        RPE à saisir
      </button>
    </div>
  );

  return (
    <>
      {/* ============ Desktop / paysage : rail persistant ============
          lg:self-stretch makes the aside span the full flex-row height, so the inner lg:sticky card
          has room to travel and actually pins (an items-start aside would be content-height = no room). */}
      <aside className="hidden lg:block lg:w-[17rem] lg:shrink-0 lg:self-stretch">
        <div className={`lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 ${pending ? "opacity-70" : ""}`}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Filtres</h2>
            {hasFilters && (
              <button type="button" onClick={reset} className="text-xs font-medium text-stone-500 underline-offset-2 hover:text-alpine-700 hover:underline dark:text-stone-400">
                Réinitialiser
              </button>
            )}
          </div>
          <div className="space-y-4">
            {SearchField}
            {SortField}
            {SportGroups}
            {RangeFields}
          </div>
        </div>
      </aside>

      {/* ============ Mobile / tablette : barre compacte + chips + bottom-sheet ============
          Emitted as SIBLINGS (no enclosing wrapper) so the sticky bar's containing block is the tall
          page column, not a short wrapper — otherwise it can only travel a few px and never pins. */}
      <div className={`lg:hidden sticky top-[calc(env(safe-area-inset-top)+0.5rem)] z-30 flex items-center gap-2 rounded-2xl border border-stone-200 bg-white/95 p-2 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95 ${pending ? "opacity-70" : ""}`}>
          <div className="min-w-0 flex-1">{SearchField}</div>
          <button
            type="button"
            onClick={() => setSheet(true)}
            aria-label="Ouvrir les filtres"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-alpine-400 dark:border-stone-700 dark:text-stone-200"
          >
            {FunnelIcon}
            Filtres
            {activeCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-alpine-600 px-1 text-[11px] font-semibold tabular-nums text-white">
                {activeCount}
              </span>
            )}
          </button>
        </div>

        {activeChips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 lg:hidden">
            {activeChips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={c.remove}
                aria-label={`Retirer le filtre : ${c.aria}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-alpine-300 bg-alpine-100 px-2.5 py-1 text-xs font-medium text-alpine-700 transition-colors hover:bg-alpine-200/70 dark:border-alpine-700 dark:bg-alpine-900/50 dark:text-alpine-300"
              >
                {c.label}
                <span aria-hidden className="text-alpine-500 dark:text-alpine-400">✕</span>
              </button>
            ))}
            <button type="button" onClick={reset} className="ml-1 text-xs font-medium text-stone-500 underline-offset-2 hover:text-alpine-700 hover:underline dark:text-stone-400">
              Tout effacer
            </button>
          </div>
        )}

        {sheet && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[1px] sm:items-center sm:p-4 lg:hidden"
            onClick={() => setSheet(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Filtres"
          >
            <div
              className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white sm:max-w-lg sm:rounded-2xl dark:bg-stone-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3 dark:border-stone-800">
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-50">Filtres</h3>
                <button
                  type="button"
                  onClick={() => setSheet(false)}
                  aria-label="Fermer"
                  className="-mr-1 rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {SortField}
                {SportGroups}
                {RangeFields}
              </div>
              <div className="flex items-center gap-3 border-t border-stone-200 px-5 py-3 dark:border-stone-800">
                <button type="button" onClick={reset} className="text-sm font-medium text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200">
                  Réinitialiser
                </button>
                <button
                  type="button"
                  onClick={() => setSheet(false)}
                  className="ml-auto rounded-lg bg-alpine-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-alpine-700"
                >
                  Voir {resultCount} résultat{resultCount > 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}
