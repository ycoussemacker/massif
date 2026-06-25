/** "Consulter une séance" data — one id (an activity, a planned session, or a goal) → a unified view of
 *  the PLANNED metrics (targets/bounds, or the event estimate) vs the REALISED metrics + the LLM-free
 *  coach feedback for that day. Server-only (service-role). Powers /seance/[id]. */
import { createServiceClient } from "./supabase/server";
import { ACTIVITY_COLS, enrichActivities, type Activity } from "./data";
import { getSports, listActivities } from "./activities";
import { todayLocal, daysBetween, dateMinusDays } from "./coach-context";
import { isoMinusDays, avgLoadRecent } from "./format";
import { assembleVerdict, channelTargets, type PlannedRow } from "./day-verdict";
import type { DayProgress } from "./day-progress";
import type { VerdictVoice } from "./coach-voice";
import { estimateForDeclared, estimatedMovingFraction } from "./estimate-server";
import { projectFromMetrics, type SeedMetric } from "./project";
import { buildPlannedLoads } from "./planning";
import { parseEventText } from "./event-parse";

export type PlannedMeta = {
  id: string;
  title: string;
  description: string | null;
  sportId: number | null;
  sportCode: string | null;
  sportName: string | null;
  systemTag: string | null;
  intensityZone: string | null;
  targetHrLow: number | null;   // bpm band to hold (from the athlete's real HR zones) — matches the watch
  targetHrHigh: number | null;
  isEvent: boolean;
  isPinned: boolean;
  isKey: boolean;
  modifiedBy: string | null; // 'user' = athlete owns it (declared OR chat-accepted) → editable/deletable; 'coach' = managed by the coach
  status: string | null;
  targetLoad: number | null;
  targetAerobic: number | null;
  targetNeuro: number | null;
  targetAerobicMin: number | null;
  targetAerobicMax: number | null;
  targetNeuroMin: number | null;
  targetNeuroMax: number | null;
  targetDurationS: number | null;
  targetMovingS: number | null; // estimated MOVING time for a declared event (total × same-sport ratio)
  targetDistanceM: number | null;
  targetVerticalM: number | null;
  expectedAltitudeM: number | null;
};

export type Forecast = { date: string; ctl: number | null; atl: number | null; tsb: number | null } | null;
export type Estimate = { aerobic: number; neuro: number; total: number; basis: string } | null;
/** Forecast for a today/future planned day (never the past — a past session uses its RECORDED values). */
export type SessionWeather = {
  tempMaxC: number | null; feelsMaxC: number | null; precipMm: number | null;
  windKmh: number | null; weatherCode: number | null;
} | null;

export type SessionView = {
  kind: "realised" | "planned" | "goal" | "not_found";
  date: string | null;
  past: boolean;
  activity: Activity | null;
  planned: PlannedMeta | null;
  goal: { id: string; title: string; sportCode: string | null; sportName: string | null; detail: string | null; horizon: string | null } | null;
  estimate: Estimate;
  forecast: Forecast;
  weather: SessionWeather; // forecast for a today/future planned day; null for past/realised (uses recorded temp)
  progress: DayProgress | null;
  voice: VerdictVoice | null;
};

function emptyView(): SessionView {
  return { kind: "not_found", date: null, past: false, activity: null, planned: null, goal: null, estimate: null, forecast: null, weather: null, progress: null, voice: null };
}

/** Fetch the daily_weather forecast for a today/future day (the table only holds today..+9). null otherwise. */
async function fetchWeather(sb: any, today: string, date: string | null): Promise<SessionWeather> {
  if (!date || date < today) return null; // past day → use the activity's recorded temp instead
  const { data } = await sb.from("daily_weather")
    .select("temp_max_c,feels_max_c,precip_mm,wind_kmh,weather_code")
    .eq("local_date", date).maybeSingle();
  if (!data) return null;
  return {
    tempMaxC: data.temp_max_c, feelsMaxC: data.feels_max_c, precipMm: data.precip_mm,
    windKmh: data.wind_kmh, weatherCode: data.weather_code,
  };
}

