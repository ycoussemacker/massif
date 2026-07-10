/** Daily fitness-model rollup — mirror of `ingest/massif_ingest/sync.py` `rollup_daily_metrics` +
 *  `_ewma_series`. Recomputes the per-day load series + CTL/ATL/TSB/ACWR from `activities` and upserts
 *  the LOAD columns of `daily_metrics` (column-scoped: never touches the Garmin recovery columns,
 *  which are written by the Python garmin sync). Runs after the on-demand TS Strava pull so the
 *  dashboard's fitness/form numbers update instantly. Python is the source of truth and recomputes the
 *  identical series on the next nightly cron — KEEP IN SYNC with sync.py.
 *
 *  Builds a CONTIGUOUS daily spine (zero-load rest days included) so the EWMAs have no gaps. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { descentFamiliarityRatios, descentRecoveryFactor, ewmaVariableTau } from "./load";
import { todayLocal } from "./coach-context";

const CTL_DAYS = 42;
const ATL_DAYS = 7;
// Neuromuscular acute load decays slower than aerobic (structural/tendon fatigue lingers ~weeks).
// Mirror of sync.py NEURO_ATL_DAYS — keep in sync.
const NEURO_ATL_DAYS = 14;

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
    .select("local_date,aerobic_load,neuromuscular_load,vertical_gain_m,vertical_loss_m,sport_id,effective_days");
  if (!acts?.length) return 0;

  // Neuromuscular acute τ: personalized from athlete_load_params when fitted, else NEURO_ATL_DAYS.
  const { data: paramRows } = await sb.from("athlete_load_params").select("param,value").eq("param", "neuro_atl_days");
  const neuroAtlDays = Number((paramRows ?? [])[0]?.value) || NEURO_ATL_DAYS;

  // Aggregate per day. A multi-day expedition (effective_days>1) is spread EVENLY across the calendar
  // days it spans (from its local_date) so its load doesn't spike one day — mirror of sync.py.
  const days = new Map<string, DayBucket>();
  for (const a of acts as any[]) {
    const eff = Math.max(Number(a.effective_days) || 1, 1);
    const aer = Number(a.aerobic_load || 0) / eff;
    const neu = Number(a.neuromuscular_load || 0) / eff;
    const vup = Number(a.vertical_gain_m || 0) / eff;
    const vdn = Number(a.vertical_loss_m || 0) / eff;
    const group = groupById.get(a.sport_id) ?? "other";
    const start = new Date((a.local_date as string) + "T00:00:00Z");
    for (let i = 0; i < eff; i++) {
      const d = new Date(start.getTime());
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      let b = days.get(key);
      if (!b) {
        b = { aer: 0, neu: 0, vup: 0, vdn: 0, byGroup: {} };
        days.set(key, b);
      }
      b.aer += aer;
      b.neu += neu;
      b.vup += vup;
      b.vdn += vdn;
      b.byGroup[group] = (b.byGroup[group] ?? 0) + aer + neu;
    }
  }

  // Contiguous spine from the first activity to TODAY (athlete-local) — NOT just the last activity date.
  // An elapsed day with no activity still decays CTL/ATL, so the model line must continue through rest
  // days to the present instead of freezing at the last session. Mirror of sync.py.
  const allDates = [...days.keys()].sort();
  const lastAct = allDates[allDates.length - 1];
  const today = todayLocal();
  const spine = dateSpine(allDates[0], lastAct > today ? lastAct : today);
  const total = spine.map((d) => (days.get(d)?.aer ?? 0) + (days.get(d)?.neu ?? 0));
  const aerobic = spine.map((d) => days.get(d)?.aer ?? 0);
  const neuro = spine.map((d) => days.get(d)?.neu ?? 0);

  const ctl = ewmaSeries(total, CTL_DAYS);
  const atl = ewmaSeries(total, ATL_DAYS);
  const ctlA = ewmaSeries(aerobic, CTL_DAYS);
  const atlA = ewmaSeries(aerobic, ATL_DAYS);
  const ctlN = ewmaSeries(neuro, CTL_DAYS);
  // Phase 2 (descent trainability): the neuro acute τ is NON-STATIONARY — descent familiarity (same proxy
  // as the cost factor) shortens it when adapted, lengthens it when de-adapted. Built from the daily D-
  // spine (rest days included); inert (base τ) when history is below the gate. Mirror of sync.py.
  const dailyDescent: Record<string, number> = {};
  for (const d of spine) dailyDescent[d] = days.get(d)?.vdn ?? 0;
  const fam = descentFamiliarityRatios(dailyDescent);
  const neuroTau = spine.map((d) => neuroAtlDays * descentRecoveryFactor(fam[d]));
  const atlN = ewmaVariableTau(neuro, neuroTau); // slower acute τ, exposure-modulated — structural fatigue lingers

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
      tsb_aerobic: round(ctlA[i] - atlA[i]),
      ctl_neuromuscular: round(ctlN[i]),
      atl_neuromuscular: round(atlN[i]),
      tsb_neuromuscular: round(ctlN[i] - atlN[i]),
      acwr: ctl[i] > 0 ? round(atl[i] / ctl[i]) : null,
    };
  });

  // Column-scoped upsert (load/model columns only) keyed on local_date — leaves Garmin recovery
  // columns on existing rows untouched. Batched (Python loops per-day; same effect).
  const { error } = await sb.from("daily_metrics").upsert(rows, { onConflict: "local_date" });
  if (error) throw new Error(`rollup upsert failed: ${error.message}`);
  return rows.length;
}
