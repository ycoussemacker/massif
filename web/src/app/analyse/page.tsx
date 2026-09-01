import { Nav } from "@/components/nav";
import { PeriodPicker } from "@/components/period-picker";
import { Sparkline } from "@/components/sparkline";
import { Heatmap } from "@/components/heatmap";
import { StackedTimeChart, StackBar, type StackSeg } from "@/components/stacked-time-chart";
import { listActivities, getSports } from "@/lib/activities";
import { aggregate, sportComposition, spreadActivities } from "@/lib/aggregate";
import { createServiceClient } from "@/lib/supabase/server";
import { todayLocal, dateMinusDays, daysBetween } from "@/lib/coach-context";
import { fmt, dur, km, meters } from "@/lib/format";
import { sportIcon, sportName } from "@/lib/labels";
import { VIZ, SERIES, PERIOD } from "@/lib/theme";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Plafond de jours lus par période, sous les 1000 lignes de PostgREST. Une comparaison A/B au-delà de
 *  ~2,5 ans par période n'a pas de sens sportif ; au-delà, on lit ce plafond ET on l'affiche. */
const MAX_PERIOD_DAYS = 900;
type Period = { from: string; to: string };
type SP = { preset?: string; aFrom?: string; aTo?: string; bFrom?: string; bTo?: string };

const addDays = (iso: string, n: number) => dateMinusDays(iso, -n);
const yearsAgo = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
};

const PRESET_LABEL: Record<string, string> = {
  "7d": "7 jours", "28d": "28 jours", "90d": "90 jours", week: "semaine", month: "mois",
  season: "saison", year: "année", custom: "période libre",
};

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
    return { preset, b: { from: weekStart, to: today }, a: { from: dateMinusDays(weekStart, 7), to: dateMinusDays(weekStart, 1) } };
  }
  if (preset === "month") {
    const [y, m] = today.split("-").map(Number);
    const firstThis = `${y}-${String(m).padStart(2, "0")}-01`;
    const pY = m === 1 ? y - 1 : y, pM = m === 1 ? 12 : m - 1;
    const firstPrev = `${pY}-${String(pM).padStart(2, "0")}-01`;
    return { preset, b: { from: firstThis, to: today }, a: { from: firstPrev, to: dateMinusDays(firstThis, 1) } };
  }
  if (preset === "season") {
    const [y, m] = today.split("-").map(Number);
    const start =
      m >= 3 && m <= 5 ? `${y}-03-01`
      : m >= 6 && m <= 8 ? `${y}-06-01`
      : m >= 9 && m <= 11 ? `${y}-09-01`
      : `${m === 12 ? y : y - 1}-12-01`;
    const elapsed = daysBetween(start, today);
    const aStart = yearsAgo(start, 1);
    return { preset, b: { from: start, to: today }, a: { from: aStart, to: addDays(aStart, elapsed) } };
  }
  if (preset === "year") {
    const y = Number(today.slice(0, 4));
    const start = `${y}-01-01`;
    const aStart = `${y - 1}-01-01`;
    return { preset, b: { from: start, to: today }, a: { from: aStart, to: addDays(aStart, daysBetween(start, today)) } };
  }
  if (preset === "custom") {
    const ok = (s?: string) => (s && DATE_RE.test(s) ? s : null);
    const a = ok(sp.aFrom) && ok(sp.aTo) ? { from: sp.aFrom!, to: sp.aTo! } : null;
    const b = ok(sp.bFrom) && ok(sp.bTo) ? { from: sp.bFrom!, to: sp.bTo! } : null;
    if (a && b) return { a, b, preset };
    return { ...rolling(28), preset };
  }
  return { ...rolling(28), preset: "28d" };
}

const avg = (nums: (number | null)[]): number | null => {
  const v = nums.filter((n): n is number => n != null);
  return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null;
};

type MetricRow = { local_date: string; ctl: number | null; atl: number | null; tsb: number | null; acwr: number | null; sleep_score: number | null; hrv_overnight_ms: number | null; resting_hr: number | null; training_readiness: number | null };

