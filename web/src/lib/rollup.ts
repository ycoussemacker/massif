/** Daily fitness-model rollup — mirror of `ingest/massif_ingest/sync.py` `rollup_daily_metrics` +
 *  `_ewma_series`. Recomputes the per-day load series + CTL/ATL/TSB/ACWR from `activities` and upserts
 *  the LOAD columns of `daily_metrics` (column-scoped: never touches the Garmin recovery columns,
 *  which are written by the Python garmin sync). Runs after the on-demand TS Strava pull so the
 *  dashboard's fitness/form numbers update instantly. Python is the source of truth and recomputes the
 *  identical series on the next nightly cron — KEEP IN SYNC with sync.py.
 *
 *  Builds a CONTIGUOUS daily spine (zero-load rest days included) so the EWMAs have no gaps. */
import type { SupabaseClient } from "@supabase/supabase-js";

const CTL_DAYS = 42;
const ATL_DAYS = 7;

/** Banister-style EWMA (CTL/ATL): alpha = 1 - e^(-1/tau), seeded at 0. Mirror of _ewma_series. */
function ewmaSeries(values: number[], tauDays: number): number[] {
  const alpha = 1 - Math.exp(-1 / tauDays);
  const out: number[] = [];
  let prev = 0;
  for (const v of values) {
    prev = prev + alpha * (v - prev);
    out.push(prev);
  }
  return out;
}

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Contiguous YYYY-MM-DD list from start..end inclusive (UTC day stepping, tz-agnostic on date-only). */
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

type DayBucket = { aer: number; neu: number; vup: number; vdn: number; byGroup: Record<string, number> };

/** Recompute daily_metrics load/model columns from all activities. Returns the number of days written. */
export async function rollupDailyMetrics(sb: SupabaseClient): Promise<number> {
  const { data: sports } = await sb.from("sports").select("id,taxonomy_group");
  const groupById = new Map<number, string>((sports ?? []).map((s: any) => [s.id, s.taxonomy_group ?? "other"]));

  const { data: acts } = await sb
    .from("activities")
    .select("local_date,aerobic_load,neuromuscular_load,vertical_gain_m,vertical_loss_m,sport_id");
  if (!acts?.length) return 0;

  // Aggregate per day.
  const days = new Map<string, DayBucket>();
  for (const a of acts as any[]) {
    const d = a.local_date as string;
    let b = days.get(d);
    if (!b) {
      b = { aer: 0, neu: 0, vup: 0, vdn: 0, byGroup: {} };
      days.set(d, b);
    }
    const aer = Number(a.aerobic_load || 0);
    const neu = Number(a.neuromuscular_load || 0);
    b.aer += aer;
    b.neu += neu;
    b.vup += Number(a.vertical_gain_m || 0);
    b.vdn += Number(a.vertical_loss_m || 0);
    const group = groupById.get(a.sport_id) ?? "other";
    b.byGroup[group] = (b.byGroup[group] ?? 0) + aer + neu;
  }

  // Contiguous spine min..max.
  const allDates = [...days.keys()].sort();
  const spine = dateSpine(allDates[0], allDates[allDates.length - 1]);
  const total = spine.map((d) => (days.get(d)?.aer ?? 0) + (days.get(d)?.neu ?? 0));
  const aerobic = spine.map((d) => days.get(d)?.aer ?? 0);
  const neuro = spine.map((d) => days.get(d)?.neu ?? 0);

  const ctl = ewmaSeries(total, CTL_DAYS);
  const atl = ewmaSeries(total, ATL_DAYS);
  const ctlA = ewmaSeries(aerobic, CTL_DAYS);
  const atlA = ewmaSeries(aerobic, ATL_DAYS);
  const ctlN = ewmaSeries(neuro, CTL_DAYS);
  const atlN = ewmaSeries(neuro, ATL_DAYS);

  const rows = spine.map((d, i) => {
    const b = days.get(d);
    return {
      local_date: d,
      daily_load: round(total[i]),
      daily_aerobic_load: round(aerobic[i]),
      daily_neuromuscular_load: round(neuro[i]),
      vertical_gain_m: round(b?.vup ?? 0, 1),
      vertical_loss_m: round(b?.vdn ?? 0, 1),
      load_by_group: Object.fromEntries(Object.entries(b?.byGroup ?? {}).map(([k, v]) => [k, round(v)])),
      ctl: round(ctl[i]),
      atl: round(atl[i]),
      tsb: round(ctl[i] - atl[i]),
      ctl_aerobic: round(ctlA[i]),
      atl_aerobic: round(atlA[i]),
      ctl_neuromuscular: round(ctlN[i]),
      atl_neuromuscular: round(atlN[i]),
      acwr: ctl[i] > 0 ? round(atl[i] / ctl[i]) : null,
    };
  });

  // Column-scoped upsert (load/model columns only) keyed on local_date — leaves Garmin recovery
  // columns on existing rows untouched. Batched (Python loops per-day; same effect).
  const { error } = await sb.from("daily_metrics").upsert(rows, { onConflict: "local_date" });
  if (error) throw new Error(`rollup upsert failed: ${error.message}`);
  return rows.length;
}
