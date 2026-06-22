import Link from "next/link";
import { getDashboard, latestModel, type DailyMetric, type Activity } from "@/lib/data";
import { FitnessChart, FormChart, ChannelChart, Gauge, type Zone } from "@/components/charts";
import { RpeControl } from "@/components/rpe";
import { StravaLink } from "@/components/brand";
import { Nav } from "@/components/nav";
import { GoalBadge } from "@/components/goal-badge";
import { CoachHero } from "@/components/coach-hero";
import { sportName, sportIcon, aerobicSourceFr, neuroSourceFr } from "@/lib/labels";
import { todayLocal } from "@/lib/coach-context";
import { STATE } from "@/lib/theme";

export const dynamic = "force-dynamic"; // toujours refléter le dernier sync / run du coach

function fmt(n: number | null | undefined, d = 0): string {
  return n == null ? "—" : n.toFixed(d);
}
function dur(s: number | null): string {
  if (!s) return "—";
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}
function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
/** Moyenne des points par séance sur les `days` derniers jours (réf. du code couleur), ou null si aucune.
 *  Calculée sur les activités déjà chargées — la liste (15 dernières) couvre largement la fenêtre ici. */
function avgLoadRecent(
  activities: { local_date: string; training_load: number | null }[], today: string, days: number,
): number | null {
  const cutoff = isoMinusDays(today, days - 1); // fenêtre [today-(days-1) … today]
  const recent = activities.filter((a) => a.local_date >= cutoff && a.training_load != null);
  return recent.length ? recent.reduce((s, a) => s + (a.training_load ?? 0), 0) / recent.length : null;
}
/** Score d'une séance vs la moyenne récente : ambre = + lourd, bleu alpin = - lourd, neutre dans ±50 %. */
function loadVsAvgColor(load: number | null | undefined, avg: number | null): string | undefined {
  if (load == null || avg == null || avg <= 0) return undefined;
  const r = load / avg;
  if (r >= 1.5) return STATE.caution;
  if (r <= 0.5) return STATE.cool;
  return undefined;
}

// Zones colorées (bon ↔ risqué) pour les jauges.
const tsbZones = (v: number, min: number, max: number): Zone[] => [
  { from: min, to: -30, color: STATE.rest, label: "surmenage / risque" },
  { from: -30, to: -10, color: STATE.caution, label: "charge productive" },
  { from: -10, to: 8, color: STATE.neutral, label: "équilibre" },
  { from: 8, to: max, color: STATE.ready, label: "frais / affûté" },
];
const acwrZones = (max: number): Zone[] => [
  { from: 0, to: 0.8, color: STATE.cool, label: "sous-charge" },
  { from: 0.8, to: 1.3, color: STATE.ready, label: "zone idéale" },
  { from: 1.3, to: 1.5, color: STATE.caution, label: "élevé" },
  { from: 1.5, to: max, color: STATE.rest, label: "risque de blessure" },
];
const readyZones: Zone[] = [
  { from: 0, to: 30, color: STATE.rest, label: "très bas" },
  { from: 30, to: 50, color: STATE.caution, label: "bas" },
  { from: 50, to: 70, color: STATE.cautionSoft, label: "modéré" },
  { from: 70, to: 100, color: STATE.ready, label: "bon" },
];

function latestRecovery(metrics: DailyMetric[]): DailyMetric | null {
  // Use the last row with a FINALIZED night (sleep OR overnight HRV present). training_readiness can
  // land alone early in the morning, BEFORE the night's sleep/stress/HRV sync — picking such a partial
  // row would blank the whole card, so fall back to the last complete night instead.
  for (let i = metrics.length - 1; i >= 0; i--) {
    const m = metrics[i];
    if (m.sleep_score != null || m.hrv_overnight_ms != null) return m;
  }
  return null;
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-50"
        style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-xs text-stone-500 dark:text-stone-400">{sub}</div>}
    </div>
  );
}

// Recovery colour codes (good / borderline / poor for training). FC repos & VFC are relative to the
// athlete's personal baseline; the rest use sensible absolute thresholds.
const OK = STATE.ready, WARN = STATE.caution, BAD = STATE.rest;
const cRestingHr = (v: number | null, base: number | null) =>
  v == null || base == null ? undefined : v - base <= 2 ? OK : v - base <= 6 ? WARN : BAD;
const cSleep = (v: number | null) => (v == null ? undefined : v >= 80 ? OK : v >= 65 ? WARN : BAD);
const cHrv = (status: string | null) => {
  const s = status?.toLowerCase();
  return !s ? undefined : s === "balanced" ? OK : s === "low" || s === "poor" ? BAD : WARN;
};
const cStress = (v: number | null) => (v == null ? undefined : v <= 25 ? OK : v <= 50 ? WARN : BAD);
const cReadiness = (v: number | null) => (v == null ? undefined : v >= 65 ? OK : v >= 40 ? WARN : BAD);
const cBattery = (high: number | null) => (high == null ? undefined : high >= 70 ? OK : high >= 40 ? WARN : BAD);

