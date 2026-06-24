/** Forward projection of the fitness model (CTL/ATL/TSB, total + per-channel) over PLANNED future loads.
 *
 *  Used to answer two product questions: (a) "what CTL/ATL/TSB will I have the day BEFORE a declared
 *  event if I execute this plan" (the coach reads it to set the taper), and (b) the dashboard's detached
 *  future target point. Computed ON THE FLY, never persisted — projections change every time the plan or a
 *  declaration changes, and must never be confused with realised history (the column-scoped daily_metrics
 *  upsert + the nightly Python rollup own the real rows).
 *
 *  EXACTNESS: a Banister EWMA is Markovian — tomorrow's value depends only on today's value + tomorrow's
 *  load, NOT on the full history. So continuing the recurrence from the last computed day's CTL/ATL is
 *  mathematically identical to re-running the whole series and slicing the tail. We seed from the stored
 *  (2-dp-rounded) latestModel, so the projection can drift ≤0.01 pt from a full-precision rollup — harmless
 *  for a forecast. The constants + recurrence MIRROR web/src/lib/rollup.ts (and sync.py) — keep in sync. */

// τ constants — MIRROR rollup.ts / sync.py.
const CTL_DAYS = 42;
const ATL_DAYS = 7;
const NEURO_ATL_DAYS = 14; // neuro acute decays slower; personalizable via athlete_load_params.neuro_atl_days

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** One EWMA step: prev + (1-e^(-1/τ))·(v-prev). Mirror of the rollup recurrence. */
function step(prev: number, v: number, tauDays: number): number {
  const alpha = 1 - Math.exp(-1 / tauDays);
  return prev + alpha * (v - prev);
}