/** Δ B − A, neutral (period is not a value judgment), with an arrow + percentage. */
function Delta({ a, b, decimals = 0 }: { a: number | null; b: number | null; decimals?: number }) {
  if (a == null || b == null) return <span className="text-stone-300 dark:text-stone-600">—</span>;
  const abs = b - a;
  const pct = a !== 0 ? (abs / a) * 100 : null;
  const arrow = abs > 0 ? "▲" : abs < 0 ? "▼" : "•";
  const sign = abs > 0 ? "+" : "";
  return (
    <span className="tabular-nums text-stone-500 dark:text-stone-400">
      {arrow} {sign}{abs.toFixed(decimals)}{pct != null && <span className="text-stone-400 dark:text-stone-500"> ({sign}{pct.toFixed(0)}%)</span>} <span className="text-stone-400">vs A</span>
    </span>
  );
}

/** A metric block in the "indicateurs" style: caption + big B value + sparkline (period B) + Δ vs A. */
function StatBlock({ label, aVal, bVal, render, decimals, series, color, big = true }: {
  label: string; aVal: number | null; bVal: number | null; render: (n: number | null) => string;
  decimals: number; series?: (number | null)[]; color?: string; big?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${big ? "text-2xl" : "text-lg"}`}>{render(bVal)}</div>
      {series && <Sparkline values={series} color={color} className={`mt-1 w-full ${color ? "" : "text-stone-400"}`} />}
      <div className="mt-1 text-xs"><Delta a={aVal} b={bVal} decimals={decimals} /></div>
    </div>
  );
}

/** Cumulative-load superposition. B (recent) = bold solid; A (reference) = muted dashed. */
function CumulativeOverlay({ a, b }: { a: number[]; b: number[] }) {
  const H = 160;
  const maxLen = Math.max(a.length, b.length, 1);
  const maxCum = Math.max(1, a.at(-1) ?? 0, b.at(-1) ?? 0);
  const w = Math.max(560, maxLen * 16);
  const pts = (s: number[]) => s.map((v, i) => `${((i / Math.max(1, maxLen - 1)) * w).toFixed(1)},${(H - (v / maxCum) * H).toFixed(1)}`).join(" ");
  return (
    <div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <div className="flex w-9 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-stone-400" style={{ height: H }}>
          <span>{Math.round(maxCum)}</span><span>{Math.round(maxCum / 2)}</span><span>0</span>
        </div>
        <div className="min-w-0 overflow-x-auto">
          <div style={{ width: w }}>
            <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block">
              {[0, H / 2, H].map((y) => <line key={y} x1={0} y1={y} x2={w} y2={y} stroke="currentColor" className="text-stone-100 dark:text-stone-800" strokeWidth={1} />)}
              <polyline points={pts(a)} fill="none" stroke={PERIOD.a} strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round" strokeLinecap="round" />
              <polyline points={pts(b)} fill="none" stroke={PERIOD.b} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            {/* offset-aligned (not calendar) → a tick every 7 days of the period: j1, j8, j15… */}
            <div className="relative h-3.5 text-[10px] tabular-nums text-stone-400" style={{ width: w }}>
              {Array.from({ length: Math.ceil(maxLen / 7) }, (_, k) => 1 + k * 7).filter((d) => d <= maxLen).map((d) => (
                <span key={d} className={`absolute top-0 whitespace-nowrap ${d === 1 ? "" : "-translate-x-1/2"}`} style={{ left: ((d - 1) / Math.max(1, maxLen - 1)) * w }}>j{d}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A/B legend chip — reused so the compared periods read the same everywhere. */
function ABChip({ tag, p }: { tag: "A" | "B"; p: Period }) {
  const isB = tag === "B";
  return (
    <div className={`rounded-xl border p-3 ${isB ? "border-stone-300 dark:border-stone-600" : "border-stone-200 dark:border-stone-800"}`}>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: isB ? PERIOD.b : PERIOD.a }} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${isB ? "text-stone-700 dark:text-stone-200" : "text-stone-400"}`}>
          Période {tag} {isB ? "· récente" : "· référence"}
        </span>
      </div>
      <div className="mt-1 text-sm font-medium tabular-nums text-stone-700 dark:text-stone-300">{p.from} → {p.to}</div>
    </div>
  );
}

