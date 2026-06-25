/** Dashboard data access — server-side reads via the service-role client (RLS is off, local-first). */
import { createServiceClient } from "./supabase/server";
import { pickTopGoal, type GoalHeader } from "./profile-types";
import { todayLocal, daysBetween, dateMinusDays } from "./coach-context";
import { buildPlanningView, buildPlannedLoads, splitByTag } from "./planning";
import { projectFromMetrics } from "./project";
import { weatherAlerts } from "./weather";
import { suggestSport, type SportSuggestion } from "./sport-suggest";

/** Rolling window (in days) shown by the dashboard charts. Kept to 3 weeks so the homepage stays light
 *  AND the days are spread out wide enough to read the (now denser) forward-plan markers; deeper history
 *  lives in /analyse. (CTL/ATL/TSB are precomputed server-side over full history in the rollup, so a
 *  shorter display window doesn't change their values — only the chart span; the forward projection is
 *  Markovian and seeds from the last computed row, so it's unaffected too.) */
export const DASHBOARD_WINDOW_DAYS = 21;

export type DailyMetric = {
  local_date: string;
  daily_load: number;
  daily_aerobic_load: number;
  daily_neuromuscular_load: number;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  acwr: number | null;
  ctl_aerobic: number | null;
  atl_aerobic: number | null;
  tsb_aerobic: number | null;
  ctl_neuromuscular: number | null;
  atl_neuromuscular: number | null;
  tsb_neuromuscular: number | null;
  vertical_gain_m: number | null;
  vertical_loss_m: number | null;
  sleep_score: number | null;
  sleep_duration_s: number | null;
  hrv_overnight_ms: number | null;
  hrv_status: string | null;
  resting_hr: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  stress_avg: number | null;
  training_readiness: number | null;
  // Garmin/Firstbeat acclimation — CONTEXT for reading HR/recovery, NOT readiness or training load.
  // Often null (only present once trained in heat/altitude); render only when non-null.
  heat_acclimation_pct: number | null; // 0–100 %, builds when training above ~22 °C
  altitude_acclimation_m: number | null; // metres, builds when above ~800 m
  soreness: number | null; // optional morning self-report 1 (fresh) – 5 (cooked); neuromuscular ground truth
};

export type Activity = {
  id: string;
  local_date: string;
  started_at: string;
  source: string;
  source_activity_id: string | null;
  sport_id: number;
  sport: string;
  sport_code: string | null;
  taxonomy_group: string | null;
  needs_manual_rpe: boolean;
  training_load: number | null;
  aerobic_load: number | null;
  neuromuscular_load: number | null;
  load_method_used: string | null;
  duration_s: number | null;
  moving_s: number | null;
  distance_m: number | null;
  vertical_gain_m: number | null;
  vertical_loss_m: number | null;
  carried_load_kg: number | null;
  avg_hr: number | null;
  perceived_rpe: number | null;
  rpe_source: string | null;
  rpe_cardio: number | null; // differential RPE (Phase 2): souffle → aérobie
  rpe_legs: number | null; //   jambes → neuro
  rpe_grip: number | null; //   avant-bras/prise → neuro
  // Recorded environment (device truth for a PAST session) — CONTEXT, not a load input.
  avg_temp_c: number | null;        // Strava device ambient temp (°C)
  max_altitude_m: number | null;    // peak altitude reached (m)
  time_high_altitude_s: number | null; // seconds above ~1500 m (hypoxia dose)
  strava_name: string | null; // Strava activity title (from sport_specific->>strava_name)
  effective_days: number | null; // >1 ⇒ multi-day expedition whose load is spread across this many days
  needs_review: boolean | null;  // load rests on a suspect input (HR>max, implausible IF, mostly-stopped)
  // Keyword-detected likely mis-categorisation (e.g. a "Rando" that reads as alpinism / grande voie) —
  // a SUGGESTION the athlete validates, never auto-applied. Null when nothing matches. See sport-suggest.ts.
  suggestedSport?: SportSuggestion | null;
  // Set only on the per-day PROJECTION of a multi-day activity (see aggregate.groupByDateSpanned): this
  // row's load/duration fields then carry just that day's 1/total share; spanInfo records which day.
  spanInfo?: { index: number; total: number; fullLoad: number | null } | null;
};

