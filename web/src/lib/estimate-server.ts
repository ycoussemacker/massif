/** Server-side fetch wrapper around the pure estimator (estimate.ts). Pulls the bounded candidate set +
 *  resolves the load profile (same pattern as strava-sync.ts), then calls the pure dispatcher. Kept apart
 *  from estimate.ts so the pure core stays client-safe / unit-testable (no Supabase imports). */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Activity } from "./data";
import { listActivities } from "./activities";
import { spreadActivities } from "./aggregate";
import { resolveProfile, type LoadProfile, type LoadParams, type LoadSport, type ThresholdRow } from "./load";
import { estimateActivityLoad, type DeclaredActivity, type LoadEstimate } from "./estimate";
import { todayLocal, dateMinusDays } from "./coach-context";

const NEIGHBOUR_WINDOW_DAYS = 540; // ~18 months — bounds the read well under the PostgREST 1000-row cap
const NEIGHBOUR_LIMIT = 300; // load-ordered so big efforts (the relevant neighbours) aren't truncated

// A declared event's duration is the TOTAL/elapsed time the athlete plans for (breaks, summit, belays
// included), but the estimator matches it against past sorties' MOVING time (estimate.ts featureOf). So
// convert the declared elapsed → estimated moving via the moving/elapsed ratio — computed from the
// athlete's OWN history IN THE SAME SPORT (alpinism's ratio ≠ hiking's: rope work, slow committing
// pitches, belays make alpinism far more "stopped"). When that exact-sport history is thin, fall back to
// a per-SPORT standard (NOT the broader taxonomy — never mix alpi with rando), then a taxonomy default.
const MOVING_FRACTION_BY_SPORT: Record<string, number> = {
  grande_voie: 0.35, rock_climbing: 0.4, alpinism: 0.55, via_ferrata: 0.55, // rope/belays → lots of stops
  ski_touring: 0.65, snowshoeing: 0.8, hiking: 0.82,                        // mountain travel
  walking: 0.9, trail_running: 0.92, running: 0.95,                         // few stops
};
const MOVING_FRACTION_BY_TAXONOMY: Record<string, number> = {
  mountain_technical: 0.4, technical_strength: 0.45, mountain_vertical: 0.7, paced_endurance: 0.93,
};
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Moving/elapsed ratio for a declared event. `exactRows` MUST be same-sport activities only (never the
 *  taxonomy-widened set) so we don't apply a rando ratio to an alpi event. Falls to a per-sport default
 *  when same-sport history is thin (< 3 samples). */
function movingFraction(exactRows: Activity[], sportCode: string | null, taxonomy: string | null): number {
  const ratios = exactRows
    .map((c) => (c.moving_s && c.duration_s && c.duration_s > 0 ? c.moving_s / c.duration_s : null))
    .filter((r): r is number => r != null && r > 0.2 && r <= 1);
  if (ratios.length >= 3) return Math.max(0.4, Math.min(1, median(ratios)));
  return (sportCode ? MOVING_FRACTION_BY_SPORT[sportCode] : undefined)
      ?? (taxonomy ? MOVING_FRACTION_BY_TAXONOMY[taxonomy] : undefined)
      ?? 0.85;
}

/** The moving/elapsed ratio used to turn a declared TOTAL duration into estimated MOVING time, for one
 *  sport — same-sport history (≥3 sorties) else the per-sport default. Exposed so the séance detail can
 *  SHOW the estimated moving time of a declared event (the value the load estimate is built on). */
export async function estimatedMovingFraction(sb: SupabaseClient, sportId: number): Promise<number> {
  const today = todayLocal();
  const from = dateMinusDays(today, NEIGHBOUR_WINDOW_DAYS);
  const [{ data: sp }, exact] = await Promise.all([
    sb.from("sports").select("code,taxonomy_group").eq("id", sportId).maybeSingle(),
    listActivities({ sportIds: [sportId], from, order: "load_desc", limit: NEIGHBOUR_LIMIT }),
  ]);
  return movingFraction(exact.rows, (sp as any)?.code ?? null, (sp as any)?.taxonomy_group ?? null);
}

/** Estimate a declared activity's load from the athlete's history. `sb` is the service-role client. */
export async function estimateForDeclared(sb: SupabaseClient, declared: DeclaredActivity): Promise<LoadEstimate> {
  const today = todayLocal();
  const from = dateMinusDays(today, NEIGHBOUR_WINDOW_DAYS);

  // Sport (taxonomy + ladder) + the load profile resolved as-of today (mirror of strava-sync resolution).
  const [{ data: sportRow }, { data: profileRow }, { data: paramRows }, { data: thresholdRows }] = await Promise.all([
    sb.from("sports").select("code,taxonomy_group,load_method_ladder").eq("id", declared.sportId).maybeSingle(),
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

  // Convert the declared TOTAL duration → estimated MOVING duration before matching (so a declared 7h
  // doesn't over-match past 7h-moving monsters). The ratio comes from the SAME sport only (exact.rows),
  // never the taxonomy-widened candidates — an alpi event must not inherit a rando moving-ratio. Only the
  // duration is adjusted; distance/vertical stand.
  const sportCode = (sportRow?.code as string | undefined) ?? null;
  const frac = movingFraction(exact.rows, sportCode, sport.taxonomy_group);
  const declForEstimate: DeclaredActivity = declared.durationS != null
    ? { ...declared, durationS: Math.round(declared.durationS * frac) }
    : declared;

  return estimateActivityLoad(declForEstimate, { candidates, hist: candidates, sport, profile, params });
}
