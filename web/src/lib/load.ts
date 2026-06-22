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

/** Minimal activity shape compute_load reads (load/raw fields). */
export type LoadActivity = {
  duration_s?: number | null;
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
};

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
    return [tssFromIf(a.duration_s || 0, intensity), intensity];
  },
  hrtss(a, p) {
    if (!(a.avg_hr && p.resting_hr && p.max_hr && p.lthr)) return null;
    const avgFrac = hrFraction(a.avg_hr, p.resting_hr, p.max_hr);
    const thrFrac = hrFraction(p.lthr, p.resting_hr, p.max_hr);
    const intensity = thrFrac > 0 ? avgFrac / thrFrac : DEFAULT_IF;
    return [tssFromIf(a.duration_s || 0, intensity), intensity];
  },
  rtss(a, p) {
    if (!(a.avg_pace_s_per_km && p.threshold_pace_s_per_km)) return null;
    const intensity = p.threshold_pace_s_per_km / a.avg_pace_s_per_km;
    return [tssFromIf(a.duration_s || 0, intensity), intensity];
  },
  vertical_duration(a, p) {
    if (!a.duration_s) return null;
    const base = tssFromIf(a.duration_s, DEFAULT_IF);
    const ascent = ((a.vertical_gain_m || 0) / 1000) * ASCENT_AEROBIC_PER_1000M * massFactor(a, p);
    return [base + ascent, DEFAULT_IF];
  },
  grade_volume: () => null, // detail rows not wired yet (mirror load.py)
  tonnage_rpe: () => null,
  session_rpe(a) {
    if (!a.perceived_rpe) return null;
    const intensity = a.perceived_rpe / 10;
    return [tssFromIf(a.duration_s || 0, intensity), intensity];
  },
  duration_fallback(a) {
    if (!a.duration_s) return null;
    return [tssFromIf(a.duration_s, DEFAULT_IF), DEFAULT_IF];
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

  return {
    aerobic_load: round2(aerobic),
    neuromuscular_load: round2(neuromuscular),
    load_method_used: chosen,
    intensity_factor: Math.round(intensity * 1000) / 1000,
  };
}
