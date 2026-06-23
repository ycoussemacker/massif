/** Dashboard data access — server-side reads via the service-role client (RLS is off, local-first). */
import { createServiceClient } from "./supabase/server";
import { pickTopGoal, type GoalHeader } from "./profile-types";
import { todayLocal } from "./coach-context";

/** Calendar date `n` months before `iso` (handles month lengths). */
function monthsAgo(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

/** Rolling window (in months) shown by the dashboard charts. Deeper history lives in /analyse. */
export const DASHBOARD_WINDOW_MONTHS = 2;

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
  strava_name: string | null; // Strava activity title (from sport_specific->>strava_name)
  effective_days: number | null; // >1 ⇒ multi-day expedition whose load is spread across this many days
  needs_review: boolean | null;  // load rests on a suspect input (HR>max, implausible IF, mostly-stopped)
  // Set only on the per-day PROJECTION of a multi-day activity (see aggregate.groupByDateSpanned): this
  // row's load/duration fields then carry just that day's 1/total share; spanInfo records which day.
  spanInfo?: { index: number; total: number; fullLoad: number | null } | null;
};

/** Column list for an activities select that yields a full Activity (after enrichment). */
export const ACTIVITY_COLS =
  "id,local_date,started_at,source,source_activity_id,sport_id,training_load,aerobic_load,neuromuscular_load," +
  "load_method_used,duration_s,moving_s,distance_m,vertical_gain_m,vertical_loss_m,carried_load_kg,avg_hr," +
  "perceived_rpe,rpe_source,effective_days,needs_review,strava_name:sport_specific->>strava_name";

/** Attach sport display fields (FR-friendly name/code, taxonomy, RPE flag) to raw activity rows.
 *  Shared by getDashboard and lib/activities.listActivities so both enrich identically. */
export function enrichActivities(rows: any[], sportById: Map<number, any>): Activity[] {
  return rows.map((a: any) => {
    const s = sportById.get(a.sport_id);
    return {
      ...a,
      sport: s?.display_name ?? s?.code ?? "—",
      sport_code: s?.code ?? null,
      taxonomy_group: s?.taxonomy_group ?? null,
      needs_manual_rpe: !!s?.needs_manual_rpe,
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
  week_skeleton: { day_offset: number; focus: string; system_tag: string }[] | null;
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

export type Dashboard = {
  profile: Profile | null;
  topGoal: GoalHeader | null;
  metrics: DailyMetric[];
  briefing: Briefing | null;
  activities: Activity[];     // 15 most recent (newest first) — recents table
  allActivities: Activity[];  // full charted-window set (oldest first) — feeds the interactive charts
  todayPlan: TodayPlan;       // coach's recommended load for today
};

export async function getDashboard(): Promise<Dashboard> {
  const sb = await createServiceClient();
  // The dashboard shows a rolling window (today − N months); deeper history is in /analyse. Bounded
  // queries also stay under PostgREST's per-response row cap.
  const today = todayLocal();
  const windowStart = monthsAgo(today, DASHBOARD_WINDOW_MONTHS);
  const [pm, mm, bm, chartActs, multiActs, recents, sm, gm, pl] = await Promise.all([
    sb.from("athlete_profile").select("*").limit(1).maybeSingle(),
    sb.from("daily_metrics").select("*").gte("local_date", windowStart).order("local_date", { ascending: true }),
    sb.from("coach_briefings").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    // Activities within the chart window (oldest first) — feeds the per-day detail panel.
    sb.from("activities").select(ACTIVITY_COLS).gte("local_date", windowStart).order("started_at", { ascending: true }),
    // Multi-day expeditions (effective_days>1), UNBOUNDED: their load is spread across days the rollup
    // covers but they START before the window/older-chunk boundary, so the per-day panel needs them
    // regardless of the window to project their share onto in-view days (a tiny set; deduped by id below).
    sb.from("activities").select(ACTIVITY_COLS).gt("effective_days", 1).order("started_at", { ascending: true }),
    // 15 most recent activities (any date) — the recents table.
    sb.from("activities").select(ACTIVITY_COLS).order("started_at", { ascending: false }).limit(15),
    sb.from("sports").select("id,code,display_name,taxonomy_group,needs_manual_rpe"),
    sb.from("goals").select("title,sport_id,target_date,target_horizon,target_detail")
      .eq("status", "active").order("priority_rank", { ascending: true }).limit(1),
    // Today's coach-planned session(s) — the recommended load the "load vs plan" nudge compares against.
    sb.from("planned_sessions").select("target_load,system_tag")
      .eq("planned_date", today).eq("modified_by", "coach").eq("status", "planned"),
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

  return {
    profile: (pm.data as Profile) ?? null,
    topGoal: pickTopGoal(gm.data, sportCodeById),
    metrics: (mm.data as DailyMetric[]) ?? [],
    briefing: (bm.data as Briefing) ?? null,
    activities: enrichActivities(recents.data ?? [], sportById),
    allActivities,
    todayPlan,
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
