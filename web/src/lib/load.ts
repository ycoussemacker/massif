/** Session-RPE load — mirror of `ingest/massif_ingest/load.py` (the `session_rpe` method + the
 *  additive two-channel model). Used by the RPE entry action to recompute a session's load the moment
 *  the athlete logs an RPE, so the UI updates instantly. Python remains the source of truth and
 *  recomputes the same value on the next sync — KEEP THESE CONSTANTS/FORMULA IN SYNC with load.py.
 *
 *  needs_manual_rpe sports always land on session_rpe (no usable HR/power; grade_volume/tonnage_rpe
 *  need detail rows we don't have yet). points = hours · (rpe/10)² · 100, then split into channels:
 *   - strength / climbing (STRUCTURAL_EFFORT_GROUPS): no aerobic engine → effort split by taxonomy
 *     (mostly neuromuscular).
 *   - everything else (mountain / endurance / surf with manual RPE): the effort is the aerobic load;
 *     the neuromuscular channel adds an impact fraction + the independent eccentric DESCENT term. */

export const STRUCTURAL_EFFORT_GROUPS = new Set(["technical_strength", "resistance"]);
const CHANNEL_SPLIT: Record<string, [number, number]> = {
  technical_strength: [0.15, 0.85],
  resistance: [0.1, 0.9],
  other: [0.7, 0.3],
};
export const IMPACT_FRAC: Record<string, number> = {
  paced_endurance: 0.15,
  mountain_vertical: 0.2,
  mountain_technical: 0.4, // multi-pitch / grande voie — long mountain day (aerobic + D±) AND technical
  //                          forearm/core cost → higher impact on top of the additive descent. Mirror load.py.
  aquatic: 0.1,
  other: 0.25,
};
export const DESCENT_LOAD_PER_1000M = 70;

export type SessionRpeLoad = {
  aerobic_load: number;
  neuromuscular_load: number;
  intensity_factor: number;
};

/** Structural inputs for the eccentric-descent term (mirror of load._descent_load). All optional —
 *  a missing D- degrades to no descent cost, exactly like the Python side. */
export type StructuralInputs = {
  verticalLossM?: number | null;
  carriedLoadKg?: number | null;
  weightKg?: number | null;
};

// NB: JS rounds half UP, Python round() rounds half-to-even, so a value landing exactly on a
// half-cent can differ by 0.01 pt from load.py. Harmless — Python is the source of truth and
// overwrites this on the next sync; this value is only for instant UI feedback.
const round2 = (n: number) => Math.round(n * 100) / 100;