/** Column list for an activities select that yields a full Activity (after enrichment). */
export const ACTIVITY_COLS =
  "id,local_date,started_at,source,source_activity_id,sport_id,training_load,aerobic_load,neuromuscular_load," +
  "load_method_used,duration_s,moving_s,distance_m,vertical_gain_m,vertical_loss_m,carried_load_kg,avg_hr," +
  "perceived_rpe,rpe_source,rpe_cardio,rpe_legs,rpe_grip,avg_temp_c,max_altitude_m,time_high_altitude_s,effective_days,needs_review," +
  "strava_name:sport_specific->>strava_name";

/** Attach sport display fields (FR-friendly name/code, taxonomy, RPE flag) to raw activity rows.
 *  Shared by getDashboard and lib/activities.listActivities so both enrich identically. */
export function enrichActivities(rows: any[], sportById: Map<number, any>): Activity[] {
  return rows.map((a: any) => {
    const s = sportById.get(a.sport_id);
    const code = s?.code ?? null;
    return {
      ...a,
      sport: s?.display_name ?? s?.code ?? "—",
      sport_code: code,
      taxonomy_group: s?.taxonomy_group ?? null,
      needs_manual_rpe: !!s?.needs_manual_rpe,
      // Title-based suggestion (cheap; the séance page refines it with the description). See sport-suggest.ts.
      suggestedSport: suggestSport(code, a.strava_name),
    } as Activity;
  });
}

export type Briefing = {
  briefing_date: string;
  created_at: string | null; // actual generation timestamp (the card shows the time)
  model: string | null;
  readiness: "green" | "amber" | "red" | null;
  today_session: string | null;
  why: string | null;
  flag: string | null;
  reasoning: string | null;
  // The coach now stores the full 7-day `week_plan` in this (legacy-named) column: each item still has
  // day_offset/focus/system_tag (so old renderers keep working) PLUS sport_code/target_load/is_key and,
  // when the day IS a declared event, anchors_event_ref. day_offset is 0..6 (0 = today).
  week_skeleton: {
    day_offset: number;
    focus: string;
    system_tag: string;
    sport_code?: string | null;
    target_load?: number | null;
    is_key?: boolean | null;
    anchors_event_ref?: string | null;
  }[] | null;
  confidence: number | null;
};

export type Profile = {
  name: string | null;
  // legacy single-goal columns (kept for back-compat; the app now reads the `goals` table)
  goal_race: string | null;
  goal_distance: string | null;
  goal_date: string | null;
  max_hr: number | null;
  resting_hr: number | null;
  lthr: number | null;
  hrv_baseline_ms: number | null;
  weight_kg: number | null;
};

/** Today's coach-recommended load (planned_sessions.target_load) — drives the "load vs plan" nudge.
 *  hasPlan=false ⇒ the coach hasn't planned today, so there's nothing to measure against. */
export type TodayPlan = {
  hasPlan: boolean;
  targetLoad: number | null; // summed coach target_load for today (null when no plan)
  isRest: boolean;           // coach tagged today's session 'rest'
};

/** One projected day on the dashboard charts' dotted forecast line (future days only, chronological).
 *  Days that carry a TARGET marker (a committed event/pinned session or a key day — the ones drawn with a
 *  hollow dot on the curve) plot the ARRIVAL (eve) form rather than the post-load spike, so the dot sits on
 *  the line; the days AFTER it reflect its load (the fatigue you'll actually carry forward). */
export type ProjectedPoint = {
  date: string;   // YYYY-MM-DD
  offset: number; // calendar days after the LAST real metric day (≥1) — chart x-position anchor
  ctl: number;
  atl: number;
  tsb: number;
  isTarget: boolean; // a day a target dot sits on → plotted at eve form (see above)
};

