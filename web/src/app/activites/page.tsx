import Link from "next/link";
import { Nav } from "@/components/nav";
import { ActivityFilters } from "@/components/activity-filters";
import { ActivityCard, ActivityRow, ActivityTableHead } from "@/components/activity-row";
import { listActivities, getSports, type ActivityFilter, type ActivityOrder } from "@/lib/activities";
import { aggregate } from "@/lib/aggregate";
import { fmt, dur, km, meters, avgLoadRecent } from "@/lib/format";
import { todayLocal } from "@/lib/coach-context";
import { VIZ } from "@/lib/theme";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORDERS = new Set<ActivityOrder>(["date_desc", "date_asc", "load_desc"]);

type SP = {
  q?: string; sport?: string; from?: string; to?: string;
  min?: string; max?: string; rpe?: string; sort?: string; page?: string;
};

function num(v: string | undefined): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function StatDot({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-xs text-stone-500 dark:text-stone-400">{label}</span>
      <span className="text-sm font-medium tabular-nums text-stone-700 dark:text-stone-200">{value}</span>
    </span>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-stone-900 dark:text-stone-50">{value}</div>
    </div>
  );
}

export default async function ActivitesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;

  const filter: ActivityFilter = {
    q: sp.q?.trim() || undefined,
    sportIds: sp.sport?.split(",").map(Number).filter((n) => Number.isFinite(n)) || undefined,
    from: sp.from && DATE_RE.test(sp.from) ? sp.from : undefined,
    to: sp.to && DATE_RE.test(sp.to) ? sp.to : undefined,
    minLoad: num(sp.min),
    maxLoad: num(sp.max),
    rpePending: sp.rpe === "pending" || undefined,
    order: ORDERS.has(sp.sort as ActivityOrder) ? (sp.sort as ActivityOrder) : "date_desc",
    limit: 1000,
  };

  const [{ rows, total }, sports] = await Promise.all([listActivities(filter), getSports()]);

  const agg = aggregate(rows);
  const avgLoad = avgLoadRecent(rows, todayLocal(), 15);

  const page = Math.max(1, num(sp.page) ?? 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const qs = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") u.set(k, v as string);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return s ? `/activites?${s}` : "/activites";
  };

  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8 lg:max-w-6xl">
        <Nav current="activites" />

        <header className="mb-6">
          <h1 className="text-lg font-bold tracking-tight">
            Activités <span className="font-normal text-stone-400">— tout l&apos;historique</span>
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Filtre par sport, période ou charge, et recherche par mot-clé dans les noms d&apos;activités.
          </p>
        </header>

        <div className="lg:flex lg:items-start lg:gap-6">
          <ActivityFilters sports={sports} resultCount={rows.length} />

          <main className="mt-4 min-w-0 flex-1 space-y-5 lg:mt-0">
            {/* Bandeau de synthèse — agrégé sur la sélection courante */}
            {rows.length > 0 && (
              <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-stone-800 dark:bg-stone-900">
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">Charge totale</div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-2xl font-semibold tabular-nums">{fmt(agg.load, 0)}</span>
                      <span className="text-xs font-normal text-stone-400">pts</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <StatDot color={VIZ.aerobic} label="aéro" value={fmt(agg.aerobic, 0)} />
                    <StatDot color={VIZ.neuro} label="neuro" value={fmt(agg.neuro, 0)} />
                  </div>
                </div>
                {/* Répartition aéro/neuro — couleurs = canaux (physiologie), jamais catégorie */}
                {agg.aerobic + agg.neuro > 0 && (
                  <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800" aria-hidden>
                    <div style={{ width: `${(agg.aerobic / (agg.aerobic + agg.neuro)) * 100}%`, background: VIZ.aerobic }} />
                    <div style={{ width: `${(agg.neuro / (agg.aerobic + agg.neuro)) * 100}%`, background: VIZ.neuro }} />
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <Stat label="Séances" value={String(agg.sessions)} />
                  <Stat label="Durée" value={dur(agg.durationS)} />
                  <Stat label="Distance" value={km(agg.distanceM)} />
                  <Stat label="D+ / D−" value={`${meters(agg.gainM)} / ${meters(agg.lossM)}`} />
                </div>
              </section>
            )}

            {/* Résultats */}
            <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-stone-800 dark:bg-stone-900">
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-stone-500">Aucune activité ne correspond à ces filtres.</p>
              ) : (
                <>
                  <div className="space-y-3 md:hidden">
                    {pageRows.map((a) => <ActivityCard key={a.id} a={a} avgLoad={avgLoad} />)}
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <ActivityTableHead />
                      <tbody>
                        {pageRows.map((a) => <ActivityRow key={a.id} a={a} avgLoad={avgLoad} />)}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {pageCount > 1 && (
                    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
                      {safePage > 1
                        ? <Link href={qs(safePage - 1)} className="font-medium text-stone-600 hover:text-alpine-700 dark:text-stone-300">← Précédent</Link>
                        : <span className="text-stone-300 dark:text-stone-700">← Précédent</span>}
                      <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">Page {safePage} / {pageCount}</span>
                      {safePage < pageCount
                        ? <Link href={qs(safePage + 1)} className="font-medium text-stone-600 hover:text-alpine-700 dark:text-stone-300">Suivant →</Link>
                        : <span className="text-stone-300 dark:text-stone-700">Suivant →</span>}
                    </nav>
                  )}
                </>
              )}
            </section>
          </main>
        </div>

        <footer className="mt-8 text-center text-xs text-stone-400">
          Massif · {total} activité{total > 1 ? "s" : ""} {total !== rows.length ? `(affichage limité à ${rows.length})` : "au total"} pour cette sélection
        </footer>
      </div>
    </div>
  );
}
