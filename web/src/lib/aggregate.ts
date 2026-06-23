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

/** Rolling training monotony (mean ÷ SD of daily load over `w` days). High (>~2) = too uniform = risk.
 *  Computed client-side from the daily-load series — the DB doesn't persist it. null until the window
 *  fills, or when SD≈0 (e.g. a full rest week). */
export function rollingMonotony(loads: number[], w = 7): (number | null)[] {
  return loads.map((_, i) => {
    if (i < w - 1) return null;
    const win = loads.slice(i - w + 1, i + 1);
    const mean = win.reduce((s, v) => s + v, 0) / w;
    const sd = Math.sqrt(win.reduce((s, v) => s + (v - mean) ** 2, 0) / w);
    return sd > 0.01 ? mean / sd : null;
  });
}

/** Per-day load broken down by sport, for a stacked composition chart. Keeps the top-N sports by total
 *  load; the rest fold into "other". perDay maps date → (sportKey → load); sportKey is the sport_id or
 *  the literal "other". Sports are identified by glyph+name in the legend — never by colour. */
export function sportComposition(rows: Activity[], topN = 6): {
  order: { key: number | "other"; code: string | null; name: string; total: number }[];
  perDay: Map<string, Map<number | "other", number>>;
} {
  const totals = new Map<number, { code: string | null; name: string; total: number }>();
  for (const r of rows) {
    const t = totals.get(r.sport_id) ?? { code: r.sport_code, name: r.sport, total: 0 };
    t.total += r.training_load ?? 0;
    totals.set(r.sport_id, t);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1].total - a[1].total);
  const top = new Set(ranked.slice(0, topN).map(([id]) => id));
  const keyOf = (id: number): number | "other" => (top.has(id) ? id : "other");

  const perDay = new Map<string, Map<number | "other", number>>();
  for (const r of rows) {
    const day = perDay.get(r.local_date) ?? new Map<number | "other", number>();
    const k = keyOf(r.sport_id);
    day.set(k, (day.get(k) ?? 0) + (r.training_load ?? 0));
    perDay.set(r.local_date, day);
  }

  const order: { key: number | "other"; code: string | null; name: string; total: number }[] =
    ranked.slice(0, topN).map(([id, t]) => ({ key: id, code: t.code, name: t.name, total: t.total }));
  const otherTotal = ranked.slice(topN).reduce((s, [, t]) => s + t.total, 0);
  if (otherTotal > 0) order.push({ key: "other", code: null, name: "Autres", total: otherTotal });
  return { order, perDay };
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
