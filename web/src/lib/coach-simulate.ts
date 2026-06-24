/** Form simulation for the coach chat — server-only. Projects the fitness model (CTL/ATL/TSB/ACWR)
 *  forward, BASELINE vs a HYPOTHETICAL set of sessions, so the coach can answer "when can I safely do X?"
 *  WITHOUT writing anything. Reuses buildPlannedLoads + projectFromMetrics — the exact math the dashboard
 *  forecast and the declared-event taper read — so the simulated numbers match what the athlete will see. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayLocal, dateMinusDays } from "./coach-context";
import { buildPlannedLoads } from "./planning";
import { projectFromMetrics, type SeedMetric, type DayLoad } from "./project";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A hypothetical session injected on a future date — REPLACES the planned load on that day (the same
 *  event-override semantics buildPlannedLoads uses). Overrides on past/today dates are ignored (the
 *  projection replays REAL load up to today). */
export type SimOverride = { date: string; aerobic: number; neuro: number };
export type SimPoint = {
  date: string; ctl: number; atl: number; tsb: number;
  tsb_aerobic: number; tsb_neuromuscular: number; acwr: number | null;
};
export type SimResult = {
  today: string;
  horizon_days: number;
  baseline: SimPoint[];               // today..+horizon under the CURRENT plan
  with_overrides: SimPoint[] | null;  // same window with the hypothetical sessions added (null if none)
};

export async function simulateForChat(
  sb: SupabaseClient,
  opts: { horizonDays?: number; overrides?: SimOverride[] },
): Promise<SimResult> {
  const today = todayLocal();
  const horizon = Math.min(60, Math.max(1, Math.round(opts.horizonDays ?? 21)));
  const seedFrom = dateMinusDays(today, 90); // enough history to seed the EWMA + replay the seed→today gap

  const [mm, up, np] = await Promise.all([
    sb.from("daily_metrics")
      .select("local_date,daily_aerobic_load,daily_neuromuscular_load,ctl,atl,ctl_aerobic,atl_aerobic,ctl_neuromuscular,atl_neuromuscular")
      .gte("local_date", seedFrom).order("local_date", { ascending: true }),
    sb.from("planned_sessions")
      .select("planned_date,is_event,system_tag,target_load,target_aerobic_load,target_neuromuscular_load,predicted_aerobic_load,predicted_neuromuscular_load")
      .gte("planned_date", today).neq("status", "skipped"),
    sb.from("athlete_load_params").select("value").eq("param", "neuro_atl_days").maybeSingle(),
  ]);

  const metrics = (mm.data ?? []) as SeedMetric[];
  const neuroAtlDays = Number((np.data as any)?.value) || undefined;
  const baseLoads = buildPlannedLoads(up.data ?? []);

  const project = (loads: DayLoad[]): SimPoint[] =>
    projectFromMetrics(metrics, loads, { today, horizonDays: horizon, neuroAtlDays })
      .filter((p) => p.local_date >= today) // future-facing portion only
      .map((p) => ({
        date: p.local_date, ctl: p.ctl, atl: p.atl, tsb: p.tsb,
        tsb_aerobic: p.tsb_aerobic, tsb_neuromuscular: p.tsb_neuromuscular, acwr: p.acwr,
      }));

  const baseline = project(baseLoads);

  const overrides = (opts.overrides ?? []).filter((o) => ISO.test(o.date ?? ""));
  let with_overrides: SimPoint[] | null = null;
  if (overrides.length) {
    const byDate = new Map<string, DayLoad>(baseLoads.map((d) => [d.date, d]));
    for (const o of overrides) {
      byDate.set(o.date, { date: o.date, aerobic: Number(o.aerobic) || 0, neuro: Number(o.neuro) || 0 });
    }
    with_overrides = project([...byDate.values()]);
  }

  return { today, horizon_days: horizon, baseline, with_overrides };
}