function toPlannedMeta(p: any, sportCode: string | null, sportName: string | null): PlannedMeta {
  return {
    id: p.id, title: p.title, description: p.description ?? null, sportId: p.sport_id ?? null, sportCode, sportName,
    systemTag: p.system_tag ?? null, intensityZone: p.intensity_zone ?? null,
    targetHrLow: p.target_hr_low ?? null, targetHrHigh: p.target_hr_high ?? null,
    isEvent: !!p.is_event, isPinned: !!p.is_pinned, isKey: !!p.is_key, modifiedBy: p.modified_by ?? null, status: p.status ?? null,
    targetLoad: p.target_load ?? null,
    targetAerobic: p.target_aerobic_load ?? null, targetNeuro: p.target_neuromuscular_load ?? null,
    targetAerobicMin: p.target_aerobic_min ?? null, targetAerobicMax: p.target_aerobic_max ?? null,
    targetNeuroMin: p.target_neuromuscular_min ?? null, targetNeuroMax: p.target_neuromuscular_max ?? null,
    targetDurationS: p.target_duration_s ?? null, targetMovingS: null, // filled async for declared events
    targetDistanceM: p.target_distance_m ?? null,
    targetVerticalM: p.target_vertical_m ?? null,
    expectedAltitudeM: p.expected_altitude_m ?? null,
  };
}

/** For a declared EVENT, the athlete gives the TOTAL duration; estimate the MOVING time (the value the
 *  load estimate is built on) so the séance detail can show both. Same-sport moving ratio. */
async function withMovingEstimate(sb: any, planned: PlannedMeta): Promise<PlannedMeta> {
  if (!planned.isEvent || planned.sportId == null || planned.targetDurationS == null) return planned;
  try {
    const frac = await estimatedMovingFraction(sb, planned.sportId);
    return { ...planned, targetMovingS: Math.round(planned.targetDurationS * frac) };
  } catch {
    return planned; // best-effort — the detail just omits the estimated moving time
  }
}

/** Project CTL/ATL/TSB the day BEFORE `eventDate` under the current plan. null if out of seed/horizon. */
async function computeForecast(sb: any, today: string, eventDate: string): Promise<Forecast> {
  const offset = daysBetween(today, eventDate);
  if (offset < 1 || offset > 90) return null;
  const seedFrom = isoMinusDays(today, 60);
  const [mm, up, np] = await Promise.all([
    sb.from("daily_metrics").select("local_date,daily_aerobic_load,daily_neuromuscular_load,ctl,atl,ctl_aerobic,atl_aerobic,ctl_neuromuscular,atl_neuromuscular")
      .gte("local_date", seedFrom).order("local_date", { ascending: true }),
    sb.from("planned_sessions").select("planned_date,is_event,system_tag,target_load,target_aerobic_load,target_neuromuscular_load,predicted_aerobic_load,predicted_neuromuscular_load")
      .gte("planned_date", today).lte("planned_date", eventDate).neq("status", "skipped"),
    sb.from("athlete_load_params").select("value").eq("param", "neuro_atl_days").maybeSingle(),
  ]);
  const metrics = (mm.data ?? []) as SeedMetric[];
  const neuroAtlDays = Number((np.data as any)?.value) || undefined;
  const projected = projectFromMetrics(metrics, buildPlannedLoads(up.data ?? []), { today, horizonDays: offset, neuroAtlDays });
  const eve = dateMinusDays(eventDate, 1);
  const p = projected.find((r) => r.local_date === eve);
  return p ? { date: p.local_date, ctl: p.ctl, atl: p.atl, tsb: p.tsb } : null;
}

/** Verdict (LLM-free) for `day`: this day's realised load vs the coach's plan + per-channel bounds. */
async function dayVerdict(sb: any, day: string): Promise<{ progress: DayProgress | null; voice: VerdictVoice | null }> {
  const [{ rows: windowActs }, plannedRes] = await Promise.all([
    listActivities({ from: isoMinusDays(day, 15), to: day, order: "date_asc", limit: 1000 }),
    sb.from("planned_sessions").select("*").eq("planned_date", day).eq("status", "planned").or("modified_by.eq.coach,is_pinned.is.true"),
  ]);
  const planned = (plannedRes.data ?? []) as unknown as PlannedRow[];
  const hasPlan = planned.length > 0;
  if (!hasPlan) return { progress: null, voice: null };
  const target = planned.reduce((s, r) => s + (r.target_load ?? 0), 0);
  const isRest = planned.some((r) => r.system_tag === "rest");
  const ch = channelTargets(planned);
  const avgLoad = avgLoadRecent(windowActs, day, 15);
  return assembleVerdict({
    hasPlan, target, isRest, activities: windowActs, avgLoad, today: day,
    targetAerobic: ch.targetAerobic, targetNeuro: ch.targetNeuro, boundsAerobic: ch.boundsAerobic, boundsNeuro: ch.boundsNeuro,
  });
}

