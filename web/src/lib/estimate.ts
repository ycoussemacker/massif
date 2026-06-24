/** Estimate the load of a PLANNED/declared activity ("I'll do a big trail Saturday") from the athlete's
 *  OWN past efforts. Powers the quick-add form pre-fill (web/src/components/quick-add-event.tsx), the
 *  stored predicted_* on the planned_sessions row, and — through that row — the coach's view of an event.
 *
 *  Ladder (similarity FIRST, like the load method ladder):
 *    1. `similar`  — k nearest past efforts (same sport, else taxonomy), distance-weighted MEDIAN of their
 *                    realised aerobic/neuro load. Best signal: captures the athlete's real cost. Outliers
 *                    (needs_review) excluded; the median resists a freak day.
 *    2. `rate`     — per-sport historical rate (load/hour, load/1000 m D+) applied to the declared inputs.
 *    3. `computed` — computeLoad() on the rough inputs (deterministic floor, always available; for a no-HR
 *                    planned effort it only reaches vertical_duration/duration_fallback so it under-reads a
 *                    hard effort — hence it's the last resort).
 *
 *  Web-only (the cron coach reads the persisted predicted_* off the row instead of recomputing, so no
 *  coach/ mirror and no load.ts in coach/). Pure cores below are I/O-free + unit-testable. */
import type { Activity } from "./data";
import { computeLoad, type LoadProfile, type LoadParams, type LoadSport } from "./load";

export type DeclaredActivity = {
  sportId: number;
  taxonomyGroup: string | null;
  durationS?: number | null;
  distanceM?: number | null;
  verticalGainM?: number | null;
  verticalLossM?: number | null;
  name?: string | null;
};

export type LoadEstimate = {
  aerobic: number;
  neuro: number;
  total: number;
  basis: "similar" | "computed" | "rate";
  nSamples: number; // neighbours used (0 for computed)
  confidence: number; // 0..1
  basisLabel: string; // short FR string for planned_sessions.prediction_basis
  method?: string; // load_method_used when basis === 'computed'
};

const round = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// Feature weights for the similarity distance (vertical & duration dominate mountain cost).
const FEATURE_WEIGHTS = { durationS: 1.0, distanceM: 0.7, verticalGainM: 1.0, verticalLossM: 0.6 };
const K_NEIGHBOURS = 7;
const MIN_SAMPLES = 3; // below this, `similar` is not trusted → fall to rate/computed

type Feature = keyof typeof FEATURE_WEIGHTS;
const FEATURES: Feature[] = ["durationS", "distanceM", "verticalGainM", "verticalLossM"];

function featureOf(a: Activity, f: Feature): number | null {
  switch (f) {
    case "durationS": return a.moving_s ?? a.duration_s ?? null;
    case "distanceM": return a.distance_m ?? null;
    case "verticalGainM": return a.vertical_gain_m ?? null;
    case "verticalLossM": return a.vertical_loss_m ?? null;
  }
}
function declaredFeature(d: DeclaredActivity, f: Feature): number | null {
  switch (f) {
    case "durationS": return d.durationS ?? null;
    case "distanceM": return d.distanceM ?? null;
    case "verticalGainM": return d.verticalGainM ?? null;
    case "verticalLossM": return d.verticalLossM ?? null;
  }
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Weighted median: smallest value whose cumulative weight reaches half the total. */
function weightedMedian(pairs: { value: number; weight: number }[]): number {
  if (!pairs.length) return 0;
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  let acc = 0;
  for (const p of sorted) {
    acc += p.weight;
    if (acc >= total / 2) return p.value;
  }
  return sorted[sorted.length - 1].value;
}

function tokens(s: string | null | undefined): Set<string> {
  return new Set((s ?? "").toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter((t) => t.length >= 3));
}

/** k-nearest realised efforts → distance-weighted median of aerobic/neuro load. null if no usable data. */
export function estimateFromNeighbours(
  declared: DeclaredActivity,
  candidates: Activity[],
  opts?: { k?: number },
): LoadEstimate | null {
  const k = opts?.k ?? K_NEIGHBOURS;
  // Usable = not flagged + has both load channels.
  const pool = candidates.filter((c) => !c.needs_review && c.aerobic_load != null && c.neuromuscular_load != null);
  if (!pool.length) return null;

  // Per-feature scale = median of that feature over the pool (robust, self-scaling per sport).
  const scale: Record<Feature, number> = { durationS: 0, distanceM: 0, verticalGainM: 0, verticalLossM: 0 };
  for (const f of FEATURES) {
    const vals = pool.map((c) => featureOf(c, f)).filter((v): v is number => v != null && v > 0);
    scale[f] = vals.length ? median(vals) : 0;
  }
  // Features the declaration actually provides AND that vary in the pool.
  const usable = FEATURES.filter((f) => declaredFeature(declared, f) != null && scale[f] > 0);
  if (!usable.length) return null;

  const declTokens = tokens(declared.name);
  const scored = pool
    .map((c) => {
      let d2 = 0;
      let used = 0;
      for (const f of usable) {
        const cv = featureOf(c, f);
        if (cv == null) continue;
        const dv = declaredFeature(declared, f)!;
        const norm = (dv - cv) / scale[f];
        d2 += FEATURE_WEIGHTS[f] * norm * norm;
        used++;
      }
      if (!used) return null;
      let dist = Math.sqrt(d2 / used); // mean-normalised so missing features don't inflate distance
      // Same-route/-event name is a strong signal → soft boost (not a hard filter, keeps nSamples up).
      if (declTokens.size) {
        const ct = tokens(c.strava_name);
        let overlap = 0;
        for (const t of declTokens) if (ct.has(t)) overlap++;
        if (overlap) dist *= 0.7;
      }
      return { c, dist };
    })
    .filter((x): x is { c: Activity; dist: number } => x != null)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, k);

  if (scored.length < 1) return null;

  const eps = 1e-6;
  const aer = weightedMedian(scored.map((s) => ({ value: s.c.aerobic_load!, weight: 1 / (s.dist + eps) })));
  const neu = weightedMedian(scored.map((s) => ({ value: s.c.neuromuscular_load!, weight: 1 / (s.dist + eps) })));

  // Confidence: enough neighbours × tightness of the cluster.
  const totals = scored.map((s) => (s.c.aerobic_load ?? 0) + (s.c.neuromuscular_load ?? 0));
  const med = median(totals) || 1;
  const iqr = (() => {
    const s = [...totals].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return q(0.75) - q(0.25);
  })();
  const spreadPenalty = 1 - Math.min(iqr / med, 1);
  const confidence = clamp01((scored.length / k) * spreadPenalty);

  return {
    aerobic: round(aer),
    neuro: round(neu),
    total: round(aer + neu),
    basis: "similar",
    nSamples: scored.length,
    confidence: round(confidence),
    basisLabel: `moy. de ${scored.length} sortie${scored.length > 1 ? "s" : ""} similaire${scored.length > 1 ? "s" : ""}`,
  };
}