/** Activity date — plain, tabular text. The deep-link to the original activity lives in its own
 *  explicit "Strava ↗" affordance (see StravaLink), so the date stays a neutral timestamp. */
function ActivityDate({ a, className }: { a: Activity; className: string }) {
  return <span className={`tabular-nums ${className}`}>{a.local_date}</span>;
}

export default async function Dashboard() {
  const { profile, topGoal, metrics, briefing, activities } = await getDashboard();
  const latest = latestModel(metrics);
  const rec = latestRecovery(metrics);
  const avgLoad = avgLoadRecent(activities, todayLocal(), 15);

  const tsb = latest?.tsb ?? null;
  const acwr = latest?.acwr ?? null;
  const tsbMin = Math.min(-40, (tsb ?? 0) - 5);
  const tsbMax = Math.max(20, (tsb ?? 0) + 5);
  const acwrMax = Math.max(2, (acwr ?? 0) + 0.1);

  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current="dashboard" />

        {/* Objectif principal — récap simple + accès à la personnalisation (remplace le titre de page) */}
        <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-5">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-400">Objectif principal</div>
            {topGoal ? (
              <div className="mt-1"><GoalBadge goal={topGoal} /></div>
            ) : (
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Aucun objectif défini pour l&apos;instant.</p>
            )}
          </div>
          <Link
            href="/profil"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-alpine-300 hover:text-alpine-700 dark:border-stone-700 dark:text-stone-200 dark:hover:border-alpine-700 dark:hover:text-alpine-300"
          >
            Personnaliser mes objectifs
          </Link>
        </section>

        {/* Le coach prend la parole — entrée centrale vers la discussion */}
        <CoachHero briefing={briefing} />

        {/* Indicateurs clés : chiffres + jauges colorées */}
        <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
          <h2 className="mb-4 text-sm font-medium text-stone-700 dark:text-stone-300">Indicateurs clés</h2>
          <div className="space-y-5">
            {/* CTL + ATL sur une même ligne (gain de place). Pas de code couleur : magnitudes brutes —
                le bon/risqué est dans leur rapport (TSB & ACWR, colorés ci-dessous). */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-stone-500">CTL · forme</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(latest?.ctl, 1)}</div>
                <div className="text-xs text-stone-400">charge chronique ~42 j (pts)</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-stone-500">ATL · fatigue</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(latest?.atl, 1)}</div>
                <div className="text-xs text-stone-400">charge aiguë ~7 j (pts)</div>
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              <Gauge label="TSB · forme" value={tsb} min={tsbMin} max={tsbMax} zones={tsbZones(tsb ?? 0, tsbMin, tsbMax)} />
              <Gauge label="ACWR · ratio de charge" value={acwr} min={0} max={acwrMax} zones={acwrZones(acwrMax)} />
              <Gauge label="Disponibilité (Garmin)" value={rec?.training_readiness ?? null} unit="" min={0} max={100} zones={readyZones} />
            </div>
          </div>
        </section>

        {/* Graphiques */}
        {metrics.length > 1 ? (
          <section className="mb-6 grid gap-4 lg:grid-cols-2">
            <FitnessChart metrics={metrics} />
            <FormChart metrics={metrics} />
            <div className="lg:col-span-2">
              <ChannelChart metrics={metrics} />
            </div>
          </section>
        ) : (
          <p className="mb-6 text-sm text-stone-500">Pas encore assez de jours de données pour les courbes.</p>
        )}

        {/* Récupération */}
        {rec && (
          <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
            <h2 className="mb-3 text-sm font-medium text-stone-700 dark:text-stone-300">
              Récupération (Garmin) — {rec.local_date}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="Sommeil" value={fmt(rec.sleep_score)} color={cSleep(rec.sleep_score)}
                sub={rec.sleep_duration_s ? `${(rec.sleep_duration_s / 3600).toFixed(1)} h` : "/ 100"} />
              <Tile label="VFC (HRV)" value={rec.hrv_overnight_ms != null ? `${fmt(rec.hrv_overnight_ms)} ms` : "—"}
                color={cHrv(rec.hrv_status)}
                sub={[rec.hrv_status, profile?.hrv_baseline_ms ? `base ${Math.round(profile.hrv_baseline_ms)}` : null].filter(Boolean).join(" · ") || undefined} />
              <Tile label="FC repos" value={rec.resting_hr != null ? `${rec.resting_hr} bpm` : "—"}
                color={cRestingHr(rec.resting_hr, profile?.resting_hr ?? null)}
                sub={rec.resting_hr != null && profile?.resting_hr != null
                  ? `${rec.resting_hr - profile.resting_hr >= 0 ? "+" : ""}${rec.resting_hr - profile.resting_hr} vs ${profile.resting_hr} base` : undefined} />
              <Tile label="Body Battery" value={rec.body_battery_high != null ? `${rec.body_battery_low}–${rec.body_battery_high}` : "—"}
                color={cBattery(rec.body_battery_high)} sub="min–max" />
              <Tile label="Stress" value={fmt(rec.stress_avg)} color={cStress(rec.stress_avg)} sub="/ 100 (bas = mieux)" />
              <Tile label="Disponibilité" value={fmt(rec.training_readiness)} color={cReadiness(rec.training_readiness)} sub="/ 100" />
            </div>
          </section>
        )}

        {/* Activités récentes */}
        <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">Activités récentes</h2>
            {avgLoad != null && (
              <span className="text-xs text-stone-500 dark:text-stone-400"
                title="Moyenne des points par séance sur les 15 derniers jours. Un score nettement au-dessus s'affiche en ambre (séance plus lourde que d'habitude), nettement en-dessous en bleu.">
                intensité moy. 15 j ·{" "}
                <span className="font-semibold tabular-nums text-stone-700 dark:text-stone-300">{fmt(avgLoad, 0)}</span> pts
              </span>
            )}
          </div>
          {/* Mobile (portrait) : cartes pleine largeur, sans scroll horizontal */}
          <div className="space-y-3 md:hidden">
            {activities.map((a) => (
              <div key={a.id} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    <span className="mr-1.5" aria-hidden>{sportIcon(a.sport_code)}</span>
                    {sportName(a.sport_code, a.sport)}
                  </span>
                  <ActivityDate a={a} className="text-xs text-stone-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="text-xl font-semibold tabular-nums"
                    style={loadVsAvgColor(a.training_load, avgLoad) ? { color: loadVsAvgColor(a.training_load, avgLoad) } : undefined}>
                    {fmt(a.training_load, 0)}<span className="ml-1 text-xs font-normal text-stone-400">pts</span>
                  </span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">
                    aéro {fmt(a.aerobic_load, 0)} <span className="text-stone-400 dark:text-stone-500">({aerobicSourceFr(a.load_method_used)})</span>
                    {" · "}neuro {fmt(a.neuromuscular_load, 0)} <span className="text-stone-400 dark:text-stone-500">({neuroSourceFr(a)})</span>
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                  <span>⏱ {dur(a.duration_s)}</span>
                  <span>D+ {a.vertical_gain_m != null ? Math.round(a.vertical_gain_m) : "—"} / D− {a.vertical_loss_m != null ? Math.round(a.vertical_loss_m) : "—"}</span>
                  {a.avg_hr != null && <span>FC {a.avg_hr}</span>}
                  {a.needs_manual_rpe && <RpeControl activityId={a.id} value={a.perceived_rpe} />}
                  <StravaLink source={a.source} sourceActivityId={a.source_activity_id} className="ml-auto" />
                </div>
              </div>
            ))}
            {activities.length === 0 && <p className="text-sm text-stone-500">Aucune activité.</p>}
          </div>

          {/* Paysage / desktop : tableau */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-700">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Sport</th>
                  <th className="py-2 pr-3 text-right font-medium">Charge</th>
                  <th className="py-2 pr-3 text-right font-medium">Aéro / Neuro</th>
                  <th className="py-2 pr-3 text-right font-medium">Durée</th>
                  <th className="py-2 pr-3 text-right font-medium">D+ / D−</th>
                  <th className="py-2 pr-3 text-right font-medium">FC</th>
                  <th className="py-2 pr-3 font-medium">RPE</th>
                  <th className="py-2 text-right font-medium"><span className="sr-only">Lien Strava</span></th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.id} className="border-b border-stone-100 last:border-0 dark:border-stone-800">
                    <td className="py-2 pr-3"><ActivityDate a={a} className="text-stone-500" /></td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="mr-1.5" aria-hidden>{sportIcon(a.sport_code)}</span>
                      {sportName(a.sport_code, a.sport)}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums"
                      style={loadVsAvgColor(a.training_load, avgLoad) ? { color: loadVsAvgColor(a.training_load, avgLoad) } : undefined}>
                      {fmt(a.training_load, 0)}</td>
                    <td className="py-2 pr-3 text-right text-stone-500 whitespace-nowrap">
                      <span className="tabular-nums">{fmt(a.aerobic_load, 0)}</span>{" "}
                      <span className="text-stone-400 dark:text-stone-500">{aerobicSourceFr(a.load_method_used)}</span>
                      {" / "}
                      <span className="tabular-nums">{fmt(a.neuromuscular_load, 0)}</span>{" "}
                      <span className="text-stone-400 dark:text-stone-500">{neuroSourceFr(a)}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-stone-500">{dur(a.duration_s)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-stone-500">
                      {a.vertical_gain_m != null ? Math.round(a.vertical_gain_m) : "—"} / {a.vertical_loss_m != null ? Math.round(a.vertical_loss_m) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-stone-500">{a.avg_hr ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {a.needs_manual_rpe
                        ? <RpeControl activityId={a.id} value={a.perceived_rpe} />
                        : <span className="text-stone-300 dark:text-stone-600">—</span>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <StravaLink source={a.source} sourceActivityId={a.source_activity_id} />
                    </td>
                  </tr>
                ))}
                {activities.length === 0 && (
                  <tr><td colSpan={9} className="py-4 text-center text-stone-500">Aucune activité.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-8 text-center text-xs text-stone-400">
          Massif · {metrics.length} jours de modèle · {activities.length} activités récentes
        </footer>
      </div>
    </div>
  );
}
