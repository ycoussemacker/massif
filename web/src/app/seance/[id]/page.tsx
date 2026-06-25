import Link from "next/link";
import { Nav } from "@/components/nav";
import { getSession, type SessionView } from "@/lib/session";
import { sportIcon, sportName, SYSTEM_TAG_FR } from "@/lib/labels";
import { fmt, dur, longDateFr } from "@/lib/format";
import { weatherIcon, weatherLabel, weatherTempBadge } from "@/lib/weather";
import { VIZ } from "@/lib/theme";
import { StravaLink } from "@/components/brand";
import { BackButton } from "@/components/back-button";
import { ActivityFlag } from "@/components/activity-flag";
import { EventEdit } from "@/components/event-edit";
import { getSports } from "@/lib/activities";
import { daysBetween, todayLocal } from "@/lib/coach-context";
import type { ChannelProgress } from "@/lib/day-progress";

export const dynamic = "force-dynamic";

const CHANNEL_STATUS_FR: Record<string, string> = { under: "en-dessous", in_band: "dans la cible", over: "au-dessus" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-stone-500 dark:text-stone-400">{label}</span>
      <span className="tabular-nums text-stone-800 dark:text-stone-100">{value}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">{title}</h2>
      {children}
    </div>
  );
}

function Channels({ aero, neuro }: { aero: number | null; neuro: number | null }) {
  return (
    <span className="text-xs">
      <span style={{ color: VIZ.aerobic }}>aéro {fmt(aero, 0)}</span>
      <span className="mx-1 text-stone-300">·</span>
      <span style={{ color: VIZ.neuro }}>neuro {fmt(neuro, 0)}</span>
    </span>
  );
}

/** Sober weather line — neutral stone, glyph + label + numbers (tabular). Informational context only,
 *  never the readiness palette. For a PAST session it reflects the device-recorded values (truth); for a
 *  today/future session it shows the forecast. Renders nothing when there's nothing useful to say. */
function WeatherLine({ v }: { v: SessionView }) {
  const a = v.activity;
  // Realised/past activity → recorded device values are truth; prefer them over any forecast.
  if (a && (a.avg_temp_c != null || a.max_altitude_m != null)) {
    const altitude = a.max_altitude_m != null
      ? `${Math.round(a.max_altitude_m).toLocaleString("fr-FR").replace(/ | /g, " ")} m max`
      : null;
    return (
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
        <span aria-hidden>🌡️</span>
        {a.avg_temp_c != null && <span className="tabular-nums">{Math.round(a.avg_temp_c)} °C</span>}
        {altitude && a.avg_temp_c != null && <span className="text-stone-300 dark:text-stone-600">·</span>}
        {altitude && <span className="tabular-nums">{altitude}</span>}
        <span className="text-stone-400 dark:text-stone-500">(mesuré)</span>
      </p>
    );
  }
  // Today/future planned session or goal → the forecast for that day.
  const w = v.weather;
  if (w && !v.past) {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
        <span aria-hidden>{weatherIcon(w.weatherCode, { precipMm: w.precipMm, windKmh: w.windKmh, tempMaxC: w.tempMaxC })}</span>
        <span>{weatherLabel(w.weatherCode)}</span>
        {(() => { const t = weatherTempBadge({ tempMaxC: w.tempMaxC, feelsMaxC: w.feelsMaxC }); return t ? <span aria-hidden title={t.label}>{t.emoji}</span> : null; })()}
        {w.tempMaxC != null && (
          <span className="tabular-nums">{Math.round(w.tempMaxC)} °C{w.feelsMaxC != null ? ` (ressenti ${Math.round(w.feelsMaxC)})` : ""}</span>
        )}
        {w.windKmh != null && w.windKmh >= 20 && <span className="tabular-nums">vent {Math.round(w.windKmh)} km/h</span>}
        {w.precipMm != null && w.precipMm >= 1 && <span className="tabular-nums">{w.precipMm.toFixed(0)} mm</span>}
        <span className="text-stone-400 dark:text-stone-500">(prévu)</span>
      </p>
    );
  }
  return null;
}

function ChannelVerdict({ label, c }: { label: string; c: ChannelProgress | null }) {
  if (!c) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="text-stone-500 dark:text-stone-400">{label}</span>
      <span className="tabular-nums text-stone-700 dark:text-stone-200">
        {fmt(c.actual, 0)} <span className="text-stone-400">/ cible {fmt(c.target, 0)} (zone {fmt(c.min, 0)}–{fmt(c.max, 0)})</span>
        {" · "}<span className="font-medium">{CHANNEL_STATUS_FR[c.status]}</span>
      </span>
    </div>
  );
}

