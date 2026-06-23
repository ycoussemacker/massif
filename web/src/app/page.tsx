import Link from "next/link";
import { getDashboard, latestModel, DASHBOARD_WINDOW_MONTHS, type DailyMetric } from "@/lib/data";
import { Gauge, type Zone } from "@/components/charts";
import { ChartsSection } from "@/components/charts-section";
import { ActivityCard, ActivityRow, ActivityTableHead } from "@/components/activity-row";
import { Nav } from "@/components/nav";
import { GoalBadge } from "@/components/goal-badge";
import { CoachHero } from "@/components/coach-hero";
import { GarminRefresh } from "@/components/garmin-refresh";
import { SorenessInput } from "@/components/soreness-input";
import { todayLocal } from "@/lib/coach-context";
import { fmt, avgLoadRecent } from "@/lib/format";
import { rollingMonotony } from "@/lib/aggregate";
import { SparklineTile } from "@/components/sparkline";
import { HelpButton, type HelpContent } from "@/components/help";
import { VIZ, STATE } from "@/lib/theme";

export const dynamic = "force-dynamic"; // toujours refléter le dernier sync / run du coach

// Fenêtre roulante des graphiques du tableau de bord (réutilisée dans les libellés d'aide).
const WIN = `${DASHBOARD_WINDOW_MONTHS} mois`;

// Aides cliquables (popover bas d'écran sur mobile / modale sur desktop) — une par indicateur clé.
const CTL_HELP: HelpContent = {
  title: "CTL · forme",
  blocks: [
    { type: "p", text: "Ta forme de fond (« fitness ») : la charge d'entraînement moyenne lissée sur ~42 jours (moyenne mobile exponentielle). Elle monte lentement et redescend au repos." },
    { type: "formula", lines: ["CTL = moyenne expo ~42 j de la charge quotidienne"] },
    { type: "dl", items: [
      { k: "Unité", v: "points de charge (≈ TSS ; 100 pts ≈ 1 h à intensité seuil)." },
      { k: "Lecture", v: "plus haut = plus en forme ; pas de bon / mauvais absolu, c'est la tendance qui compte." },
      { k: "Fenêtre", v: `le graphe = ${WIN} ; le grand chiffre = aujourd'hui.` },
    ] },
  ],
};
const ATL_HELP: HelpContent = {
  title: "ATL · fatigue",
  blocks: [
    { type: "p", text: "Ta fatigue récente : la même charge lissée sur ~7 jours seulement. Elle monte vite et redescend en quelques jours." },
    { type: "formula", lines: ["ATL = moyenne expo ~7 j de la charge quotidienne"] },
    { type: "dl", items: [
      { k: "Unité", v: "points de charge (même échelle que le CTL)." },
      { k: "Lecture", v: "au-dessus du CTL = tu accumules de la fatigue ; en-dessous = tu récupères / affûtes." },
      { k: "Fenêtre", v: `le graphe = ${WIN} ; le grand chiffre = aujourd'hui.` },
    ] },
  ],
};
const MONO_HELP: HelpContent = {
  title: "Monotonie · 7 j",
  blocks: [
    { type: "p", text: "Mesure si l'entraînement est trop uniforme (toujours pareil, sans contraste facile / dur) → plus de risque à charge égale." },
    { type: "formula", lines: ["Monotonie = charge moyenne ÷ écart-type (7 j glissants)"] },
    { type: "dl", items: [
      { k: "Unité", v: "sans unité (un ratio)." },
      { k: "Lecture", v: "< 1,5 sain · 1,5–2 à surveiller · > 2 trop uniforme = risque." },
      { k: "Fenêtre", v: `le graphe = ${WIN} ; calculée sur la fenêtre affichée (non stockée en base).` },
    ] },
  ],
};
const TSB_HELP: HelpContent = {
  title: "TSB · forme",
  blocks: [
    { type: "p", text: "Ta fraîcheur du jour : l'écart entre ta forme de fond (CTL) et ta fatigue récente (ATL)." },
    { type: "formula", lines: ["TSB = CTL − ATL"] },
    { type: "dl", items: [
      { k: "Unité", v: "points de charge." },
      { k: "Lecture", v: "les seuils s'adaptent à ta charge (CTL) — frais > +10 % du CTL · équilibre −10 % à +10 % · charge productive −30 % à −10 % · surmenage < −30 %." },
      { k: "Fenêtre", v: "valeur du jour (l'historique est dans la carte « Forme » plus bas)." },
    ] },
  ],
};
const ACWR_HELP: HelpContent = {
  title: "ACWR · ratio de charge",
  blocks: [
    { type: "p", text: "Rapport fatigue récente / forme de fond : indique si tu montes en charge trop vite." },
    { type: "formula", lines: ["ACWR = ATL ÷ CTL"] },
    { type: "dl", items: [
      { k: "Unité", v: "sans unité (un ratio)." },
      { k: "Lecture", v: "< 0,8 sous-charge · 0,8–1,3 zone idéale · 1,3–1,5 élevé · > 1,5 risque de blessure." },
      { k: "Fenêtre", v: "valeur du jour." },
    ] },
  ],
};
const READY_HELP: HelpContent = {
  title: "Disponibilité (Garmin)",
  blocks: [
    { type: "p", text: "Score de préparation calculé par la montre Garmin ce matin (sommeil, VFC, stress, charge récente)." },
    { type: "dl", items: [
      { k: "Unité", v: "0 à 100." },
      { k: "Lecture", v: "≥ 70 bon · 50–70 modéré · 30–50 bas · < 30 très bas." },
      { k: "Source", v: "Garmin (récup du jour) ; n'inclut PAS la fatigue neuromusculaire (voir Fraîcheur par système)." },
    ] },
  ],
};
const FRESH_AERO_HELP: HelpContent = {
  title: "Fraîcheur aérobie",
  blocks: [
    { type: "p", text: "Fraîcheur du moteur cardiovasculaire ; récupère vite (jours), visible dans la VFC / Body Battery." },
    { type: "formula", lines: ["= CTL aérobie − ATL aérobie  (τ aigu ~7 j)"] },
    { type: "dl", items: [
      { k: "Unité", v: "points." },
      { k: "Lecture", v: "positif = frais · négatif = fatigué." },
      { k: "Fenêtre", v: `le graphe = ${WIN} ; le grand chiffre = aujourd'hui.` },
    ] },
  ],
};
const FRESH_NEURO_HELP: HelpContent = {
  title: "Fraîcheur neuromusculaire",
  blocks: [
    { type: "p", text: "Fraîcheur muscles / tendons / structures (descentes excentriques, impacts, port de charge) ; récupère lentement (~2 sem) et invisible aux montres." },
    { type: "formula", lines: ["= CTL neuro − ATL neuro  (τ aigu ~14 j, plus lent)"] },
    { type: "dl", items: [
      { k: "Unité", v: "points." },
      { k: "Lecture", v: "peut rester négatif après de grosses descentes même si VFC et fraîcheur aérobie sont bonnes." },
      { k: "Fenêtre", v: `le graphe = ${WIN} ; le grand chiffre = aujourd'hui.` },
    ] },
  ],
};