/** Contiguous YYYY-MM-DD list start..end inclusive (UTC stepping). Mirror of rollup.dateSpine. */
function dateSpine(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (d.getTime() <= last.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** The last computed CTL/ATL values to continue the EWMA from (per channel). */
export type EwmaSeed = {
  date: string;
  ctl: number;
  atl: number;
  ctl_aerobic: number;
  atl_aerobic: number;
  ctl_neuromuscular: number;
  atl_neuromuscular: number;
};

/** A day's load split into the two channels (the input to a projection step). */
export type DayLoad = { date: string; aerobic: number; neuro: number };

/** A projected daily_metrics-shaped row. `projected:true` discriminates it from a real row everywhere. */
export type ProjectedMetric = {
  local_date: string;
  projected: true;
  daily_aerobic_load: number;
  daily_neuromuscular_load: number;
  daily_load: number;
  ctl: number;
  atl: number;
  tsb: number;
  ctl_aerobic: number;
  atl_aerobic: number;
  tsb_aerobic: number;
  ctl_neuromuscular: number;
  atl_neuromuscular: number;
  tsb_neuromuscular: number;
  acwr: number | null;
};

/** Walk the EWMA forward from `seed` over `dayLoads` (assumed chronological & contiguous). Pure. */
export function projectForward(
  seed: EwmaSeed,
  dayLoads: DayLoad[],
  opts?: { neuroAtlDays?: number },
): ProjectedMetric[] {
  const nAtl = opts?.neuroAtlDays || NEURO_ATL_DAYS;
  let { ctl, atl, ctl_aerobic, atl_aerobic, ctl_neuromuscular, atl_neuromuscular } = seed;
  const out: ProjectedMetric[] = [];
  for (const d of dayLoads) {
    const total = d.aerobic + d.neuro;
    ctl = step(ctl, total, CTL_DAYS);
    atl = step(atl, total, ATL_DAYS);
    ctl_aerobic = step(ctl_aerobic, d.aerobic, CTL_DAYS);
    atl_aerobic = step(atl_aerobic, d.aerobic, ATL_DAYS);
    ctl_neuromuscular = step(ctl_neuromuscular, d.neuro, CTL_DAYS);
    atl_neuromuscular = step(atl_neuromuscular, d.neuro, nAtl);
    out.push({
      local_date: d.date,
      projected: true,
      daily_aerobic_load: round(d.aerobic),
      daily_neuromuscular_load: round(d.neuro),
      daily_load: round(total),
      ctl: round(ctl),
      atl: round(atl),
      tsb: round(ctl - atl),
      ctl_aerobic: round(ctl_aerobic),
      atl_aerobic: round(atl_aerobic),
      tsb_aerobic: round(ctl_aerobic - atl_aerobic),
      ctl_neuromuscular: round(ctl_neuromuscular),
      atl_neuromuscular: round(atl_neuromuscular),
      tsb_neuromuscular: round(ctl_neuromuscular - atl_neuromuscular),
      acwr: ctl > 0 ? round(atl / ctl) : null,
    });
  }
  return out;
}

/** Minimal real-metrics shape the projection needs (a subset of DailyMetric). */
export type SeedMetric = {
  local_date: string;
  daily_aerobic_load: number | null;
  daily_neuromuscular_load: number | null;
  ctl: number | null;
  atl: number | null;
  ctl_aerobic: number | null;
  atl_aerobic: number | null;
  ctl_neuromuscular: number | null;
  atl_neuromuscular: number | null;
};

/** Build a forward projection from the real daily_metrics series + future planned loads.
 *  Seeds from the last row that has a computed model (CTL), then walks day-by-day from there to
 *  `today + horizonDays`: for days up to today it replays the REAL daily loads (so the latest→today gap
 *  decays honestly), for future days it uses `plannedLoads` (a declared event REPLACES the coach load on
 *  its day — the caller merges that). Unmapped future days are rest (load 0) so the EWMA decays as it
 *  really would. Returns [] when there's no seed (no model yet). */
export function projectFromMetrics(
  metrics: SeedMetric[],
  plannedLoads: DayLoad[],
  opts: { today: string; horizonDays: number; neuroAtlDays?: number },
): ProjectedMetric[] {
  // Last row with a real computed model = the seed.
  let seedRow: SeedMetric | null = null;
  for (let i = metrics.length - 1; i >= 0; i--) {
    if (metrics[i].ctl != null) {
      seedRow = metrics[i];
      break;
    }
  }
  if (!seedRow) return [];

  const seed: EwmaSeed = {
    date: seedRow.local_date,
    ctl: seedRow.ctl ?? 0,
    atl: seedRow.atl ?? 0,
    ctl_aerobic: seedRow.ctl_aerobic ?? 0,
    atl_aerobic: seedRow.atl_aerobic ?? 0,
    ctl_neuromuscular: seedRow.ctl_neuromuscular ?? 0,
    atl_neuromuscular: seedRow.atl_neuromuscular ?? 0,
  };

  // Real loads for the seed→today gap (days already happened but past the seed).
  const realByDate = new Map<string, DayLoad>();
  for (const m of metrics) {
    realByDate.set(m.local_date, {
      date: m.local_date,
      aerobic: m.daily_aerobic_load ?? 0,
      neuro: m.daily_neuromuscular_load ?? 0,
    });
  }
  const plannedByDate = new Map<string, DayLoad>(plannedLoads.map((p) => [p.date, p]));

  // Spine from the day AFTER the seed to today+horizon.
  const end = (() => {
    const t = Date.parse(opts.today + "T00:00:00Z") + opts.horizonDays * 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
  })();
  const startNext = (() => {
    const t = Date.parse(seed.date + "T00:00:00Z") + 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
  })();
  if (startNext > end) return [];

  const dayLoads: DayLoad[] = dateSpine(startNext, end).map((d) => {
    if (d <= opts.today) return realByDate.get(d) ?? { date: d, aerobic: 0, neuro: 0 };
    return plannedByDate.get(d) ?? { date: d, aerobic: 0, neuro: 0 };
  });

  return projectForward(seed, dayLoads, { neuroAtlDays: opts.neuroAtlDays });
}