export default async function AnalysePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const today = todayLocal();
  const { a, b, preset } = derivePeriods(today, sp);

  const sb = await createServiceClient();
  const heatStart = yearsAgo(today, 1);
  // Widen each period's activity fetch backwards by MULTIDAY_LOOKBACK_DAYS so a multi-day expedition
  // that STARTS just before the period but spans INTO it is fetched; spreadActivities then attributes
  // only the spanned days that fall inside the period (mirrors the daily rollup). 31 d covers any
  // realistic expedition — a longer one starting >31 d before the period would lose its earliest days.
  const MULTIDAY_LOOKBACK_DAYS = 31;
  // Une lecture PAR PÉRIODE, bornée et plafonnée. Avant, un seul read couvrait lo..hi (de la plus
  // ancienne borne de A à la plus récente de B) : avec une période A ancienne, la fenêtre dépassait les
  // 1000 lignes de PostgREST, qui renvoyait alors les 1000 jours les PLUS ANCIENS — donc A servie, B
  // vide, et les six tuiles de la période récente affichées « — » comme si Garmin n'avait rien
  // enregistré. Deux lectures séparées : un écart entre les périodes ne coûte plus une seule ligne.
  const readMetrics = (p: Period) =>
    sb.from("daily_metrics").select("local_date,ctl,atl,tsb,acwr,sleep_score,hrv_overnight_ms,resting_hr,training_readiness")
      .gte("local_date", p.from).lte("local_date", p.to)
      .order("local_date", { ascending: true }).limit(MAX_PERIOD_DAYS + 1);

  const [aRes, bRes, sports, am, bm, hm] = await Promise.all([
    listActivities({ from: dateMinusDays(a.from, MULTIDAY_LOOKBACK_DAYS), to: a.to, order: "date_asc", limit: 1000 }),
    listActivities({ from: dateMinusDays(b.from, MULTIDAY_LOOKBACK_DAYS), to: b.to, order: "date_asc", limit: 1000 }),
    getSports(),
    readMetrics(a),
    readMetrics(b),
    sb.from("daily_metrics").select("local_date,daily_load")
      .gte("local_date", heatStart).lte("local_date", today)
      .order("local_date", { ascending: true }).limit(MAX_PERIOD_DAYS),
  ]);

  // La ligne sentinelle (limite + 1) rend la troncature DÉTECTABLE ; sans elle, « exactement N lignes »
  // et « il y en a plus » sont indiscernables. Quand elle arrive, on le dit à l'écran.
  const overflow = (rows: unknown[] | null) => (rows?.length ?? 0) > MAX_PERIOD_DAYS;
  const truncatedPeriods = [
    overflow(am.data) ? "A" : null,
    overflow(bm.data) ? "B" : null,
  ].filter(Boolean) as string[];
  const aM = ((am.data ?? []) as MetricRow[]).slice(0, MAX_PERIOD_DAYS);
  const bM = ((bm.data ?? []) as MetricRow[]).slice(0, MAX_PERIOD_DAYS);
  const heatDays = ((hm.data ?? []) as { local_date: string; daily_load: number }[]).map((r) => ({ date: r.local_date, load: r.daily_load ?? 0 }));

  // Per-day slices, multi-day expeditions spread across their spanned days (mirror of the rollup), then
  // clipped to each period — so a trip's load is attributed to the right period(s), like the CTL/ATL KPIs.
  const aRows = spreadActivities(aRes.rows).filter((s) => s.local_date >= a.from && s.local_date <= a.to);
  const bRows = spreadActivities(bRes.rows).filter((s) => s.local_date >= b.from && s.local_date <= b.to);

  const aAgg = aggregate(aRows), bAgg = aggregate(bRows);

  // Period-B daily series (sparklines).
  const bDays = Array.from({ length: daysBetween(b.from, b.to) + 1 }, (_, i) => addDays(b.from, i));
  const bMetBy = new Map(bM.map((m) => [m.local_date, m]));
  const bActBy = new Map<string, typeof bRows>();
  for (const r of bRows) (bActBy.get(r.local_date) ?? bActBy.set(r.local_date, []).get(r.local_date)!).push(r);
  const sumDay = (d: string, f: (x: typeof bRows[number]) => number) => (bActBy.get(d) ?? []).reduce((s, x) => s + f(x), 0);
  const seriesByLabel: Record<string, (number | null)[]> = {
    "Charge totale": bDays.map((d) => sumDay(d, (x) => x.training_load ?? 0)),
    "Aérobie": bDays.map((d) => sumDay(d, (x) => x.aerobic_load ?? 0)),
    "Neuromusculaire": bDays.map((d) => sumDay(d, (x) => x.neuromuscular_load ?? 0)),
    "Durée": bDays.map((d) => sumDay(d, (x) => x.duration_s ?? 0)),
    "Distance": bDays.map((d) => sumDay(d, (x) => x.distance_m ?? 0)),
    "Dénivelé +": bDays.map((d) => sumDay(d, (x) => x.vertical_gain_m ?? 0)),
    "Séances": bDays.map((d) => bActBy.get(d)?.length ?? 0),
    "Dénivelé −": bDays.map((d) => sumDay(d, (x) => x.vertical_loss_m ?? 0)),
    "TSB moyen": bDays.map((d) => bMetBy.get(d)?.tsb ?? null),
    "CTL moyen": bDays.map((d) => bMetBy.get(d)?.ctl ?? null),
    "ACWR moyen": bDays.map((d) => bMetBy.get(d)?.acwr ?? null),
    "Sommeil moyen": bDays.map((d) => bMetBy.get(d)?.sleep_score ?? null),
    "VFC moyenne": bDays.map((d) => bMetBy.get(d)?.hrv_overnight_ms ?? null),
    "FC repos moyenne": bDays.map((d) => bMetBy.get(d)?.resting_hr ?? null),
  };

  // Headline (big, sparkline) + detail (compact) metrics.
  type KPI = { label: string; aVal: number | null; bVal: number | null; render: (n: number | null) => string; decimals: number; color?: string };
  const summary: KPI[] = [
    { label: "Charge totale", aVal: aAgg.load, bVal: bAgg.load, render: (n) => `${fmt(n, 0)} pts`, decimals: 0 },
    { label: "Aérobie", aVal: aAgg.aerobic, bVal: bAgg.aerobic, render: (n) => `${fmt(n, 0)} pts`, decimals: 0, color: VIZ.aerobic },
    { label: "Neuromusculaire", aVal: aAgg.neuro, bVal: bAgg.neuro, render: (n) => `${fmt(n, 0)} pts`, decimals: 0, color: VIZ.neuro },
    { label: "Durée", aVal: aAgg.durationS, bVal: bAgg.durationS, render: dur, decimals: 0 },
    { label: "Distance", aVal: aAgg.distanceM, bVal: bAgg.distanceM, render: km, decimals: 0 },
    { label: "Dénivelé +", aVal: aAgg.gainM, bVal: bAgg.gainM, render: meters, decimals: 0 },
  ];
  const detail: KPI[] = [
    { label: "Séances", aVal: aAgg.sessions, bVal: bAgg.sessions, render: (n) => fmt(n, 0), decimals: 0 },
    { label: "Dénivelé −", aVal: aAgg.lossM, bVal: bAgg.lossM, render: meters, decimals: 0 },
    { label: "TSB moyen", aVal: avg(aM.map((m) => m.tsb)), bVal: avg(bM.map((m) => m.tsb)), render: (n) => fmt(n, 1), decimals: 1 },
    { label: "CTL moyen", aVal: avg(aM.map((m) => m.ctl)), bVal: avg(bM.map((m) => m.ctl)), render: (n) => fmt(n, 1), decimals: 1 },
    { label: "ACWR moyen", aVal: avg(aM.map((m) => m.acwr)), bVal: avg(bM.map((m) => m.acwr)), render: (n) => fmt(n, 2), decimals: 2 },
    { label: "Sommeil moyen", aVal: avg(aM.map((m) => m.sleep_score)), bVal: avg(bM.map((m) => m.sleep_score)), render: (n) => fmt(n, 0), decimals: 0 },
    { label: "VFC moyenne", aVal: avg(aM.map((m) => m.hrv_overnight_ms)), bVal: avg(bM.map((m) => m.hrv_overnight_ms)), render: (n) => (n == null ? "—" : `${fmt(n, 0)} ms`), decimals: 0 },
    { label: "FC repos moyenne", aVal: avg(aM.map((m) => m.resting_hr)), bVal: avg(bM.map((m) => m.resting_hr)), render: (n) => (n == null ? "—" : `${fmt(n, 0)} bpm`), decimals: 0 },
  ];

  const cumulative = (rows: typeof aRows, p: Period): number[] => {
    const days = daysBetween(p.from, p.to) + 1;
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.local_date, (byDate.get(r.local_date) ?? 0) + (r.training_load ?? 0));
    const out: number[] = [];
    let cum = 0;
    for (let i = 0; i < days; i++) { cum += byDate.get(addDays(p.from, i)) ?? 0; out.push(cum); }
    return out;
  };

  // Per-sport composition. Segments derived from BOTH periods so A and B share the same colours.
  const comp = sportComposition([...aRows, ...bRows], SERIES.length);
  const topKeys = new Set(comp.order.filter((o) => o.key !== "other").map((o) => o.key as number));
  const keyOf = (sid: number): string => (topKeys.has(sid) ? String(sid) : "other");
  const sportSegs: StackSeg[] = comp.order.map((o, idx) => ({
    key: String(o.key), color: SERIES[idx % SERIES.length],
    label: o.key === "other" ? o.name : sportName(o.code, o.name),
    glyph: o.key === "other" ? undefined : sportIcon(o.code),
  }));
  const sumByKey = (rows: typeof aRows) => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = keyOf(r.sport_id); m.set(k, (m.get(k) ?? 0) + (r.training_load ?? 0)); }
    return m;
  };
  const aByKey = sumByKey(aRows), bByKey = sumByKey(bRows);
  const bSportData = new Map<string, Map<string, number>>();
  for (const r of bRows) {
    const day = bSportData.get(r.local_date) ?? new Map<string, number>();
    const k = keyOf(r.sport_id);
    day.set(k, (day.get(k) ?? 0) + (r.training_load ?? 0));
    bSportData.set(r.local_date, day);
  }

  // Per-channel (aéro/neuro) over period B.
  const channelSegs: StackSeg[] = [
    { key: "aer", color: VIZ.aerobic, label: "aérobie" },
    { key: "neu", color: VIZ.neuro, label: "neuromusculaire" },
  ];
  const bChannelData = new Map<string, Map<string, number>>();
  for (const r of bRows) {
    const day = bChannelData.get(r.local_date) ?? new Map<string, number>();
    day.set("aer", (day.get("aer") ?? 0) + (r.aerobic_load ?? 0));
    day.set("neu", (day.get("neu") ?? 0) + (r.neuromuscular_load ?? 0));
    bChannelData.set(r.local_date, day);
  }

  const card = "rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900";

  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current="analyse" />

        <header className="mb-6">
          <h1 className="text-lg font-bold tracking-tight">
            Analyse <span className="font-normal text-stone-400">— {PRESET_LABEL[preset] ?? preset}</span>
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Tout est lu côté <span className="font-medium text-stone-700 dark:text-stone-300">période B</span> (récente),
            comparé à <span className="font-medium text-stone-700 dark:text-stone-300">période A</span> (référence). Δ = B − A.
          </p>
        </header>

        <div className="space-y-5">
          <PeriodPicker />

          {/* Troncature DITE, jamais muette : au-delà du plafond de lecture, les moyennes de forme et de
              récupération ne portent que sur le début de la période — l'athlète doit le savoir, sinon un
              « — » ou une moyenne partielle se lit comme une absence de données. */}
          {truncatedPeriods.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              <span aria-hidden className="leading-snug">⚠️</span>
              <span>
                Période {truncatedPeriods.join(" et ")} trop longue : les moyennes de forme et de
                récupération ne portent que sur les {MAX_PERIOD_DAYS} premiers jours. Resserre
                l&apos;intervalle pour une comparaison complète.
              </span>
            </p>
          )}

          {/* Quelles périodes — rendu explicite */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ABChip tag="B" p={b} />
            <ABChip tag="A" p={a} />
          </section>

          {/* Résumé — gros chiffres période B + Δ vs A + tendance B */}
          <section className={card}>
            <h2 className="mb-4 text-sm font-medium text-stone-700 dark:text-stone-300">Résumé</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              {summary.map((k) => (
                <StatBlock key={k.label} label={k.label} aVal={k.aVal} bVal={k.bVal} render={k.render} decimals={k.decimals} series={seriesByLabel[k.label]} color={k.color} />
              ))}
            </div>
          </section>

          {/* Superposition — montée en charge cumulée A vs B */}
          <section className={card}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">Montée en charge — superposition</h2>
              <div className="flex gap-3 text-xs text-stone-500 dark:text-stone-400">
                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: PERIOD.b }} />B</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: PERIOD.a }} />A</span>
              </div>
            </div>
            <CumulativeOverlay a={cumulative(aRows, a)} b={cumulative(bRows, b)} />
          </section>

          {/* Charge par sport — évolution (période B) + répartition A vs B (couleurs par sport) */}
          <section className={card}>
            {sportSegs.length === 0 ? (
              <p className="py-4 text-center text-sm text-stone-500">Aucune activité sur ces périodes.</p>
            ) : (
              <>
                <StackedTimeChart label="Charge par sport — période B" dates={bDays} segments={sportSegs} data={bSportData} unit="points de charge / jour" />
                <div className="mt-5 space-y-2">
                  <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">Répartition — A vs B</div>
                  <div className="flex items-center gap-2"><span className="w-4 shrink-0 text-xs text-stone-400">A</span><StackBar segments={sportSegs} data={aByKey} /></div>
                  <div className="flex items-center gap-2"><span className="w-4 shrink-0 text-xs text-stone-400">B</span><StackBar segments={sportSegs} data={bByKey} /></div>
                </div>
              </>
            )}
          </section>

          {/* Charge par canal — évolution (période B) */}
          <section className={card}>
            <StackedTimeChart label="Charge par canal — période B" dates={bDays} segments={channelSegs} data={bChannelData} unit="points de charge / jour" />
          </section>

          {/* Récup & forme — détails (moyennes B + Δ) */}
          <section className={card}>
            <h2 className="mb-4 text-sm font-medium text-stone-700 dark:text-stone-300">Récupération &amp; forme · volumes</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              {detail.map((k) => (
                <StatBlock key={k.label} label={k.label} aVal={k.aVal} bVal={k.bVal} render={k.render} decimals={k.decimals} series={seriesByLabel[k.label]} big={false} />
              ))}
            </div>
          </section>

          {/* Heatmap — régularité 12 mois */}
          <section className={card}>
            <h2 className="mb-3 text-sm font-medium text-stone-700 dark:text-stone-300">Régularité — charge quotidienne (12 mois)</h2>
            <Heatmap days={heatDays} />
          </section>
        </div>

        <footer className="mt-8 text-center text-xs text-stone-400">
          Massif · A {a.from}→{a.to} · B {b.from}→{b.to}
        </footer>
      </div>
    </div>
  );
}
