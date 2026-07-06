import Link from "next/link";
import { Suspense } from "react";
import { getDashboard, latestModel, DASHBOARD_WINDOW_DAYS, type DailyMetric } from "@/lib/data";
import { ChartsSection } from "@/components/charts-section";
import { ActivityCard, ActivityRow, ActivityTableHead } from "@/components/activity-row";
import { Nav } from "@/components/nav";
import { GoalBadge } from "@/components/goal-badge";
import { PhaseChip } from "@/components/phase-chip";
import { phaseFromDaysTo } from "@/lib/briefing-algo";
import { daysTo } from "@/lib/profile-types";
import { CoachHero } from "@/components/coach-hero";
import { assembleVerdict } from "@/lib/day-verdict";
import { GarminRefresh } from "@/components/garmin-refresh";
import { SorenessInput } from "@/components/soreness-input";
import { WeekPlanPills } from "@/components/week-plan-pills";
import { AddActivityButton } from "@/components/add-activity-button";
import { Dim } from "@/components/busy";
import { getSports } from "@/lib/activities";
import { todayLocal } from "@/lib/coach-context";
import { fmt, avgLoadRecent } from "@/lib/format";
import { STATE } from "@/lib/theme";
import { DashboardBodySkeleton } from "@/components/dashboard-skeleton";

export const dynamic = "force-dynamic"; // toujours refléter le dernier sync / run du coach

function latestRecovery(metrics: DailyMetric[]): DailyMetric | null {
  for (let i = metrics.length - 1; i >= 0; i--) {
    const m = metrics[i];
    if (m.hrv_overnight_ms != null || m.sleep_score != null || m.training_readiness != null) return m;
  }
  return null;
}

/** Most recent acclimation reading in the window. Heat/altitude acclimation is a slow-moving status
 *  (days–weeks) that Garmin does NOT repopulate every day, so the latest recovery row usually lacks it —
 *  carry forward the last known value (with its date) instead of requiring it on today's row. */
function latestAcclimation(
  metrics: DailyMetric[],
): { heat: number | null; altitude: number | null; date: string } | null {
  for (let i = metrics.length - 1; i >= 0; i--) {
    const m = metrics[i];
    if (m.heat_acclimation_pct != null || m.altitude_acclimation_m != null)
      return { heat: m.heat_acclimation_pct, altitude: m.altitude_acclimation_m, date: m.local_date };
  }
  return null;
}

const fmtDayMonth = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(iso + "T00:00:00Z"));

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

const linkCls =
  "inline-flex shrink-0 items-center gap-1 text-sm font-medium text-stone-500 transition-colors hover:text-alpine-700 dark:text-stone-400 dark:hover:text-alpine-300";

export default function Dashboard() {
  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current="dashboard" />
        <Suspense fallback={<DashboardBodySkeleton />}>
          <DashboardBody />
        </Suspense>
      </div>
    </div>
  );
}

