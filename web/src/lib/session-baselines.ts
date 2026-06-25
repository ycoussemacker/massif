/** Per-athlete session-load baselines — the DYNAMIC, personalised replacement for the hard-coded coach
 *  target loads (briefing-algo.ts BASE_LOAD). From the athlete's OWN recent activities we derive the
 *  typical load of each session TYPE, by classifying each realised effort on two axes already computed
 *  by the load model:
 *    • intensity_factor (IF, 1.0 ≈ threshold) → recovery / easy / hard_aerobic
 *    • neuromuscular fraction (neuro / total) → hard_neuromuscular / hard_structural (strength, descent…)
 *  and taking the MEDIAN load of each bucket (robust to a freak day). A bucket needs ≥ MIN_SAMPLES to be
 *  trusted; below that the caller keeps the population default (BASE_LOAD) — "works for a new user,
 *  sharpens with data", the same pattern as athlete_load_params / athlete_thresholds. Pure + testable;
 *  no Supabase import (the caller passes the rows). Multi-user-ready: every value is the athlete's own. */

// NOTE: recovery + rest are deliberately NOT derived — they're prescribed LIGHT doses (a short easy
// outing / a day off), and an IF-only "recovery" bucket would mislabel a long low-HR mountain hike as
// recovery. We personalise only the "working" session types; recovery/rest keep their small defaults.
export type BaselineTag = "easy" | "hard_aerobic" | "hard_neuromuscular" | "hard_structural";

export type BaselineActivity = {
  training_load: number | null;
  aerobic_load: number | null;
  neuromuscular_load: number | null;
  intensity_factor: number | null;
};

const MIN_SAMPLES = 3;        // below this in a bucket → not trusted, caller falls back to the default
const MIN_LOAD = 8;           // ignore near-zero efforts (noise / GPS blips)
// Intensity-factor cut (IF ≈ 1.0 at threshold). "FC proche du seuil" ⇒ hard_aerobic; below ⇒ easy.
const IF_THRESHOLD = 0.82;
// Neuromuscular-fraction cut points (neuro / total).
const NF_NEURO = 0.45;
const NF_STRUCTURAL = 0.7;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Classify one realised activity into the session bucket it best represents (or null to skip). */
export function classify(a: BaselineActivity): BaselineTag | null {
  const total = a.training_load ?? 0;
  if (total < MIN_LOAD) return null;
  const aero = a.aerobic_load ?? 0;
  const neu = a.neuromuscular_load ?? 0;
  const nf = aero + neu > 0 ? neu / (aero + neu) : 0;
  if (nf >= NF_STRUCTURAL) return "hard_structural";
  if (nf >= NF_NEURO) return "hard_neuromuscular";
  // Aerobic-dominant → threshold-or-above is hard_aerobic, everything below (incl. low-IF endurance
  // and no-IF) is easy. The MEDIAN keeps a rare long monster from moving the easy baseline.
  const iff = a.intensity_factor;
  if (iff != null && iff >= IF_THRESHOLD) return "hard_aerobic";
  return "easy";
}

// We only PERSONALISE the AEROBIC session targets (easy + threshold), where intensity (HR/IF) is a clean
// signal. The neuromuscular load is dominated by eccentric DESCENT on long mountain days — so a history-
// derived "hard_neuromuscular"/"hard_structural" reflects big-descent outings, not the intended hill/
// strength dose; those keep the population default. The neuro classification still matters here: it keeps
// descent-heavy days OUT of the aerobic buckets so they don't inflate easy/threshold.
const PERSONALISED: BaselineTag[] = ["easy", "hard_aerobic"];

/** Median realised load per AEROBIC session type, for buckets with ≥ MIN_SAMPLES. Other tags are omitted
 *  (the caller keeps the population default). */
export function computeSessionBaselines(acts: BaselineActivity[]): Partial<Record<BaselineTag, number>> {
  const buckets: Record<BaselineTag, number[]> = {
    easy: [], hard_aerobic: [], hard_neuromuscular: [], hard_structural: [],
  };
  for (const a of acts) {
    const tag = classify(a);
    if (tag) buckets[tag].push(a.training_load as number);
  }
  const out: Partial<Record<BaselineTag, number>> = {};
  for (const tag of PERSONALISED) {
    const xs = buckets[tag];
    if (xs.length >= MIN_SAMPLES) out[tag] = Math.round(median(xs));
  }
  return out;
}