/** No-LLM, rule-based readiness flag for arriving at a declared event under the current plan. */
export type ProjectionWarning = {
  level: "caution" | "hard";
  message: string;
};

/** A planned session the dotted forecast reaches within the next 7 days — a declared EVENT, a PINNED
 *  (chat-accepted) session, or a COACH proposal — with the form projected for ARRIVING at it (the eve) and
 *  a readiness flag. Each session's own estimated load feeds the form arriving at the next one. */
export type PlannedMarker = {
  date: string;     // session date (YYYY-MM-DD)
  offset: number;   // calendar days from the LAST real metric day (chart marker x-position)
  daysOut: number;  // calendar days from today (1..7)
  // event/pinned = the athlete's COMMITTED plan (own event or accepted prescription) → drawn prominently;
  // coach = a proposal the coach made for that day → drawn muted but still clickable.
  kind: "event" | "pinned" | "coach";
  sessionId: string | null; // planned_sessions id → /seance/[id] (click-through from the chart panel)
  sportCode: string | null;
  systemTag: string | null;  // coach focus (rest/recovery/hard_*…) — drives the rest glyph + panel label
  title: string;
  isKey: boolean;
  predictedLoad: number | null; // estimated cost of the session itself (null when ~rest)
  targetCtl: number | null;     // projected CTL the day before (the form you arrive with)
  targetAtl: number | null;     // projected ATL the day before
  targetTsb: number | null;     // projected TSB (freshness) the day before
  warn: ProjectionWarning | null;
};

/** All planned sessions within the next 7 days (declared events + pinned + coach proposals) + the form
 *  projected for them under the current plan. Drives the dashboard Forme charts' DOTTED forecast: a
 *  day-by-day projected line from the last real point that continues THROUGH every session (chaining each
 *  one's estimated load into the next), with a target marker + readiness flag. null when nothing planned. */
export type DashboardProjection = {
  markers: PlannedMarker[];  // chronological, all within 7 d (events + pinned + coach)
  lastOffset: number;        // furthest marker's offset — drives the reserved trailing region width
  series: ProjectedPoint[];  // the dotted line: future days (last real +1 … the furthest marker), chronological
};

/** Arrival form (the eve of an event) the readiness flag reasons on. */
type ArrivalForm = {
  ctl: number | null; atl: number | null; tsb: number | null;
  ctlAero: number | null; tsbAero: number | null;
  ctlNeuro: number | null; tsbNeuro: number | null;
};

/** No-LLM readiness flag: will the athlete arrive fresh enough for an event given the planned loads?
 *  Uses the same CTL-relative bands as the TSB chart (fatigue < −10 % CTL · surcharge < −30 % CTL) on the
 *  overall TSB AND on each system the event meaningfully taxes (≥ 25 % of its estimated load — so a mixed
 *  alpinisme day is judged on both its aerobic and its neuromuscular freshness, catching lingering neuro
 *  fatigue from an earlier climbing event). Returns the worst band, naming the limiting system, or null. */
export function assessArrival(a: ArrivalForm, eventAero: number, eventNeuro: number): ProjectionWarning | null {
  const band = (tsb: number | null, ctl: number | null) => {
    if (tsb == null || ctl == null || ctl <= 0) return 0;
    if (tsb < -0.3 * ctl) return 2; // surcharge
    if (tsb < -0.1 * ctl) return 1; // fatigue productive
    return 0;
  };
  const total = eventAero + eventNeuro;
  // A channel counts only if the event meaningfully taxes it (≥25 % of its load). With no load estimate
  // (total 0) we can't attribute to a channel → judge on the overall TSB only (no fabricated channel bands).
  const usesAero = total > 0 && eventAero / total >= 0.25;
  const usesNeuro = total > 0 && eventNeuro / total >= 0.25;
  const bAero = usesAero ? band(a.tsbAero, a.ctlAero) : -1;
  const bNeuro = usesNeuro ? band(a.tsbNeuro, a.ctlNeuro) : -1;
  const level = Math.max(band(a.tsb, a.ctl), bAero, bNeuro);
  if (level === 0) return null;
  // Name a system ONLY when a taxed channel actually drives the worst band (reaches `level`); if it's the
  // overall TSB that drives it (no channel that deep), stay generic rather than mislabel a system.
  const sys = bNeuro === level && bNeuro >= bAero ? "neuromusculaire" : bAero === level ? "aérobie" : null;
  const tail = sys ? ` ${sys}` : "";
  if (level === 2) {
    return { level: "hard", message: `Au vu des séances prévues d'ici là, tu arriveras en fatigue${tail} marquée — atteindre ta forme sera compliqué. Vas-y tranquille, ce n'est pas le jour pour tout donner.` };
  }
  return { level: "caution", message: `Programme chargé d'ici là : il te restera peu de fraîcheur${tail}. Garde de la marge ce jour-là.` };
}