async function DashboardBody() {
  const [{ profile, topGoal, metrics, briefing, activities, allActivities, todayPlan, projection, weekPlan }, sports] = await Promise.all([
    getDashboard(),
    getSports(),
  ]);
  const latest = latestModel(metrics);
  const rec = latestRecovery(metrics);
  const acclim = latestAcclimation(metrics); // last known heat/altitude acclimation (carried forward)
  const today = todayLocal();
  const todaySoreness = metrics.find((m) => m.local_date === today)?.soreness ?? null;
  const avgLoad = avgLoadRecent(allActivities, today, 15);

  // Verdict du jour (charge réelle vs cible coach) — LLM-free, dans la voix du coach. Affiché en tête
  // de la carte coach ; le bouton "débriefer" (ci-dessous) appelle l'IA, lui.
  const { voice: verdict } = assembleVerdict({
    hasPlan: todayPlan.hasPlan, target: todayPlan.targetLoad, isRest: todayPlan.isRest,
    activities: allActivities, avgLoad, today,
  });
  // Séance(s) du jour — affichées en "snapshot" dans la carte coach + cible du bouton "Débrief".
  const todayActivities = allActivities.filter((a) => a.local_date === today);

  return (
    <>
        {/* Ton plan d'entraînement — objectif (1 ligne) + 7 jours à venir + actions. La saisie d'une
            activité prévue passe par une modale (bouton primaire) plutôt qu'un champ toujours ouvert :
            le formulaire repart vide à chaque ouverture et se ferme à l'enregistrement, ce qui évite de
            déclarer deux fois le même événement. Fusionne les ex-sections Objectif / Quick-add / plan. */}
        <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Ton plan d&apos;entraînement</h2>

          {/* 1. Objectif principal — une ligne, + la PHASE de préparation en cours (base / build /
              pré-compétition / affûtage, semaine de charge ou de décharge) dérivée de sa date. */}
          <div className="mt-2">
            {topGoal ? (
              <>
                <GoalBadge goal={topGoal} />
                <PhaseChip phase={phaseFromDaysTo(daysTo(topGoal.target_date), topGoal.title)} />
              </>
            ) : (
              <p className="text-sm text-stone-500 dark:text-stone-400">Aucun objectif défini pour l&apos;instant.</p>
            )}
          </div>

          {/* 2. Pastilles des entraînements & événements à 7 jours — grisées pendant une régénération
              du plan (le coach réécrit ces séances) ou une sync (le réalisé se lie au plan). */}
          <Dim on={["regen", "sync"]} rounded="rounded-lg" className="mt-3">
            <WeekPlanPills days={weekPlan} />
          </Dim>

          {/* 3. Call to action — consulter les objectifs (secondaire) + ajouter une activité (primaire, modale) */}
          <div className="mt-4 flex flex-col gap-2 border-t border-stone-100 pt-4 dark:border-stone-800 sm:flex-row sm:items-center sm:justify-end">
            <Link
              href="/profil"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-alpine-300 hover:text-alpine-700 dark:border-stone-700 dark:text-stone-200 dark:hover:border-alpine-700 dark:hover:text-alpine-300 sm:w-auto"
            >
              Consulter mes objectifs
            </Link>
            <AddActivityButton sports={sports} />
          </div>
        </section>

        {/* Le coach prend la parole — verdict du jour en tête, briefing repliable dessous, CTA unique.
            `tsbNeuro` alimente la puce "jambes chargées". Grisé pendant la régénération (les textes du
            brief se réécrivent) ET pendant une sync (le verdict/les activités du jour bougent). */}
        <Dim on={["regen", "sync"]} label="Mise à jour…">
          <CoachHero briefing={briefing} verdict={verdict} todayActivities={todayActivities} tsbNeuro={latest?.tsb_neuromuscular ?? null} />
        </Dim>

        {/* Indicateurs clés — CTL/ATL/TSB interactifs (sélection = scrubber) + indicateurs du jour.
            Grisés pendant la sync : c'est exactement ce que le recalcul (rollup) va réécrire. */}
        {metrics.length > 1 ? (
          <Dim on="sync" label="Recalcul du modèle…" className="mb-6">
            <ChartsSection key={`${metrics.length}-${latest?.local_date ?? ""}-${latest?.ctl ?? ""}-${latest?.tsb ?? ""}`} metrics={metrics} activities={allActivities} projection={projection} />
          </Dim>
        ) : (
          <p className="mb-6 text-sm text-stone-500">Pas encore assez de jours de données pour les indicateurs.</p>
        )}

        {/* Récupération — grisée pendant le rechargement Garmin manuel (le job cloud va réécrire ces tuiles). */}
        {rec && (
          <Dim on="garmin" label="Synchro Garmin…" className="mb-6">
          <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">
                Récupération (Garmin) — {rec.local_date}
              </h2>
              <GarminRefresh />
            </div>
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
            {/* Acclimation chaleur/altitude (Firstbeat) — statut LENT (jours–semaines) que Garmin ne
                repopule pas chaque jour, donc on reporte la dernière valeur connue (avec sa date si ce
                n'est pas celle du jour). Contexte pour lire la FC/récup, pas un score de forme. Neutre
                (stone), jamais le code couleur de la disponibilité. Ligne unique, compacte. */}
            {acclim && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-stone-100 pt-3 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
                <span className="text-stone-400 dark:text-stone-500">
                  Acclimation{acclim.date !== rec.local_date && ` (au ${fmtDayMonth(acclim.date)})`} :
                </span>
                {acclim.heat != null && (
                  <span title="Acclimatation à la chaleur (Firstbeat) — élevée = mieux protégé par temps chaud. Contexte, pas un indicateur de forme.">
                    🌡️ <span className="font-medium tabular-nums text-stone-700 dark:text-stone-300">{fmt(acclim.heat, 0)} %</span>
                  </span>
                )}
                {acclim.altitude != null && (
                  <span title="Acclimatation à l'altitude (Firstbeat), en mètres. Contexte, pas un indicateur de forme.">
                    🏔️ <span className="font-medium tabular-nums text-stone-700 dark:text-stone-300">{fmt(acclim.altitude, 0)} m</span>
                  </span>
                )}
              </div>
            )}
          </section>
          </Dim>
        )}

        {/* Courbatures — auto-évaluation neuromusculaire facultative (la VFC n'y voit rien) */}
        <div className="mb-6">
          <SorenessInput initial={todaySoreness} />
        </div>

        {/* Activités récentes — grisées pendant la sync (la liste + les charges vont se réécrire). */}
        <Dim on="sync" label="Synchronisation…">
        <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">Activités récentes</h2>
            <div className="flex items-baseline gap-3">
              {avgLoad != null && (
                <span className="text-xs text-stone-500 dark:text-stone-400"
                  title="Moyenne des points par séance sur les 15 derniers jours. Un score nettement au-dessus s'affiche en ambre (séance plus lourde que d'habitude), nettement en-dessous en bleu.">
                  intensité moy. 15 j ·{" "}
                  <span className="font-semibold tabular-nums text-stone-700 dark:text-stone-300">{fmt(avgLoad, 0)}</span> pts
                </span>
              )}
              <Link href="/activites" className={linkCls}>Voir tout →</Link>
            </div>
          </div>
          {/* Mobile (portrait) : cartes pleine largeur, sans scroll horizontal */}
          <div className="space-y-3 md:hidden">
            {activities.map((a) => <ActivityCard key={a.id} a={a} avgLoad={avgLoad} />)}
            {activities.length === 0 && <p className="text-sm text-stone-500">Aucune activité.</p>}
          </div>

          {/* Paysage / desktop : tableau */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <ActivityTableHead />
              <tbody>
                {activities.map((a) => <ActivityRow key={a.id} a={a} avgLoad={avgLoad} />)}
                {activities.length === 0 && (
                  <tr><td colSpan={9} className="py-4 text-center text-stone-500">Aucune activité.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Seules les 3 dernières sont chargées ici (accueil léger) — tout le reste dans Activités. */}
          <div className="mt-4 flex justify-center border-t border-stone-100 pt-4 dark:border-stone-800">
            <Link
              href="/activites"
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-alpine-300 hover:text-alpine-700 dark:border-stone-700 dark:text-stone-200 dark:hover:border-alpine-700 dark:hover:text-alpine-300"
            >
              Voir toutes les activités →
            </Link>
          </div>
        </section>
        </Dim>

        <footer className="mt-8 text-center text-xs text-stone-400">
          Massif · indicateurs sur {Math.round(DASHBOARD_WINDOW_DAYS / 7)} semaines ({metrics.length} jours) · historique complet dans Analyse
        </footer>
    </>
  );
}
