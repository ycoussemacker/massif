import { Nav } from "@/components/nav";
import { PeriodPicker } from "@/components/period-picker";
import { listActivities, getSports } from "@/lib/activities";
import { aggregate, aggregateBySport, type LoadAgg } from "@/lib/aggregate";
import { createServiceClient } from "@/lib/supabase/server";
import { todayLocal, dateMinusDays, daysBetween } from "@/lib/coach-context";
import { fmt, dur, km, meters } from "@/lib/format";
import { sportIcon, sportName } from "@/lib/labels";
import { VIZ } from "@/lib/theme";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
type Period = { from: string; to: string };
type SP = { preset?: string; aFrom?: string; aTo?: string; bFrom?: string; bTo?: string };

const addDays = (iso: string, n: number) => dateMinusDays(iso, -n);

/** Two periods: A = earlier (baseline), B = later (recent). Δ shown later is B vs A. */
function derivePeriods(today: string, sp: SP): { a: Period; b: Period; preset: string } {
  const preset = sp.preset ?? "28d";
  const rolling = (n: number): { a: Period; b: Period } => ({
    b: { from: dateMinusDays(today, n - 1), to: today },
    a: { from: dateMinusDays(today, 2 * n - 1), to: dateMinusDays(today, n) },
  });

  if (preset === "7d") return { ...rolling(7), preset };
  if (preset === "90d") return { ...rolling(90), preset };
  if (preset === "week") {
    const dow = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7; // 0 = Monday
    const weekStart = dateMinusDays(today, dow);
    return {
      preset,
      b: { from: weekStart, to: today },
      a: { from: dateMinusDays(weekStart, 7), to: dateMinusDays(weekStart, 1) },
    };
  }
  if (preset === "month") {
    const [y, m] = today.split("-").map(Number);
    const firstThis = `${y}-${String(m).padStart(2, "0")}-01`;
    const pY = m === 1 ? y - 1 : y, pM = m === 1 ? 12 : m - 1;
    const firstPrev = `${pY}-${String(pM).padStart(2, "0")}-01`;
    return { preset, b: { from: firstThis, to: today }, a: { from: firstPrev, to: dateMinusDays(firstThis, 1) } };
  }
  if (preset === "custom") {
    const ok = (s?: string) => (s && DATE_RE.test(s) ? s : null);
    const a = ok(sp.aFrom) && ok(sp.aTo) ? { from: sp.aFrom!, to: sp.aTo! } : null;
    const b = ok(sp.bFrom) && ok(sp.bTo) ? { from: sp.bFrom!, to: sp.bTo! } : null;
    if (a && b) return { a, b, preset };
    return { ...rolling(28), preset }; // incomplete custom → sensible fallback
  }
  return { ...rolling(28), preset: "28d" };
}

const avg = (nums: (number | null)[]): number | null => {
  const v = nums.filter((n): n is number => n != null);
  return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null;
};

type MetricRow = { local_date: string; ctl: number | null; atl: number | null; tsb: number | null; acwr: number | null; sleep_score: number | null; hrv_overnight_ms: number | null; resting_hr: number | null; training_readiness: number | null };

function Delta({ a, b, decimals = 0, invert = false }: { a: number | null; b: number | null; decimals?: number; invert?: boolean }) {
  if (a == null || b == null) return <span className="text-stone-300 dark:text-stone-600">—</span>;
  const abs = b - a;
  const pct = a !== 0 ? (abs / a) * 100 : null;
  const arrow = abs > 0 ? "▲" : abs < 0 ? "▼" : "•";
  const sign = abs > 0 ? "+" : "";
  return (
    <span className="tabular-nums text-stone-500 dark:text-stone-400">
      {arrow} {sign}{abs.toFixed(decimals)}{pct != null && <span className="text-stone-400 dark:text-stone-500"> ({sign}{pct.toFixed(0)}%)</span>}
    </span>
  );
}

/** Aligned cumulative-load overlay: A solid, B dashed (neutral stone — period is not a physiology). */
function CumulativeOverlay({ a, b }: { a: number[]; b: number[] }) {
  const H = 150;
  const maxLen = Math.max(a.length, b.length, 1);
  const maxCum = Math.max(1, a.at(-1) ?? 0, b.at(-1) ?? 0);
  const w = Math.max(560, maxLen * 14);
  const pts = (s: number[]) =>
    s.map((v, i) => `${((i / Math.max(1, maxLen - 1)) * w).toFixed(1)},${(H - (v / maxCum) * H).toFixed(1)}`).join(" ");
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
        <span className="flex items-center gap-1.5"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" className="text-stone-600 dark:text-stone-300" strokeWidth="2" /></svg>Période A</span>
        <span className="flex items-center gap-1.5"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" className="text-stone-400 dark:text-stone-500" strokeWidth="2" strokeDasharray="4 3" /></svg>Période B</span>
      </div>
      <div className="overflow-x-auto">
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block">
          {[0, H / 2, H].map((y) => <line key={y} x1={0} y1={y} x2={w} y2={y} stroke="currentColor" className="text-stone-200 dark:text-stone-800" strokeWidth={1} />)}
          <polyline points={pts(a)} fill="none" stroke="currentColor" className="text-stone-600 dark:text-stone-300" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={pts(b)} fill="none" stroke="currentColor" className="text-stone-400 dark:text-stone-500" strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <div className="mt-1 text-center text-[10px] text-stone-400">charge cumulée (points) par jour depuis le début de la période</div>
    </div>
  );
}