// Zones colorées (bon ↔ risqué) pour les jauges.
// TSB bands scale with the athlete's OWN chronic load: "form" reads as a % of CTL, not fixed
// TrainingPeaks points, so the same TSB is judged relative to how trained you are (−27 means more when
// CTL is 50 than when it's 150). Falls back to absolute points when CTL is unknown. ACWR stays absolute
// below — it's already a normalized ratio, so its 0.8–1.3 sweet spot is scale-independent.
const tsbBandBounds = (ctl: number | null): { lo: number; mid: number; hi: number } => {
  const c = ctl && ctl > 0 ? ctl : null;
  return c ? { lo: -0.3 * c, mid: -0.1 * c, hi: 0.1 * c } : { lo: -30, mid: -10, hi: 8 };
};
const tsbZones = (ctl: number | null, min: number, max: number): Zone[] => {
  const { lo, mid, hi } = tsbBandBounds(ctl);
  return [
    { from: min, to: lo, color: STATE.rest, label: "surmenage / risque" },
    { from: lo, to: mid, color: STATE.caution, label: "charge productive" },
    { from: mid, to: hi, color: STATE.neutral, label: "équilibre" },
    { from: hi, to: max, color: STATE.ready, label: "frais / affûté" },
  ];
};
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
  for (let i = metrics.length - 1; i >= 0; i--) {
    const m = metrics[i];
    if (m.hrv_overnight_ms != null || m.sleep_score != null || m.training_readiness != null) return m;
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

const linkCls =
  "inline-flex shrink-0 items-center gap-1 text-sm font-medium text-stone-500 transition-colors hover:text-alpine-700 dark:text-stone-400 dark:hover:text-alpine-300";

export default async function Dashboard() {
  const { profile, topGoal, metrics, briefing, activities, allActivities } = await getDashboard();
  const latest = latestModel(metrics);
  const rec = latestRecovery(metrics);
  const todaySoreness = metrics.find((m) => m.local_date === todayLocal())?.soreness ?? null;
  const avgLoad = avgLoadRecent(allActivities, todayLocal(), 15);

  const tsb = latest?.tsb ?? null;
  const acwr = latest?.acwr ?? null;
  // Gauge range must contain both the value and the CTL-scaled bands (which widen as CTL grows).
  const tsbBounds = tsbBandBounds(latest?.ctl ?? null);
  const tsbMin = Math.min(-40, tsbBounds.lo, (tsb ?? 0)) - 8;
  const tsbMax = Math.max(20, tsbBounds.hi, (tsb ?? 0)) + 8;
  const acwrMax = Math.max(2, (acwr ?? 0) + 0.1);

  // Trend sparklines + a client-computed monotony (the DB doesn't persist monotony/strain).
  const ctlSeries = metrics.map((m) => m.ctl);
  const atlSeries = metrics.map((m) => m.atl);
  const tsbAerobicSeries = metrics.map((m) => m.tsb_aerobic);
  const tsbNeuroSeries = metrics.map((m) => m.tsb_neuromuscular);
  const monoSeries = rollingMonotony(metrics.map((m) => m.daily_load ?? 0));
  const latestMono = [...monoSeries].reverse().find((v) => v != null) ?? null;
  const monoColor = latestMono == null ? undefined : latestMono >= 2 ? STATE.rest : latestMono >= 1.5 ? STATE.caution : undefined;

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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-stone-500">
                  CTL · forme
                  <HelpButton content={CTL_HELP} />
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(latest?.ctl, 1)}</div>
                <SparklineTile values={ctlSeries} color={VIZ.aerobic} unit="pts" window={WIN} />
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-stone-500">
                  ATL · fatigue
                  <HelpButton content={ATL_HELP} />
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(latest?.atl, 1)}</div>
                <SparklineTile values={atlSeries} color={VIZ.neuro} unit="pts" window={WIN} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-stone-500">
                  Monotonie · 7 j
                  <HelpButton content={MONO_HELP} />
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums" style={monoColor ? { color: monoColor } : undefined}>{fmt(latestMono, 2)}</div>
                <SparklineTile values={monoSeries} unit="ratio" window={WIN} decimals={2} className="text-stone-400" />
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              <Gauge label="TSB · forme" value={tsb} min={tsbMin} max={tsbMax} zones={tsbZones(latest?.ctl ?? null, tsbMin, tsbMax)} help={TSB_HELP} />
              <Gauge label="ACWR · ratio de charge" value={acwr} min={0} max={acwrMax} zones={acwrZones(acwrMax)} help={ACWR_HELP} />
              <Gauge label="Disponibilité (Garmin)" value={rec?.training_readiness ?? null} unit="" min={0} max={100} zones={readyZones} help={READY_HELP} />
            </div>

            {/* Fraîcheur par système : la forme (TSB) se sépare en deux canaux qui récupèrent à des
                vitesses différentes. Positif = frais, négatif = fatigué. */}
            <div>
              <div className="mb-2 text-xs font-medium text-stone-700 dark:text-stone-300">Fraîcheur par système</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-stone-500">
                    Fraîcheur aérobie
                    <HelpButton content={FRESH_AERO_HELP} />
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: VIZ.aerobic }}>
                    {fmt(latest?.tsb_aerobic, 1)}
                  </div>
                  <SparklineTile values={tsbAerobicSeries} color={VIZ.aerobic} unit="pts" window={WIN} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-stone-500">
                    Fraîcheur neuromusculaire
                    <HelpButton content={FRESH_NEURO_HELP} />
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: VIZ.neuro }}>
                    {fmt(latest?.tsb_neuromuscular, 1)}
                  </div>
                  <SparklineTile values={tsbNeuroSeries} color={VIZ.neuro} unit="pts" window={WIN} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Graphiques (cliquables : un clic sur une barre/point ouvre le détail du jour) */}
        {metrics.length > 1 ? (
          <div className="mb-6">
            <ChartsSection key={`${metrics.length}-${latest?.local_date ?? ""}-${latest?.ctl ?? ""}-${latest?.tsb ?? ""}`} metrics={metrics} activities={allActivities} avgLoad={avgLoad} />
          </div>
        ) : (
          <p className="mb-6 text-sm text-stone-500">Pas encore assez de jours de données pour les courbes.</p>
        )}

        {/* Récupération */}
        {rec && (
          <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
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
          </section>
        )}

        {/* Courbatures — auto-évaluation neuromusculaire facultative (la VFC n'y voit rien) */}
        <div className="mb-6">
          <SorenessInput initial={todaySoreness} />
        </div>

        {/* Activités récentes */}
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
        </section>

        <footer className="mt-8 text-center text-xs text-stone-400">
          Massif · graphiques sur {DASHBOARD_WINDOW_MONTHS} mois ({metrics.length} jours) · historique complet dans Analyse
        </footer>
      </div>
    </div>
  );
}
