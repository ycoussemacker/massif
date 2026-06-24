/** Server-side fetch wrapper around the pure estimator (estimate.ts). Pulls the bounded candidate set +
 *  resolves the load profile (same pattern as strava-sync.ts), then calls the pure dispatcher. Kept apart
 *  from estimate.ts so the pure core stays client-safe / unit-testable (no Supabase imports). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { listActivities } from "./activities";
import { spreadActivities } from "./aggregate";
import { resolveProfile, type LoadProfile, type LoadParams, type LoadSport, type ThresholdRow } from "./load";
import { estimateActivityLoad, type DeclaredActivity, type LoadEstimate } from "./estimate";
import { todayLocal, dateMinusDays } from "./coach-context";

const NEIGHBOUR_WINDOW_DAYS = 540; // ~18 months — bounds the read well under the PostgREST 1000-row cap
const NEIGHBOUR_LIMIT = 300; // load-ordered so big efforts (the relevant neighbours) aren't truncated

/** Estimate a declared activity's load from the athlete's history. `sb` is the service-role client. */
export async function estimateForDeclared(sb: SupabaseClient, declared: DeclaredActivity): Promise<LoadEstimate> {
  const today = todayLocal();
  const from = dateMinusDays(today, NEIGHBOUR_WINDOW_DAYS);

  // Sport (taxonomy + ladder) + the load profile resolved as-of today (mirror of strava-sync resolution).
  const [{ data: sportRow }, { data: profileRow }, { data: paramRows }, { data: thresholdRows }] = await Promise.all([
    sb.from("sports").select("taxonomy_group,load_method_ladder").eq("id", declared.sportId).maybeSingle(),
    sb.from("athlete_profile").select("max_hr,resting_hr,lthr,ftp_watts,threshold_pace_s_per_km,weight_kg").limit(1).maybeSingle(),
    sb.from("athlete_load_params").select("param,value"),
    sb.from("athlete_thresholds").select("*").order("effective_date", { ascending: true }),
  ]);

  const sport: LoadSport = {
    taxonomy_group: sportRow?.taxonomy_group ?? declared.taxonomyGroup ?? "other",
    load_method_ladder: sportRow?.load_method_ladder ?? null,
  };
  const baseProfile = (profileRow ?? {}) as LoadProfile;
  const params: LoadParams = Object.fromEntries(
    ((paramRows ?? []) as { param: string; value: number }[]).filter((r) => r.value != null).map((r) => [r.param, Number(r.value)]),
  );
  const profile = resolveProfile(baseProfile, (thresholdRows ?? []) as ThresholdRow[], today);

  // Candidates: exact sport first (load-ordered), widen to taxonomy only if the exact bucket is thin.
  const exact = await listActivities({
    sportIds: [declared.sportId],
    from,
    order: "load_desc",
    limit: NEIGHBOUR_LIMIT,
  });
  let candidates = spreadActivities(exact.rows);
  if (exact.rows.length < 5 && (sport.taxonomy_group ?? declared.taxonomyGroup)) {
    const wide = await listActivities({
      taxonomy: [sport.taxonomy_group ?? declared.taxonomyGroup!],
      from,
      order: "load_desc",
      limit: NEIGHBOUR_LIMIT,
    });
    candidates = spreadActivities(wide.rows);
  }

  return estimateActivityLoad(declared, { candidates, hist: candidates, sport, profile, params });
}
