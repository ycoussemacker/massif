/** Dashboard data access — server-side reads via the service-role client (RLS is off, local-first). */
import { createServiceClient } from "./supabase/server";
import { pickTopGoal, type GoalHeader } from "./profile-types";

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
  ctl_neuromuscular: number | null;
  atl_neuromuscular: number | null;
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
  distance_m: number | null;
  vertical_gain_m: number | null;
  vertical_loss_m: number | null;
  carried_load_kg: number | null;
  avg_hr: number | null;
  perceived_rpe: number | null;
  rpe_source: string | null;
};

export type Briefing = {
  briefing_date: string;
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

export type Dashboard = {
  profile: Profile | null;
  topGoal: GoalHeader | null;
  metrics: DailyMetric[];
  briefing: Briefing | null;
  activities: Activity[];
};

export async function getDashboard(): Promise<Dashboard> {
  const sb = await createServiceClient();
  const [pm, mm, bm, am, sm, gm] = await Promise.all([
    sb.from("athlete_profile").select("*").limit(1).maybeSingle(),
    sb.from("daily_metrics").select("*").order("local_date", { ascending: true }),
    sb.from("coach_briefings").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("activities")
      .select("id,local_date,started_at,source,source_activity_id,sport_id,training_load,aerobic_load,neuromuscular_load," +
              "load_method_used,duration_s,distance_m,vertical_gain_m,vertical_loss_m,carried_load_kg,avg_hr,perceived_rpe,rpe_source")
      .order("started_at", { ascending: false })
      .limit(15),
    sb.from("sports").select("id,code,display_name,taxonomy_group,needs_manual_rpe"),
    sb.from("goals").select("title,sport_id,target_date,target_horizon,target_detail")
      .eq("status", "active").order("priority_rank", { ascending: true }).limit(1),
  ]);

  const sportById = new Map<number, any>((sm.data ?? []).map((s: any) => [s.id, s]));
  const sportCodeById = new Map<number, string>((sm.data ?? []).map((s: any) => [s.id, s.code]));
  const activities: Activity[] = (am.data ?? []).map((a: any) => {
    const s = sportById.get(a.sport_id);
    return {
      ...a,
      sport: s?.display_name ?? s?.code ?? "—",
      sport_code: s?.code ?? null,
      taxonomy_group: s?.taxonomy_group ?? null,
      needs_manual_rpe: !!s?.needs_manual_rpe,
    };
  });

  return {
    profile: (pm.data as Profile) ?? null,
    topGoal: pickTopGoal(gm.data, sportCodeById),
    metrics: (mm.data as DailyMetric[]) ?? [],
    briefing: (bm.data as Briefing) ?? null,
    activities,
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
