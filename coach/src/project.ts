/** Forward projection of the fitness model (CTL/ATL/TSB) over planned future loads.
 *  MIRROR of web/src/lib/project.ts — keep identical (both seed the Markovian EWMA from the last computed
 *  day and walk forward; constants mirror rollup.ts / sync.py). Pure, no I/O. */

const CTL_DAYS = 42;
const ATL_DAYS = 7;
const NEURO_ATL_DAYS = 14;

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

function step(prev: number, v: number, tauDays: number): number {
  const alpha = 1 - Math.exp(-1 / tauDays);
  return prev + alpha * (v - prev);
}

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

export type EwmaSeed = {
  date: string;
  ctl: number;
  atl: number;
  ctl_aerobic: number;
  atl_aerobic: number;
  ctl_neuromuscular: number;
  atl_neuromuscular: number;
};

export type DayLoad = { date: string; aerobic: number; neuro: number };

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

export function projectFromMetrics(
  metrics: SeedMetric[],
  plannedLoads: DayLoad[],
  opts: { today: string; horizonDays: number; neuroAtlDays?: number },
): ProjectedMetric[] {
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

  const realByDate = new Map<string, DayLoad>();
  for (const m of metrics) {
    realByDate.set(m.local_date, {
      date: m.local_date,
      aerobic: m.daily_aerobic_load ?? 0,
      neuro: m.daily_neuromuscular_load ?? 0,
    });
  }
  const plannedByDate = new Map<string, DayLoad>(plannedLoads.map((p) => [p.date, p]));

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