/** Planned column — coach targets+bounds, or an event/goal estimate + the projected form before it. */
function PlannedColumn({ v }: { v: SessionView }) {
  const p = v.planned;
  const hasEstimate = !!v.estimate;
  if (!p && !hasEstimate && v.kind !== "goal") {
    return <Card title="Prévu"><p className="text-sm text-stone-500 dark:text-stone-400">Aucune séance planifiée.</p></Card>;
  }
  return (
    <Card title={p?.isEvent || v.kind === "goal" ? "Événement prévu" : "Prévu (coach)"}>
      {p && (
        <>
          {p.systemTag && <Row label="Type d'effort" value={SYSTEM_TAG_FR[p.systemTag] ?? p.systemTag} />}
          {(p.intensityZone || (p.targetHrLow != null && p.targetHrHigh != null)) && (
            <Row label="Intensité" value={
              <>
                {p.intensityZone}
                {p.targetHrLow != null && p.targetHrHigh != null && (
                  <span className={p.intensityZone ? "ml-1 text-stone-500 dark:text-stone-400" : ""}>
                    {p.intensityZone ? "· " : ""}{p.targetHrLow}–{p.targetHrHigh} bpm
                  </span>
                )}
              </>
            } />
          )}
          {p.targetLoad != null && <Row label="Charge cible" value={`${fmt(p.targetLoad, 0)} pts`} />}
          {(p.targetAerobic != null || p.targetNeuro != null) && (
            <Row label="Canaux cibles" value={<Channels aero={p.targetAerobic} neuro={p.targetNeuro} />} />
          )}
          {p.targetAerobicMin != null && p.targetAerobicMax != null && (
            <Row label="Bornes aéro" value={`${fmt(p.targetAerobicMin, 0)}–${fmt(p.targetAerobicMax, 0)}`} />
          )}
          {p.targetNeuroMin != null && p.targetNeuroMax != null && (
            <Row label="Bornes neuro" value={`${fmt(p.targetNeuroMin, 0)}–${fmt(p.targetNeuroMax, 0)}`} />
          )}
          {p.targetDurationS != null && <Row label="Durée cible" value={dur(p.targetDurationS)} />}
        </>
      )}
      {v.estimate && (
        <>
          <Row label="Charge estimée" value={`~${fmt(v.estimate.total, 0)} pts`} />
          <Row label="Canaux estimés" value={<Channels aero={v.estimate.aerobic} neuro={v.estimate.neuro} />} />
          {v.estimate.basis && <p className="mt-1 text-[11px] text-stone-400">{v.estimate.basis}</p>}
        </>
      )}
      {v.forecast && (
        <div className="mt-2 border-t border-stone-100 pt-2 dark:border-stone-800">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">Forme projetée la veille</div>
          <Row label="CTL" value={fmt(v.forecast.ctl, 0)} />
          <Row label="ATL" value={fmt(v.forecast.atl, 0)} />
          <Row label="TSB (fraîcheur)" value={fmt(v.forecast.tsb, 0)} />
        </div>
      )}
    </Card>
  );
}

/** Realised column — the logged activity's metrics, or a "not done yet" note. */
function RealisedColumn({ v }: { v: SessionView }) {
  const a = v.activity;
  if (!a) {
    return (
      <Card title="Réalisé">
        <p className="text-sm text-stone-500 dark:text-stone-400">
          {v.past ? "Aucune activité enregistrée pour ce jour." : "Pas encore réalisé."}
        </p>
      </Card>
    );
  }
  return (
    <Card title="Réalisé">
      <Row label="Charge" value={`${fmt(a.training_load, 0)} pts`} />
      <Row label="Canaux" value={<Channels aero={a.aerobic_load} neuro={a.neuromuscular_load} />} />
      <Row label="Durée" value={dur(a.duration_s)} />
      {a.distance_m != null && <Row label="Distance" value={`${(a.distance_m / 1000).toFixed(1)} km`} />}
      <Row label="D+ / D−" value={`${a.vertical_gain_m != null ? Math.round(a.vertical_gain_m) : "—"} / ${a.vertical_loss_m != null ? Math.round(a.vertical_loss_m) : "—"}`} />
      {a.avg_hr != null && <Row label="FC moyenne" value={`${a.avg_hr} bpm`} />}
      {a.perceived_rpe != null && <Row label="RPE" value={`${a.perceived_rpe} (${a.rpe_source})`} />}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-stone-100 pt-2 dark:border-stone-800">
        <span className="text-xs text-stone-500 dark:text-stone-400">Catégorie</span>
        <ActivityFlag a={a} alwaysOffer />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-stone-400">méthode {a.load_method_used ?? "—"}</span>
        <StravaLink source={a.source} sourceActivityId={a.source_activity_id} />
      </div>
    </Card>
  );
}