export async function getSession(id: string): Promise<SessionView> {
  if (!id) return emptyView();
  const sb = await createServiceClient();
  const today = todayLocal();
  const sports = await getSports();
  const sportById = new Map<number, any>(sports.map((s) => [s.id, s]));

  // 1) Realised activity?
  const { data: actRow } = await sb.from("activities").select(ACTIVITY_COLS).eq("id", id).maybeSingle();
  if (actRow) {
    const activity = enrichActivities([actRow], sportById)[0];
    const day = activity.local_date;
    // The coach session that day (for the planned-vs-realised columns), if any.
    const { data: coachRow } = await sb.from("planned_sessions").select("*")
      .eq("planned_date", day).or("modified_by.eq.coach,is_pinned.is.true").order("order_in_day").limit(1).maybeSingle();
    const cSport = coachRow?.sport_id != null ? sportById.get(coachRow.sport_id) : null;
    const { progress, voice } = await dayVerdict(sb, day);
    return {
      ...emptyView(), kind: "realised", date: day, past: day < today, activity,
      planned: coachRow ? toPlannedMeta(coachRow, cSport?.code ?? null, cSport?.display_name ?? null) : null,
      progress, voice,
    };
  }

  // 2) Planned session?
  const { data: planRow } = await sb.from("planned_sessions").select("*").eq("id", id).maybeSingle();
  if (planRow) {
    const day = planRow.planned_date;
    const sp = planRow.sport_id != null ? sportById.get(planRow.sport_id) : null;
    const planned = await withMovingEstimate(sb, toPlannedMeta(planRow, sp?.code ?? null, sp?.display_name ?? null));
    // Realised: the linked activity, else (for a past/today day) the day's logged activities.
    let activity: Activity | null = null;
    if (planRow.linked_activity_id) {
      const { data: linked } = await sb.from("activities").select(ACTIVITY_COLS).eq("id", planRow.linked_activity_id).maybeSingle();
      if (linked) activity = enrichActivities([linked], sportById)[0];
    }
    const estimate: Estimate = planRow.is_event && (planRow.predicted_aerobic_load != null || planRow.predicted_neuromuscular_load != null)
      ? { aerobic: planRow.predicted_aerobic_load ?? 0, neuro: planRow.predicted_neuromuscular_load ?? 0,
          total: (planRow.predicted_aerobic_load ?? 0) + (planRow.predicted_neuromuscular_load ?? 0), basis: planRow.prediction_basis ?? "" }
      : null;
    const forecast = day > today ? await computeForecast(sb, today, day) : null;
    const weather = await fetchWeather(sb, today, day); // today/future planned day → forecast
    const { progress, voice } = day <= today ? await dayVerdict(sb, day) : { progress: null, voice: null };
    return { ...emptyView(), kind: "planned", date: day, past: day < today, activity, planned, estimate, forecast, weather, progress, voice };
  }

  // 3) Goal / race?
  const { data: goalRow } = await sb.from("goals").select("id,title,sport_id,target_date,target_horizon,target_detail").eq("id", id).maybeSingle();
  if (goalRow) {
    const sp = goalRow.sport_id != null ? sportById.get(goalRow.sport_id) : null;
    const date = goalRow.target_date ?? null;
    let estimate: Estimate = null;
    if (goalRow.sport_id != null) {
      const parsed = parseEventText(goalRow.target_detail ?? goalRow.title ?? "", { today, sports: [] });
      const e = await estimateForDeclared(sb, {
        sportId: goalRow.sport_id, taxonomyGroup: sp?.taxonomy_group ?? null,
        distanceM: parsed.distanceM, verticalGainM: parsed.verticalGainM, durationS: parsed.durationS, name: goalRow.title,
      });
      estimate = { aerobic: e.aerobic, neuro: e.neuro, total: e.total, basis: e.basisLabel };
    }
    const forecast = date && date > today ? await computeForecast(sb, today, date) : null;
    const weather = await fetchWeather(sb, today, date); // forecast only covers ≤ +9 d; null beyond
    return {
      ...emptyView(), kind: "goal", date, past: !!date && date < today,
      goal: { id: goalRow.id, title: goalRow.title, sportCode: sp?.code ?? null, sportName: sp?.display_name ?? null, detail: goalRow.target_detail ?? null, horizon: goalRow.target_horizon ?? null },
      estimate, forecast, weather,
    };
  }

  return emptyView();
}