/** One day of the homepage's 7-day plan strip (today + next 6 days). Merges the coach's week_skeleton
 *  focus with the athlete's freshly-declared events (planned_sessions) so a just-added event shows
 *  immediately, even before the next briefing regen. Only days that carry something are emitted. */
export type WeekPlanDay = {
  dayOffset: number;        // 0..6 (0 = today)
  date: string;             // YYYY-MM-DD
  sportCode: string | null;
  systemTag: string | null; // coach focus (system_tag) — null on pure event days with no coach plan
  isEvent: boolean;         // day carries an athlete-declared event (vs a coach-planned session)
  isKey: boolean;           // a key session/event
  title: string | null;     // event title (events only)
  sessionId: string | null; // planned_sessions id → /seance/[id]: the declared event, else the coach session
  // Notable forecast for that day (canicule/orage/froid/pluie/vent), else null. CONTEXT, not readiness.
  weatherAlerts: { emoji: string; label: string }[]; // notable forecast badges (condition + temperature)
};

export type Dashboard = {
  profile: Profile | null;
  topGoal: GoalHeader | null;
  metrics: DailyMetric[];
  briefing: Briefing | null;
  activities: Activity[];     // 3 most recent (newest first) — homepage recents preview
  allActivities: Activity[];  // full charted-window set (oldest first) — feeds the interactive charts
  todayPlan: TodayPlan;       // coach's recommended load for today
  projection: DashboardProjection | null; // all planned sessions ≤7 d (event/pinned/coach) + projected form
  weekPlan: WeekPlanDay[];    // today + next 6 days: coach focus + declared events (homepage strip)
};

