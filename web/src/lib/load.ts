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
  perceived_rpe?: number | null;
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

// Outlier guard — mirror of load.py. Flags (never caps) a load that rests on a suspect input.
export const REVIEW_IF_CEILING = 1.5;
export const REVIEW_STOP_RATIO = 0.5;
export const REVIEW_MIN_ELAPSED_S = 3600;

/** True when the computed load rests on a suspect input: an HR glitch (avg_hr above the athlete's max),
 *  an implausible intensity factor, or a single-day outing scored on elapsed time that was mostly spent
 *  stopped. Multi-day expeditions (effectiveDays>1) are handled by the spread, so not flagged here.
 *  Mirror of load.py needs_review — keep in sync. */
export function needsReview(
  a: LoadActivity,
  p: LoadProfile,
  intensityFactor: number | null,
  effectiveDays: number,
): boolean {
  if (a.avg_hr && p.max_hr && a.avg_hr > p.max_hr) return true;
  if (intensityFactor && intensityFactor > REVIEW_IF_CEILING) return true;
  const dur = a.duration_s || 0;
  const mov = a.moving_s;
  if (effectiveDays === 1 && dur >= REVIEW_MIN_ELAPSED_S && mov && mov / dur < REVIEW_STOP_RATIO) return true;
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
function descentLoad(a: LoadActivity, p: LoadProfile): number {
  return ((a.vertical_loss_m || 0) / 1000) * DESCENT_LOAD_PER_1000M * massFactor(a, p);
}

type MethodResult = [number, number] | null; // [points, intensity]
const METHODS: Record<string, (a: LoadActivity, p: LoadProfile) => MethodResult> = {
  tss(a, p) {
    const npw = a.np_power_w || a.avg_power_w;
    if (!npw || !p.ftp_watts) return null;
    const intensity = npw / p.ftp_watts;
    return [tssFromIf(activeDuration(a), intensity), intensity];
  },
  hrtss(a, p) {
    if (!(a.avg_hr && p.resting_hr && p.max_hr && p.lthr)) return null;
    const avgFrac = hrFraction(a.avg_hr, p.resting_hr, p.max_hr);
    const thrFrac = hrFraction(p.lthr, p.resting_hr, p.max_hr);
    const intensity = thrFrac > 0 ? avgFrac / thrFrac : DEFAULT_IF;
    return [tssFromIf(activeDuration(a), intensity), intensity];
  },
  rtss(a, p) {
    if (!(a.avg_pace_s_per_km && p.threshold_pace_s_per_km)) return null;
    const intensity = p.threshold_pace_s_per_km / a.avg_pace_s_per_km;
    return [tssFromIf(activeDuration(a), intensity), intensity];
  },
  vertical_duration(a, p) {
    if (!a.duration_s) return null;
    const base = tssFromIf(activeDuration(a), DEFAULT_IF);
    const ascent = ((a.vertical_gain_m || 0) / 1000) * ASCENT_AEROBIC_PER_1000M * massFactor(a, p);
    return [base + ascent, DEFAULT_IF];
  },
  grade_volume: () => null, // detail rows not wired yet (mirror load.py)
  tonnage_rpe: () => null,
  session_rpe(a) {
    if (!a.perceived_rpe) return null;
    const intensity = a.perceived_rpe / 10;
    return [tssFromIf(activeDuration(a), intensity), intensity];
  },
  duration_fallback(a) {
    if (!a.duration_s) return null;
    return [tssFromIf(activeDuration(a), DEFAULT_IF), DEFAULT_IF];
  },
};

/** Full mirror of load.py `compute_load`: pick the first ladder method whose inputs exist as the
 *  aerobic engine, then build the two channels additively (descent D- + impact) — or split by taxonomy
 *  for structural sports. */
export function computeLoad(activity: LoadActivity, sport: LoadSport, profile: LoadProfile): LoadResult {
  const ladder = sport.load_method_ladder?.length ? sport.load_method_ladder : ["duration_fallback"];
  let chosen = "duration_fallback";
  let points = 0;
  let intensity = DEFAULT_IF;
  for (const method of ladder) {
    const fn = METHODS[method];
    if (!fn) continue;
    // Prefer HR over the no-HR vertical estimate when the ladder offers hrtss (avoid double-counting
    // the climb), but ladders without hrtss (alpinism / via_ferrata) still get vertical_duration.
    if (method === "vertical_duration" && ladder.includes("hrtss") && METHODS.hrtss(activity, profile)) continue;
    const result = fn(activity, profile);
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
    neuromuscular = points * (IMPACT_FRAC[group] ?? IMPACT_FRAC.other) + descentLoad(activity, profile);
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
