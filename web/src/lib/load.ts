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