export default async function SeancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await getSession(id);

  // Edit/delete is offered only for athlete-declared events (not coach-generated sessions).
  const editable = v.kind === "planned" && !!v.planned?.isEvent;
  const sports = editable ? await getSports() : [];
  const daysOut = v.date ? daysBetween(todayLocal(), v.date) : 0;

  const sportCode = v.activity?.sport_code ?? v.planned?.sportCode ?? v.goal?.sportCode ?? null;
  const title = v.goal?.title ?? v.planned?.title ?? v.activity?.strava_name ?? (sportCode ? sportName(sportCode, sportCode) : "Séance");
  const navTab = v.kind === "realised" ? "activites" : "calendrier";

  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current={navTab} />

        {v.kind === "not_found" ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center dark:border-stone-800 dark:bg-stone-900">
            <p className="text-sm text-stone-500 dark:text-stone-400">Séance introuvable.</p>
            <Link href="/calendrier" className="mt-2 inline-block text-sm font-medium text-alpine-700 hover:underline dark:text-alpine-300">← Retour au calendrier</Link>
          </div>
        ) : (
          <>
            <header className="mb-4">
              {v.date && <div className="text-xs font-medium uppercase tracking-wide text-stone-400">{longDateFr(v.date)}</div>}
              <div className="mt-0.5 flex min-w-0 items-center gap-2">
                <BackButton fallback={`/${navTab}`} />
                <h1 className="flex min-w-0 items-center gap-2 text-xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
                  <span aria-hidden>{sportIcon(sportCode)}</span>
                  <span className="min-w-0 truncate">{title}</span>
                </h1>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                {sportCode && <span className="text-stone-500 dark:text-stone-400">{sportName(sportCode, sportCode)}</span>}
                {v.kind === "goal" && <span className="rounded-md bg-stone-100 px-2 py-0.5 font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">🏆 Objectif</span>}
                {v.planned?.isEvent && <span className="rounded-md border border-dashed border-stone-300 px-2 py-0.5 text-stone-500 dark:border-stone-600">Événement</span>}
                {v.goal?.horizon && <span className="text-stone-400">{v.goal.horizon}</span>}
              </div>
              {v.planned?.description && <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">{v.planned.description}</p>}
              {v.goal?.detail && <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">{v.goal.detail}</p>}
              <WeatherLine v={v} />
            </header>

            <div className="grid gap-3 sm:grid-cols-2">
              <PlannedColumn v={v} />
              <RealisedColumn v={v} />
            </div>

            {/* Feedback du coach — sans LLM (comparaison réalisé vs plan, par canal). */}
            {v.voice && (
              <div className="mt-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Retour du coach</h2>
                <p className="rounded-2xl rounded-tl-sm bg-stone-100 px-3.5 py-2.5 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                  {v.voice.cardText}
                </p>
                {(v.progress?.aerobic || v.progress?.neuromuscular) && (
                  <div className="mt-2">
                    <ChannelVerdict label="Aérobie" c={v.progress?.aerobic ?? null} />
                    <ChannelVerdict label="Neuromusculaire" c={v.progress?.neuromuscular ?? null} />
                  </div>
                )}
              </div>
            )}

            {/* Modifier / supprimer un événement déclaré (+ proposition de régénérer le plan si ≤ 7 j). */}
            {editable && v.planned && (
              <div className="mt-3">
                <EventEdit
                  id={v.planned.id}
                  sports={sports}
                  daysOut={daysOut}
                  initial={{
                    date: v.date ?? "",
                    sportId: v.planned.sportId,
                    title: v.planned.title,
                    distanceKm: v.planned.targetDistanceM != null ? String(v.planned.targetDistanceM / 1000) : "",
                    verticalM: v.planned.targetVerticalM != null ? String(v.planned.targetVerticalM) : "",
                    altitudeM: v.planned.expectedAltitudeM != null ? String(v.planned.expectedAltitudeM) : "",
                    durationMin: v.planned.targetDurationS != null ? String(Math.round(v.planned.targetDurationS / 60)) : "",
                    isKey: v.planned.isKey,
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