export function sessionRpeLoad(
  durationS: number,
  rpe: number,
  taxonomyGroup: string | null,
  structural: StructuralInputs = {},
): SessionRpeLoad {
  const hours = Math.max(durationS, 0) / 3600;
  const intensity = rpe / 10;
  const points = hours * intensity * intensity * 100;
  const group = taxonomyGroup ?? "other";

  let aerobic: number;
  let neuromuscular: number;
  if (STRUCTURAL_EFFORT_GROUPS.has(group)) {
    const [a, n] = CHANNEL_SPLIT[group] ?? CHANNEL_SPLIT.other;
    aerobic = points * a;
    neuromuscular = points * n;
  } else {
    const weight = structural.weightKg || 70;
    const massFactor = 1 + (structural.carriedLoadKg || 0) / weight;
    const descent = ((structural.verticalLossM || 0) / 1000) * DESCENT_LOAD_PER_1000M * massFactor;
    aerobic = points;
    neuromuscular = points * (IMPACT_FRAC[group] ?? IMPACT_FRAC.other) + descent;
  }

  return {
    aerobic_load: round2(aerobic),
    neuromuscular_load: round2(neuromuscular),
    intensity_factor: Math.round(intensity * 1000) / 1000,
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Full load model — mirror of load.py `compute_load` + the whole method ladder. Used by the on-demand
// TS Strava sync (web/src/lib/strava-sync.ts) so a freshly-pulled activity gets the SAME load the
// nightly Python pull would compute. Python remains the source of truth (it overwrites on the next
// cron run); KEEP THIS IN SYNC with load.py (constants, methods, the additive channel logic).
// ───────────────────────────────────────────────────────────────────────────────────────────────

export const DEFAULT_IF = 0.55; // ~ easy aerobic effort
export const ASCENT_AEROBIC_PER_1000M = 100; // no-HR mountain aerobic estimate (D+); not added when HR is present
export const MULTIDAY_GAP_S = 6 * 3600; // overnight gap that marks a multi-day expedition (mirror load.py)

// ── Heat & altitude (mirror of load.py; docs/research/heat-altitude.md) ──────────────────────────
// Heat/altitude already raise HR for a given effort, so hrTSS ALREADY counts that strain — never apply an
// environmental multiplier to HR-derived load (double-count). The ONLY load correction is to the
// environment-BLIND mechanical methods tss (power) and rtss (pace), via altitudePowerFactor below.
export const ALT_ACCLIM_THRESHOLD_M = 800; // floor below which the altitude power/pace correction is negligible
export const ALT_HYPOXIA_THRESHOLD_M = 1500; // exposure-dose threshold for time_high_altitude_s (coach context)
export const VO2MAX_LOSS_PER_1000M = 0.065; // Wehrlin & Hallén 2006 (PMID 16311764): ~6.3%/1000 m, range 4.6-7.5
export const ALT_ACCLIM_RECOVERY = 0.35; // fraction of the acute VO2max loss recovered once acclimatized
export const ALT_CORRECTION_CAP = 0.3; // cap the loss term — beyond ~5000 m we're outside this linear model

/** Intensity multiplier (≥1.0) for the altitude-blind methods (tss/rtss), NEVER hrtss. Mirror of
 *  load.altitude_power_factor — defaults to unacclimatized (the larger, conservative correction). */
export function altitudePowerFactor(avgAltitudeM?: number | null, acclimatized = false): number {
  const alt = avgAltitudeM || 0;
  if (alt <= ALT_ACCLIM_THRESHOLD_M) return 1.0;
  let loss = (VO2MAX_LOSS_PER_1000M * (alt - ALT_ACCLIM_THRESHOLD_M)) / 1000;
  if (acclimatized) loss *= 1 - ALT_ACCLIM_RECOVERY;
  loss = Math.min(loss, ALT_CORRECTION_CAP);
  return 1 / (1 - loss);
}

/** Minimal activity shape compute_load reads (load/raw fields). */
export type LoadActivity = {
  started_at?: string | null;
  duration_s?: number | null;
  moving_s?: number | null;
  avg_hr?: number | null;
  np_power_w?: number | null;
  avg_power_w?: number | null;
  avg_pace_s_per_km?: number | null;
  vertical_gain_m?: number | null;
  vertical_loss_m?: number | null;
  carried_load_kg?: number | null;
  avg_altitude_m?: number | null; // drives the tss/rtss altitude correction (never hrtss)
  perceived_rpe?: number | null;
  rpe_source?: string | null; // 'user' clears the mostly-stopped flag (see needsReview)
};
export type LoadProfile = {
  ftp_watts?: number | null;
  resting_hr?: number | null;
  max_hr?: number | null;
  lthr?: number | null;
  threshold_pace_s_per_km?: number | null;
  weight_kg?: number | null;
};
export type LoadSport = { taxonomy_group: string; load_method_ladder?: string[] | null };

/** An athlete_thresholds row (effective-dated). Mirror of the Python THRESHOLD_FIELDS overlay. */
export type ThresholdRow = LoadProfile & { effective_date: string };
const THRESHOLD_FIELDS = ["max_hr", "resting_hr", "lthr", "ftp_watts", "threshold_pace_s_per_km", "weight_kg"] as const;

/** Resolve the profile as-of `onDate` (mirror of load.resolve_profile): the base athlete_profile overlaid
 *  with the latest athlete_thresholds row whose effective_date <= onDate (its non-null fields only).
 *  Empty/absent history or date → the base profile unchanged (identical behaviour until rows exist). */
export function resolveProfile(
  profile: LoadProfile,
  history: ThresholdRow[] | null | undefined,
  onDate?: string | null,
): LoadProfile {
  if (!history?.length || !onDate) return profile;
  const applicable = history.filter((h) => (h.effective_date || "") <= onDate);
  if (!applicable.length) return profile;
  const row = applicable.reduce((best, h) => (h.effective_date > best.effective_date ? h : best));
  const merged: LoadProfile = { ...profile };
  for (const k of THRESHOLD_FIELDS) {
    const v = (row as Record<string, unknown>)[k];
    if (v != null) (merged as Record<string, unknown>)[k] = v;
  }
  return merged;
}

export type LoadResult = {
  aerobic_load: number;
  neuromuscular_load: number;
  load_method_used: string;
  intensity_factor: number | null;
  effective_days: number; // >1 ⇒ multi-day expedition; the rollup spreads the load across this many days
  needs_review: boolean;  // load rests on a suspect input (see needsReview) — surface for review
};

/** Calendar days a multi-day EXPEDITION truly spans (≥2); else 1. Mirror of load.py activity_span_days:
 *  a trip qualifies only if its elapsed window crosses calendar days AND has a large non-moving gap
 *  (≥ MULTIDAY_GAP_S), so a night race that merely crosses midnight (elapsed≈moving) stays 1 day. */
export function activitySpanDays(
  startedAt?: string | null,
  durationS?: number | null,
  movingS?: number | null,
): number {
  if (!startedAt || !durationS) return 1;
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return 1;
  const end = new Date(start.getTime() + durationS * 1000);
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const span = Math.round((endDay - startDay) / 86_400_000) + 1;
  // `movingS || durationS` (not `??`) to MIRROR Python's `moving_s or duration_s`: a moving_s of 0
  // (GPS-less / manual log) must fall back to elapsed → gap 0 → not flagged, exactly like load.py.
  const gap = durationS - (movingS || durationS);
  return span > 1 && gap >= MULTIDAY_GAP_S ? span : 1;
}

/** Seconds of real effort to score: MOVING time for a multi-day expedition (elapsed counts the nights),
 *  else elapsed `duration_s` (unchanged for every normal activity). Mirror of load.py _active_duration. */
export function activeDuration(a: LoadActivity): number {
  const dur = a.duration_s || 0;
  if (activitySpanDays(a.started_at, dur, a.moving_s) > 1) return a.moving_s || dur;
  return dur;
}

// Outlier guard + mostly-stopped correction — mirror of load.py. A mostly-stopped single-day outing
// (long belays/approach/pauses) genuinely over-counts effort on elapsed time, so the DURATION-DRIVEN
// methods score it on MOVING time (scoredDuration); HR/power/pace methods keep elapsed (their intensity
// already reflects the stops → no double-correct). We still FLAG it; a user RPE then clears the flag.
export const REVIEW_IF_CEILING = 1.5;
export const REVIEW_STOP_RATIO = 0.5;
export const REVIEW_MIN_ELAPSED_S = 3600;

/** A single-day outing (≥ REVIEW_MIN_ELAPSED_S elapsed) mostly spent stopped (moving/elapsed <
 *  REVIEW_STOP_RATIO). Multi-day expeditions (effectiveDays>1) are handled separately. Mirror of load.py. */
export function mostlyStopped(a: LoadActivity, effectiveDays: number): boolean {
  const dur = a.duration_s || 0;
  const mov = a.moving_s;
  return effectiveDays === 1 && dur >= REVIEW_MIN_ELAPSED_S && !!mov && mov / dur < REVIEW_STOP_RATIO;
}

/** Effort seconds for the duration-driven methods (vertical_duration / session_rpe / duration_fallback):
 *  MOVING time for a multi-day expedition OR a single-day mostly-stopped outing, else elapsed. Mirror of
 *  load.py _scored_duration. The HR/power/pace methods keep activeDuration (see the comment above). */
export function scoredDuration(a: LoadActivity): number {
  const dur = a.duration_s || 0;
  const effDays = activitySpanDays(a.started_at, dur, a.moving_s);
  if (effDays > 1 || mostlyStopped(a, effDays)) return a.moving_s || dur;
  return dur;
}

/** True when the computed load rests on a suspect input: an HR glitch (avg_hr above the athlete's max),
 *  an implausible intensity factor, or a mostly-stopped single-day outing. A user-entered RPE clears the
 *  stop-ratio flag (the athlete vouched for the effort). Mirror of load.py needs_review — keep in sync. */
export function needsReview(
  a: LoadActivity,
  p: LoadProfile,
  intensityFactor: number | null,
  effectiveDays: number,
): boolean {
  if (a.avg_hr && p.max_hr && a.avg_hr > p.max_hr) return true;
  if (intensityFactor && intensityFactor > REVIEW_IF_CEILING) return true;
  if (a.rpe_source !== "user" && mostlyStopped(a, effectiveDays)) return true;
  return false;
}

function tssFromIf(durationS: number, intensity: number): number {
  const hours = Math.max(durationS, 0) / 3600;
  return hours * intensity * intensity * 100;
}
function hrFraction(hr: number, rhr: number, maxHr: number): number {
  const denom = maxHr - rhr;
  return denom > 0 ? (hr - rhr) / denom : 0;
}
function massFactor(a: LoadActivity, p: LoadProfile): number {
  const weight = p.weight_kg || 70;
  return 1 + (a.carried_load_kg || 0) / weight;
}
// Adaptive calibration (prio 3c) — resolve each calibratable coefficient to a personalized value from
// athlete_load_params when fitted, else the population default. Mirror of load.py _effective. `c` rides
// through the methods. An empty params object ⇒ today's behaviour exactly.
export type LoadParams = Record<string, number>;
type Coeffs = { defaultIf: number; descentPer1000m: number; ascentPer1000m: number };
function effective(params?: LoadParams): Coeffs {
  return {
    defaultIf: params?.default_if ?? DEFAULT_IF,
    descentPer1000m: params?.descent_load_per_1000m ?? DESCENT_LOAD_PER_1000M,
    ascentPer1000m: params?.ascent_aerobic_per_1000m ?? ASCENT_AEROBIC_PER_1000M,
  };
}

function descentLoad(a: LoadActivity, p: LoadProfile, c: Coeffs): number {
  return ((a.vertical_loss_m || 0) / 1000) * c.descentPer1000m * massFactor(a, p);
}

type MethodResult = [number, number] | null; // [points, intensity]
const METHODS: Record<string, (a: LoadActivity, p: LoadProfile, c: Coeffs) => MethodResult> = {
  tss(a, p) {
    const npw = a.np_power_w || a.avg_power_w;
    if (!npw || !p.ftp_watts) return null;
    // Power is environment-blind → altitude-correct (hrtss is not; it already reflects the strain).
    const intensity = (npw / p.ftp_watts) * altitudePowerFactor(a.avg_altitude_m);
    return [tssFromIf(activeDuration(a), intensity), intensity];
  },
  hrtss(a, p, c) {
    if (!(a.avg_hr && p.resting_hr && p.max_hr && p.lthr)) return null;
    const avgFrac = hrFraction(a.avg_hr, p.resting_hr, p.max_hr);
    const thrFrac = hrFraction(p.lthr, p.resting_hr, p.max_hr);
    const intensity = thrFrac > 0 ? avgFrac / thrFrac : c.defaultIf;
    return [tssFromIf(activeDuration(a), intensity), intensity];
  },
  rtss(a, p) {
    if (!(a.avg_pace_s_per_km && p.threshold_pace_s_per_km)) return null;
    // Pace is environment-blind → altitude-correct (same pace is harder in thin air); hrtss is not.
    const intensity = (p.threshold_pace_s_per_km / a.avg_pace_s_per_km) * altitudePowerFactor(a.avg_altitude_m);
    return [tssFromIf(activeDuration(a), intensity), intensity];
  },
  vertical_duration(a, p, c) {
    if (!a.duration_s) return null;
    const base = tssFromIf(scoredDuration(a), c.defaultIf);
    const ascent = ((a.vertical_gain_m || 0) / 1000) * c.ascentPer1000m * massFactor(a, p);
    return [base + ascent, c.defaultIf];
  },
  grade_volume: () => null, // detail rows not wired yet (mirror load.py)
  tonnage_rpe: () => null,
  session_rpe(a) {
    if (!a.perceived_rpe) return null;
    const intensity = a.perceived_rpe / 10;
    return [tssFromIf(scoredDuration(a), intensity), intensity];
  },
  duration_fallback(a, p, c) {
    if (!a.duration_s) return null;
    return [tssFromIf(scoredDuration(a), c.defaultIf), c.defaultIf];
  },
};

/** Full mirror of load.py `compute_load`: pick the first ladder method whose inputs exist as the
 *  aerobic engine, then build the two channels additively (descent D- + impact) — or split by taxonomy
 *  for structural sports. */
export function computeLoad(activity: LoadActivity, sport: LoadSport, profile: LoadProfile, params?: LoadParams): LoadResult {
  const c = effective(params);
  const ladder = sport.load_method_ladder?.length ? sport.load_method_ladder : ["duration_fallback"];
  let chosen = "duration_fallback";
  let points = 0;
  let intensity = c.defaultIf;
  for (const method of ladder) {
    const fn = METHODS[method];
    if (!fn) continue;
    // Prefer HR over the no-HR vertical estimate when the ladder offers hrtss (avoid double-counting
    // the climb), but ladders without hrtss (alpinism / via_ferrata) still get vertical_duration.
    if (method === "vertical_duration" && ladder.includes("hrtss") && METHODS.hrtss(activity, profile, c)) continue;
    const result = fn(activity, profile, c);
    if (result) {
      [points, intensity] = result;
      chosen = method;
      break;
    }
  }

  const group = sport.taxonomy_group;
  let aerobic: number;
  let neuromuscular: number;
  if (STRUCTURAL_EFFORT_GROUPS.has(group)) {
    const [a, n] = CHANNEL_SPLIT[group] ?? CHANNEL_SPLIT.other;
    aerobic = points * a;
    neuromuscular = points * n;
  } else {
    aerobic = points;
    neuromuscular = points * (IMPACT_FRAC[group] ?? IMPACT_FRAC.other) + descentLoad(activity, profile, c);
  }

  const effectiveDays = activitySpanDays(activity.started_at, activity.duration_s, activity.moving_s);
  const intensityFactor = Math.round(intensity * 1000) / 1000;
  return {
    aerobic_load: round2(aerobic),
    neuromuscular_load: round2(neuromuscular),
    load_method_used: chosen,
    intensity_factor: intensityFactor,
    effective_days: effectiveDays,
    needs_review: needsReview(activity, profile, intensityFactor, effectiveDays),
  };
}