function PeriodHead({ tag, p, agg }: { tag: string; p: Period; agg: LoadAgg }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-400">Période {tag}</div>
      <div className="mt-0.5 text-sm font-medium tabular-nums text-stone-700 dark:text-stone-300">{p.from} → {p.to}</div>
      <div className="text-xs text-stone-400">{agg.sessions} séance{agg.sessions > 1 ? "s" : ""} · {fmt(agg.load, 0)} pts</div>
    </div>
  );
}

export default async function AnalysePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { a, b, preset } = derivePeriods(todayLocal(), sp);

  const sb = await createServiceClient();
  // Bound the metrics read to the union of both periods (avoids PostgREST's 1000-row response cap,
  // which — unbounded + ordered asc — would return only the oldest rows and miss recent periods).
  const lo = [a.from, b.from].sort()[0];
  const hi = [a.to, b.to].sort().at(-1)!;
  const [aRes, bRes, sports, mm] = await Promise.all([
    listActivities({ from: a.from, to: a.to, order: "date_asc", limit: 1000 }),
    listActivities({ from: b.from, to: b.to, order: "date_asc", limit: 1000 }),
    getSports(),
    sb.from("daily_metrics").select("local_date,ctl,atl,tsb,acwr,sleep_score,hrv_overnight_ms,resting_hr,training_readiness")
      .gte("local_date", lo).lte("local_date", hi).order("local_date", { ascending: true }),
  ]);

  const metrics = (mm.data ?? []) as MetricRow[];
  const inRange = (p: Period) => metrics.filter((m) => m.local_date >= p.from && m.local_date <= p.to);
  const aM = inRange(a), bM = inRange(b);

  const aAgg = aggregate(aRes.rows), bAgg = aggregate(bRes.rows);
  const sportById = new Map(sports.map((s) => [s.id, s]));
  const aBySport = aggregateBySport(aRes.rows), bBySport = aggregateBySport(bRes.rows);
  const sportIds = [...new Set([...aBySport.keys(), ...bBySport.keys()])]
    .sort((x, y) => ((bBySport.get(y)?.load ?? 0) + (aBySport.get(y)?.load ?? 0)) - ((bBySport.get(x)?.load ?? 0) + (aBySport.get(x)?.load ?? 0)));
  const maxSportLoad = Math.max(1, ...sportIds.map((id) => Math.max(aBySport.get(id)?.load ?? 0, bBySport.get(id)?.load ?? 0)));

  const cumulative = (rows: typeof aRes.rows, p: Period): number[] => {
    const days = daysBetween(p.from, p.to) + 1;
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.local_date, (byDate.get(r.local_date) ?? 0) + (r.training_load ?? 0));
    const out: number[] = [];
    let cum = 0;
    for (let i = 0; i < days; i++) { cum += byDate.get(addDays(p.from, i)) ?? 0; out.push(cum); }
    return out;
  };

  // KPI rows. agg keys come from activities; metric averages from daily_metrics.
  const kpis: { label: string; aVal: number | null; bVal: number | null; render: (n: number | null) => string; decimals: number }[] = [
    { label: "Séances", aVal: aAgg.sessions, bVal: bAgg.sessions, render: (n) => fmt(n, 0), decimals: 0 },
    { label: "Charge totale", aVal: aAgg.load, bVal: bAgg.load, render: (n) => `${fmt(n, 0)} pts`, decimals: 0 },
    { label: "Aérobie", aVal: aAgg.aerobic, bVal: bAgg.aerobic, render: (n) => `${fmt(n, 0)} pts`, decimals: 0 },
    { label: "Neuromusculaire", aVal: aAgg.neuro, bVal: bAgg.neuro, render: (n) => `${fmt(n, 0)} pts`, decimals: 0 },
    { label: "Durée", aVal: aAgg.durationS, bVal: bAgg.durationS, render: (n) => dur(n), decimals: 0 },
    { label: "Distance", aVal: aAgg.distanceM, bVal: bAgg.distanceM, render: (n) => km(n), decimals: 0 },
    { label: "Dénivelé +", aVal: aAgg.gainM, bVal: bAgg.gainM, render: (n) => meters(n), decimals: 0 },
    { label: "Dénivelé −", aVal: aAgg.lossM, bVal: bAgg.lossM, render: (n) => meters(n), decimals: 0 },
    { label: "TSB moyen", aVal: avg(aM.map((m) => m.tsb)), bVal: avg(bM.map((m) => m.tsb)), render: (n) => fmt(n, 1), decimals: 1 },
    { label: "CTL moyen", aVal: avg(aM.map((m) => m.ctl)), bVal: avg(bM.map((m) => m.ctl)), render: (n) => fmt(n, 1), decimals: 1 },
    { label: "ACWR moyen", aVal: avg(aM.map((m) => m.acwr)), bVal: avg(bM.map((m) => m.acwr)), render: (n) => fmt(n, 2), decimals: 2 },
    { label: "Sommeil moyen", aVal: avg(aM.map((m) => m.sleep_score)), bVal: avg(bM.map((m) => m.sleep_score)), render: (n) => fmt(n, 0), decimals: 0 },
    { label: "VFC moyenne", aVal: avg(aM.map((m) => m.hrv_overnight_ms)), bVal: avg(bM.map((m) => m.hrv_overnight_ms)), render: (n) => (n == null ? "—" : `${fmt(n, 0)} ms`), decimals: 0 },
    { label: "FC repos moyenne", aVal: avg(aM.map((m) => m.resting_hr)), bVal: avg(bM.map((m) => m.resting_hr)), render: (n) => (n == null ? "—" : `${fmt(n, 0)} bpm`), decimals: 0 },
  ];

  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current="analyse" />

        <header className="mb-6">
          <h1 className="text-lg font-bold tracking-tight">
            Analyse <span className="font-normal text-stone-400">— comparer deux périodes</span>
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Le delta (Δ) compare la période B (récente) à la période A (référence).
          </p>
        </header>

        <div className="space-y-5">
          <PeriodPicker />

          {/* En-têtes de période */}
          <section className="grid grid-cols-2 gap-4 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
            <PeriodHead tag="A" p={a} agg={aAgg} />
            <PeriodHead tag="B" p={b} agg={bAgg} />
          </section>

          {/* Tableau KPI */}
          <section className="overflow-x-auto rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-700">
                  <th className="py-2 pr-3 font-medium">Indicateur</th>
                  <th className="py-2 pr-3 text-right font-medium">Période A</th>
                  <th className="py-2 pr-3 text-right font-medium">Période B</th>
                  <th className="py-2 text-right font-medium">Δ (B vs A)</th>
                </tr>
              </thead>
              <tbody>
                {kpis.map((k) => (
                  <tr key={k.label} className="border-b border-stone-100 last:border-0 dark:border-stone-800">
                    <td className="py-2 pr-3 text-stone-600 dark:text-stone-300">{k.label}</td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums">{k.render(k.aVal)}</td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums">{k.render(k.bVal)}</td>
                    <td className="py-2 text-right text-xs"><Delta a={k.aVal} b={k.bVal} decimals={k.decimals} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Répartition par sport — barres appariées (A / B), sports neutres (glyphe + nom) */}
          <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">Charge par sport</h2>
              <div className="flex gap-3 text-xs text-stone-500 dark:text-stone-400">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm bg-stone-500 dark:bg-stone-300" />A</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm bg-stone-300 dark:bg-stone-600" />B</span>
              </div>
            </div>
            {sportIds.length === 0 ? (
              <p className="py-4 text-center text-sm text-stone-500">Aucune activité sur ces périodes.</p>
            ) : (
              <div className="space-y-3">
                {sportIds.map((id) => {
                  const s = sportById.get(id);
                  const la = aBySport.get(id)?.load ?? 0, lb = bBySport.get(id)?.load ?? 0;
                  return (
                    <div key={id} className="grid grid-cols-[8rem_1fr] items-center gap-3">
                      <div className="truncate text-sm">
                        <span className="mr-1.5" aria-hidden>{sportIcon(s?.code ?? null)}</span>
                        {sportName(s?.code ?? null, s?.display_name ?? "—")}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                            <div className="h-full rounded-full bg-stone-500 dark:bg-stone-300" style={{ width: `${(la / maxSportLoad) * 100}%` }} />
                          </div>
                          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-stone-500">{fmt(la, 0)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                            <div className="h-full rounded-full bg-stone-300 dark:bg-stone-600" style={{ width: `${(lb / maxSportLoad) * 100}%` }} />
                          </div>
                          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-stone-500">{fmt(lb, 0)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Courbe de charge cumulée alignée */}
          <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
            <h2 className="mb-3 text-sm font-medium text-stone-700 dark:text-stone-300">Montée en charge (cumulée, alignée)</h2>
            <CumulativeOverlay a={cumulative(aRes.rows, a)} b={cumulative(bRes.rows, b)} />
          </section>
        </div>

        <footer className="mt-8 text-center text-xs text-stone-400">
          Massif · comparaison {preset === "custom" ? "personnalisée" : preset}
        </footer>
      </div>
    </div>
  );
}