export async function getDashboard(): Promise<Dashboard> {
  const sb = await createServiceClient();
  // The dashboard shows a rolling window (today − N months); deeper history is in /analyse. Bounded
  // queries also stay under PostgREST's per-response row cap.
  const today = todayLocal();
  const windowStart = dateMinusDays(today, DASHBOARD_WINDOW_DAYS);
  const [pm, mm, bm, chartActs, multiActs, recents, sm, gm, pl, up, npm, wx] = await Promise.all([
    sb.from("athlete_profile").select("*").limit(1).maybeSingle(),
    sb.from("daily_metrics").select("*").gte("local_date", windowStart).order("local_date", { ascending: true }),
    sb.from("coach_briefings").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    // Activities within the chart window (oldest first) — feeds the per-day detail panel.
    sb.from("activities").select(ACTIVITY_COLS).gte("local_date", windowStart).order("started_at", { ascending: true }),
    // Multi-day expeditions (effective_days>1), UNBOUNDED: their load is spread across days the rollup
    // covers but they START before the window/older-chunk boundary, so the per-day panel needs them
    // regardless of the window to project their share onto in-view days (a tiny set; deduped by id below).
    sb.from("activities").select(ACTIVITY_COLS).gt("effective_days", 1).order("started_at", { ascending: true }),
    // 3 most recent activities (any date) — the homepage recents preview (full list lives in /activites,
    // reached via the "Voir tout" CTA). Kept tiny so the dashboard stays light.
    sb.from("activities").select(ACTIVITY_COLS).order("started_at", { ascending: false }).limit(3),
    sb.from("sports").select("id,code,display_name,taxonomy_group,needs_manual_rpe"),
    sb.from("goals").select("title,sport_id,target_date,target_horizon,target_detail")
      .eq("status", "active").order("priority_rank", { ascending: true }).limit(1),
    // Today's PRESCRIPTION (coach session OR a chat-accepted pinned one) — the recommended load the
    // "load vs plan" nudge compares against.
    sb.from("planned_sessions").select("target_load,system_tag")
      .eq("planned_date", today).eq("status", "planned").or("modified_by.eq.coach,is_pinned.is.true"),
    // Upcoming plan (events + coach + pinned) within ~2 weeks — feeds the projected "target" chart point.
    sb.from("planned_sessions").select("id,planned_date,sport_id,title,is_key,is_event,is_pinned,system_tag," +
      "modified_by,target_load,target_aerobic_load,target_neuromuscular_load," +
      "predicted_aerobic_load,predicted_neuromuscular_load,target_distance_m,target_vertical_m,target_duration_s")
      .gte("planned_date", today).lte("planned_date", dateMinusDays(today, -14)).neq("status", "skipped"),
    sb.from("athlete_load_params").select("value").eq("param", "neuro_atl_days").maybeSingle(),
    // Forecast for the 7-day plan strip (today..+6) — drives the sober per-day weather-alert glyph.
    sb.from("daily_weather").select("local_date,temp_min_c,temp_max_c,feels_max_c,precip_mm,wind_kmh,weather_code")
      .gte("local_date", today).lte("local_date", dateMinusDays(today, -6)),
  ]);

  const sportById = new Map<number, any>((sm.data ?? []).map((s: any) => [s.id, s]));
  const sportCodeById = new Map<number, string>((sm.data ?? []).map((s: any) => [s.id, s.code]));

  // Chart-window activities + any out-of-window multi-day expeditions, deduped by id, oldest first.
  const inWindow = enrichActivities(chartActs.data ?? [], sportById);
  const inWindowIds = new Set(inWindow.map((a) => a.id));
  const extraMulti = enrichActivities(multiActs.data ?? [], sportById).filter((a) => !inWindowIds.has(a.id));
  const allActivities = [...inWindow, ...extraMulti].sort((a, b) => a.started_at.localeCompare(b.started_at));

  const plannedRows = (pl.data ?? []) as { target_load: number | null; system_tag: string | null }[];
  const todayPlan: TodayPlan = {
    hasPlan: plannedRows.length > 0,
    targetLoad: plannedRows.length ? plannedRows.reduce((s, r) => s + (r.target_load ?? 0), 0) : null,
    isRest: plannedRows.some((r) => r.system_tag === "rest"),
  };

  // Projected "target" markers: every planned session ≤7 d ahead + the form each meets under the plan.
  const metricsRows = (mm.data as DailyMetric[]) ?? [];
  const upcoming = (up.data ?? []) as any[];
  const neuroAtlDays = Number((npm.data as any)?.value) || undefined;
  const { declared_events, coach_prior_plan, pinned_sessions } = buildPlanningView({
    today, daysBetween, dateMinusDays, dm: metricsRows, upcoming, codeById: sportCodeById, neuroAtlDays,
  });
  // Coach-planned session id per upcoming day (today..+6) → lets the strip's coach pills open the
  // session detail (/seance/[id]) so the athlete can plan the day around it. Keyed by day_offset.
  const coachIdByOffset = new Map<number, string>();
  for (const c of coach_prior_plan as any[]) {
    if (c.day_offset >= 0 && c.day_offset <= 6 && c.ref != null) coachIdByOffset.set(c.day_offset, c.ref);
  }
  // Every planned session within the next 7 days, chronological — events, pinned (chat-accepted)
  // sessions AND coach proposals all get a chart marker now (was: declared events only, which dropped
  // the athlete's own pinned approach-hike / climb and every coach-suggested day). Built straight from the
  // raw planned_sessions rows so each carries its kind + load. day_offset 0 (today) is excluded — today is
  // the cursor, not a future marker. The dotted forecast reaches the furthest one.
  const HARD_TAGS = new Set(["hard_aerobic", "hard_neuromuscular", "hard_structural"]);
  const markerKind = (r: any): "event" | "pinned" | "coach" =>
    r.is_event ? "event" : r.is_pinned ? "pinned" : "coach";
  // Per-session channel loads: prefer the persisted predicted/target split, else split target_load by tag.
  const rowLoads = (r: any): { aero: number; neu: number } => {
    let aero = r.predicted_aerobic_load ?? r.target_aerobic_load;
    let neu = r.predicted_neuromuscular_load ?? r.target_neuromuscular_load;
    if (aero == null && neu == null && r.target_load != null) {
      const s = splitByTag(Number(r.target_load), r.system_tag); aero = s.aerobic; neu = s.neuro;
    }
    return { aero: Number(aero) || 0, neu: Number(neu) || 0 };
  };
  const sessions7 = upcoming
    .map((r) => ({ r, daysOut: daysBetween(today, r.planned_date as string), kind: markerKind(r), ...rowLoads(r) }))
    .filter((s) => s.daysOut >= 1 && s.daysOut <= 7)
    .sort((a, b) => a.daysOut - b.daysOut);

  // 7-day plan strip (today..+6): seed with the coach's week_skeleton focus, then OVERLAY declared
  // events (authoritative + fresh) so a just-added event appears at once. Keyed by day_offset.
  const briefing = (bm.data as Briefing) ?? null;
  // week_skeleton day_offsets are RELATIVE TO THE BRIEFING'S GENERATION DAY (briefing_date), not today.
  // A briefing carried over from a previous day (cron/regen didn't run yet) would otherwise render one
  // day late — e.g. its "+6j event anchor" drawn as a phantom pill a day past the real event. Re-anchor
  // each offset onto today (skelShift < 0 when the briefing is stale); fresh briefings → shift 0 (no-op).
  const skelShift = briefing ? daysBetween(today, briefing.briefing_date) : 0;
  const weekMap = new Map<number, WeekPlanDay>();
  for (const d of briefing?.week_skeleton ?? []) {
    const off = d.day_offset + skelShift;
    if (off < 0 || off > 6) continue;
    const isEvent = !!d.anchors_event_ref;
    weekMap.set(off, {
      dayOffset: off,
      date: dateMinusDays(today, -off),
      sportCode: d.sport_code ?? null,
      systemTag: d.system_tag ?? null,
      isEvent,
      isKey: !!d.is_key,
      title: null,
      // Event day → its event ref; coach day → the materialized coach session for that day (if any).
      sessionId: isEvent ? (d.anchors_event_ref ?? null) : (coachIdByOffset.get(off) ?? null),
      weatherAlerts: [],
    });
  }
  // OVERLAY chat-accepted pinned sessions (a swapped day) over the stale skeleton — a coach prescription
  // (neutral stone pill, clickable to its /seance). Declared events overlay AFTER, so an event wins a clash.
  for (const p of pinned_sessions as any[]) {
    if (p.day_offset < 0 || p.day_offset > 6) continue;
    const ex = weekMap.get(p.day_offset);
    weekMap.set(p.day_offset, {
      dayOffset: p.day_offset,
      date: p.date,
      sportCode: p.sport ?? ex?.sportCode ?? null,
      systemTag: p.system_tag ?? ex?.systemTag ?? null,
      isEvent: false,
      isKey: !!p.is_key || !!ex?.isKey,
      title: p.title ?? null,
      sessionId: p.ref ?? ex?.sessionId ?? null,
      weatherAlerts: ex?.weatherAlerts ?? [],
    });
  }
  for (const e of declared_events as any[]) {
    if (e.day_offset < 0 || e.day_offset > 6) continue;
    const ex = weekMap.get(e.day_offset);
    weekMap.set(e.day_offset, {
      dayOffset: e.day_offset,
      date: e.date,
      sportCode: e.sport ?? ex?.sportCode ?? null,
      systemTag: ex?.systemTag ?? null,
      isEvent: true,
      isKey: !!e.is_key || !!ex?.isKey,
      title: e.title ?? null,
      sessionId: e.ref ?? ex?.sessionId ?? null,
      weatherAlerts: ex?.weatherAlerts ?? [],
    });
  }
  // Notable forecast per day on TWO axes — condition (orage/pluie/vent) + temperature (canicule/grand
  // froid) — so a stormy heatwave shows BOTH ⛈️ 🥵. Sober context glyphs; empty when benign.
  const wxAlertByDate = new Map<string, { emoji: string; label: string }[]>();
  for (const w of (wx.data ?? []) as any[]) {
    const a = weatherAlerts({
      tempMaxC: w.temp_max_c, tempMinC: w.temp_min_c, feelsMaxC: w.feels_max_c,
      precipMm: w.precip_mm, windKmh: w.wind_kmh, weatherCode: w.weather_code,
    });
    if (a.length) wxAlertByDate.set(w.local_date, a);
  }
  const weekPlan = [...weekMap.values()]
    .sort((a, b) => a.dayOffset - b.dayOffset)
    .map((d) => ({ ...d, weatherAlerts: wxAlertByDate.get(d.date) ?? [] }));

  // Dotted forecast: walk the fitness model forward over the planned loads from the last real day THROUGH
  // every planned session within 7 d (each one's estimated load lands in the walk, so the form arriving at
  // a later session already carries the cost of the earlier ones). COMMITTED/key markers (events, pinned,
  // key days) get a hollow target dot on the curve and the line dips to their arrival (eve) form so the dot
  // sits on it; routine coach days are shown only as a muted glyph + faint guide (no dot — the line keeps
  // its true post-load value there). Each marker carries a readiness flag where it's meaningful.
  let projection: DashboardProjection | null = null;
  if (sessions7.length) {
    // Anchor on the last row WITH a computed model (CTL) — the very last daily_metrics row is OFTEN a Garmin
    // recovery-only upsert with null CTL, and the chart's solid line + the projection MUST share that anchor
    // (the dashboard uses latestModel/latestIdx for exactly this), else the dotted line skips a column.
    let lastModelDate = today;
    for (let i = metricsRows.length - 1; i >= 0; i--) { if (metricsRows[i].ctl != null) { lastModelDate = metricsRows[i].local_date; break; } }
    const lastSession = sessions7[sessions7.length - 1];
    const plannedLoads = buildPlannedLoads(upcoming);
    const projected = projectFromMetrics(metricsRows, plannedLoads, {
      today, horizonDays: Math.max(1, lastSession.daysOut), neuroAtlDays,
    });
    // Combined form lookup (real history overlaid by the projection) for arrival/eve reads.
    const formByDate = new Map<string, ArrivalForm>();
    for (const m of metricsRows) if (m.ctl != null) formByDate.set(m.local_date, {
      ctl: m.ctl, atl: m.atl, tsb: m.tsb, ctlAero: m.ctl_aerobic, tsbAero: m.tsb_aerobic, ctlNeuro: m.ctl_neuromuscular, tsbNeuro: m.tsb_neuromuscular,
    });
    for (const p of projected) formByDate.set(p.local_date, {
      ctl: p.ctl, atl: p.atl, tsb: p.tsb, ctlAero: p.ctl_aerobic, tsbAero: p.tsb_aerobic, ctlNeuro: p.ctl_neuromuscular, tsbNeuro: p.tsb_neuromuscular,
    });

    // Group sessions that share a date — the marker + arrival form are per-DAY; same-day sessions combine
    // their loads (one marker, no duplicate keys, panel reachable). sessions7 is already chronological.
    type Sess = { r: any; daysOut: number; kind: "event" | "pinned" | "coach"; aero: number; neu: number };
    const rank = { event: 3, pinned: 2, coach: 1 } as const; // committed events win the day's kind/link
    const byDate = new Map<string, Sess[]>();
    for (const s of sessions7 as Sess[]) { const k = s.r.planned_date as string; const g = byDate.get(k); if (g) g.push(s); else byDate.set(k, [s]); }

    const markers: PlannedMarker[] = [...byDate.entries()].map(([date, group]) => {
      const arrival = formByDate.get(dateMinusDays(date, 1)) ?? formByDate.get(lastModelDate) ?? null;
      const aero = group.reduce((s, g) => s + g.aero, 0);
      const neu = group.reduce((s, g) => s + g.neu, 0);
      // Primary session = highest-priority kind, then heaviest — drives the day's kind, link, sport, title.
      const main = group.reduce((a, b) =>
        (rank[b.kind] - rank[a.kind] || (b.aero + b.neu) - (a.aero + a.neu)) > 0 ? b : a);
      const kind = main.kind;
      const isKey = group.some((g) => !!g.r.is_key);
      const systemTag = main.r.system_tag ?? null;
      // A readiness flag only where arriving fatigued matters: a committed session, a key day, or a hard
      // coach session — never a routine recovery/rest proposal (would be noise on every easy day).
      const wantWarn = kind !== "coach" || isKey || HARD_TAGS.has(systemTag ?? "");
      return {
        date,
        offset: daysBetween(lastModelDate, date),
        daysOut: main.daysOut,
        kind,
        sessionId: main.r.id ?? null, // link the primary (highest-priority, heaviest) session of the day
        sportCode: main.r.sport_id != null ? (sportCodeById.get(main.r.sport_id) ?? null) : null,
        systemTag,
        title: group.length === 1 ? main.r.title : group.map((g) => g.r.title).join(" + "),
        isKey,
        predictedLoad: aero || neu ? Math.round(aero + neu) : null,
        targetCtl: arrival?.ctl ?? null,
        targetAtl: arrival?.atl ?? null,
        targetTsb: arrival?.tsb ?? null,
        warn: wantWarn && arrival ? assessArrival(arrival, aero, neu) : null,
      };
    }).sort((a, b) => a.offset - b.offset);

    // Dates that get a hollow target dot on the curve (committed or key) → the line plots their eve form.
    const targetDates = new Set(markers.filter((m) => m.kind !== "coach" || m.isKey).map((m) => m.date));

    const series: ProjectedPoint[] = projected
      .filter((p) => p.local_date > lastModelDate && p.local_date <= lastSession.r.planned_date)
      .map((p) => {
        const isTarget = targetDates.has(p.local_date);
        // On a target day plot the ARRIVAL (eve) form so the dot sits on the line; otherwise the day's value.
        const src = isTarget ? formByDate.get(dateMinusDays(p.local_date, 1)) : null;
        return {
          date: p.local_date,
          offset: daysBetween(lastModelDate, p.local_date),
          ctl: src?.ctl ?? p.ctl,
          atl: src?.atl ?? p.atl,
          tsb: src?.tsb ?? p.tsb,
          isTarget,
        };
      });

    projection = { markers, lastOffset: daysBetween(lastModelDate, lastSession.r.planned_date as string), series };
  }

  return {
    profile: (pm.data as Profile) ?? null,
    topGoal: pickTopGoal(gm.data, sportCodeById),
    metrics: metricsRows,
    briefing,
    activities: enrichActivities(recents.data ?? [], sportById),
    allActivities,
    todayPlan,
    projection,
    weekPlan,
  };
}

/** Most recent day that actually has a computed fitness model (CTL). The very last calendar row is
 *  often a Garmin recovery-only upsert (no rollup ran past the last activity) — skip those. */
export function latestModel(metrics: DailyMetric[]): DailyMetric | null {
  for (let i = metrics.length - 1; i >= 0; i--) {
    if (metrics[i].ctl != null) return metrics[i];
  }
  return null;
}

export function daysUntil(dateISO: string | null | undefined): number | null {
  if (!dateISO) return null;
  const ms = Date.parse(dateISO + "T00:00:00Z") - Date.now();
  return Math.ceil(ms / 86_400_000);
}