/** Per-sport rate (load/hour + load/1000 m D+) applied to the declared inputs. null if no history. */
export function estimateFromRate(declared: DeclaredActivity, hist: Activity[]): LoadEstimate | null {
  const pool = hist.filter((c) => !c.needs_review && c.aerobic_load != null && c.neuromuscular_load != null);
  if (!pool.length) return null;
  const tot = pool.reduce(
    (s, c) => {
      s.aer += c.aerobic_load ?? 0;
      s.neu += c.neuromuscular_load ?? 0;
      s.hours += (c.moving_s ?? c.duration_s ?? 0) / 3600;
      s.dplusK += (c.vertical_gain_m ?? 0) / 1000;
      return s;
    },
    { aer: 0, neu: 0, hours: 0, dplusK: 0 },
  );

  const hours = (declared.durationS ?? 0) / 3600;
  const dplusK = (declared.verticalGainM ?? 0) / 1000;
  let aer = 0;
  let neu = 0;
  if (hours > 0 && tot.hours > 0) {
    aer = (tot.aer / tot.hours) * hours;
    neu = (tot.neu / tot.hours) * hours;
  } else if (dplusK > 0 && tot.dplusK > 0) {
    aer = (tot.aer / tot.dplusK) * dplusK;
    neu = (tot.neu / tot.dplusK) * dplusK;
  } else {
    return null;
  }
  return {
    aerobic: round(aer),
    neuro: round(neu),
    total: round(aer + neu),
    basis: "rate",
    nSamples: pool.length,
    confidence: round(clamp01(0.6 * Math.min(pool.length / 5, 1))),
    basisLabel: `estimé d'après ton rythme habituel (${pool.length} sorties)`,
  };
}

/** Deterministic floor: computeLoad() on the rough declared inputs. Always returns something. */
export function estimateComputed(
  declared: DeclaredActivity,
  sport: LoadSport,
  profile: LoadProfile,
  params?: LoadParams,
): LoadEstimate {
  const r = computeLoad(
    {
      duration_s: declared.durationS ?? null,
      moving_s: declared.durationS ?? null,
      vertical_gain_m: declared.verticalGainM ?? null,
      vertical_loss_m: declared.verticalLossM ?? null,
    },
    sport,
    profile,
    params,
  );
  return {
    aerobic: r.aerobic_load,
    neuro: r.neuromuscular_load,
    total: round(r.aerobic_load + r.neuromuscular_load),
    basis: "computed",
    nSamples: 0,
    confidence: 0.4,
    method: r.load_method_used,
    basisLabel: "estimé (modèle, peu d'historique)",
  };
}

/** Pure dispatcher: similarity → rate → computed. `deps` are pre-fetched by the web wrapper. */
export function estimateActivityLoad(
  declared: DeclaredActivity,
  deps: { candidates: Activity[]; hist: Activity[]; sport: LoadSport; profile: LoadProfile; params?: LoadParams },
): LoadEstimate {
  const sim = estimateFromNeighbours(declared, deps.candidates);
  if (sim && sim.nSamples >= MIN_SAMPLES) return sim;
  const rate = estimateFromRate(declared, deps.hist);
  if (rate) return rate;
  return estimateComputed(declared, deps.sport, deps.profile, deps.params);
}
