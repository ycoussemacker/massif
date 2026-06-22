/** Pure aggregation / grouping helpers over Activity lists.
 *  No I/O. Type-only import of Activity so this stays client-safe (data.ts pulls in the server
 *  Supabase client — `import type` is erased and never bundled). Reused by the chart day-panel,
 *  the activities page summary strip and the A-vs-B comparison page. */
import type { Activity } from "./data";

export type LoadAgg = {
  sessions: number;
  load: number;
  aerobic: number;
  neuro: number;
  durationS: number;
  distanceM: number;
  gainM: number;
  lossM: number;
};

export function emptyAgg(): LoadAgg {
  return { sessions: 0, load: 0, aerobic: 0, neuro: 0, durationS: 0, distanceM: 0, gainM: 0, lossM: 0 };
}

/** Sum a list of activities into one LoadAgg (all null-safe). */
export function aggregate(rows: Activity[]): LoadAgg {
  const a = emptyAgg();
  for (const r of rows) {
    a.sessions += 1;
    a.load += r.training_load ?? 0;
    a.aerobic += r.aerobic_load ?? 0;
    a.neuro += r.neuromuscular_load ?? 0;
    a.durationS += r.duration_s ?? 0;
    a.distanceM += r.distance_m ?? 0;
    a.gainM += r.vertical_gain_m ?? 0;
    a.lossM += r.vertical_loss_m ?? 0;
  }
  return a;
}

/** Group activities by local_date (YYYY-MM-DD), preserving input order within each day. */
export function groupByDate(rows: Activity[]): Map<string, Activity[]> {
  const m = new Map<string, Activity[]>();
  for (const r of rows) {
    const bucket = m.get(r.local_date);
    if (bucket) bucket.push(r);
    else m.set(r.local_date, [r]);
  }
  return m;
}

function bucketAgg<K>(rows: Activity[], key: (a: Activity) => K): Map<K, LoadAgg> {
  const groups = new Map<K, Activity[]>();
  for (const r of rows) {
    const k = key(r);
    const b = groups.get(k);
    if (b) b.push(r);
    else groups.set(k, [r]);
  }
  const out = new Map<K, LoadAgg>();
  for (const [k, list] of groups) out.set(k, aggregate(list));
  return out;
}

/** {sport_id → LoadAgg}. */
export function aggregateBySport(rows: Activity[]): Map<number, LoadAgg> {
  return bucketAgg(rows, (a) => a.sport_id);
}

/** {taxonomy_group → LoadAgg} ("other" when null). */
export function aggregateByTaxonomy(rows: Activity[]): Map<string, LoadAgg> {
  return bucketAgg(rows, (a) => a.taxonomy_group ?? "other");
}

/** Total aerobic vs neuromuscular split across a list. */
export function aggregateByChannel(rows: Activity[]): { aerobic: number; neuro: number } {
  const a = aggregate(rows);
  return { aerobic: a.aerobic, neuro: a.neuro };
}

export type FieldDelta = { abs: number; pct: number | null }; // pct null when the baseline is 0
export type AggDelta = Record<keyof LoadAgg, FieldDelta>;

/** Per-field delta b − a (current minus baseline) with a percentage vs the baseline. */
export function diff(base: LoadAgg, cur: LoadAgg): AggDelta {
  const keys = Object.keys(base) as (keyof LoadAgg)[];
  const out = {} as AggDelta;
  for (const k of keys) {
    const abs = cur[k] - base[k];
    out[k] = { abs, pct: base[k] !== 0 ? (abs / base[k]) * 100 : null };
  }
  return out;
}
