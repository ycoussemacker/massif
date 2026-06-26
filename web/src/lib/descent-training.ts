/** "Entraînement à la descente" data — a descent CTL/ATL: the FAST 28-day D− exposure (the model's
 *  familiarity signal) vs a SLOW adaptation baseline (same unit, 28-day-equivalent over ~12 weeks). When
 *  the fast curve runs ABOVE the slow one the athlete is building descent capacity; below = detraining.
 *  The slow line is the evolving reference that replaces the old fixed median. Built from the contiguous
 *  daily D− spine (daily_metrics.vertical_loss_m), so both curves are gap-free. */
import { createServiceClient } from "./supabase/server";

const WINDOW_FAST = 28; // exposure window (= the model's familiarity window)
const WINDOW_SLOW = 84; // adaptation horizon (~12 weeks)
const MIN_DAYS = 8; // need a few descent days before the curves mean anything

export type DescentPoint = { date: string; fast: number; slow: number }; // both in "metres of D− per 28 d"
export type DescentTraining = {
  points: DescentPoint[];
  currentFast: number;
  currentSlow: number;
  state: "building" | "maintaining" | "detraining" | null;
  windowDays: number;
  insufficient: boolean;
};

export async function getDescentTraining(): Promise<DescentTraining> {
  const sb = await createServiceClient();
  // Full daily D− spine (paginated past the 1000-row cap), ascending + contiguous (the rollup writes a
  // zero-filled spine), so trailing sums have no gaps. vertical_loss_m is the rollup's per-day D−.
  const rows: { local_date: string; vertical_loss_m: number | null }[] = [];
  for (let page = 0; ; page++) {
    const { data } = await sb
      .from("daily_metrics").select("local_date,vertical_loss_m")
      .order("local_date", { ascending: true }).range(page * 1000, page * 1000 + 999);
    const chunk = (data ?? []) as typeof rows;
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  const empty: DescentTraining = { points: [], currentFast: 0, currentSlow: 0, state: null, windowDays: WINDOW_FAST, insufficient: true };
  if (rows.length < 2) return empty;

  const d = rows.map((r) => Number(r.vertical_loss_m || 0));
  if (d.filter((x) => x > 0).length < MIN_DAYS) return empty;

  // Prefix sums → O(n) trailing windows.
  const pre = [0];
  for (let i = 0; i < d.length; i++) pre[i + 1] = pre[i] + d[i];
  const fast = (i: number) => pre[i + 1] - pre[Math.max(0, i - (WINDOW_FAST - 1))];
  const slow = (i: number) => {
    const days = Math.min(WINDOW_SLOW, i + 1);
    return ((pre[i + 1] - pre[Math.max(0, i - (WINDOW_SLOW - 1))]) / days) * WINDOW_FAST; // 28-day-equivalent
  };

  // Trim the dead lead-in before the first descent (fast == 0 until then).
  let start = 0;
  while (start < d.length && fast(start) <= 0) start++;
  const points: DescentPoint[] = [];
  for (let i = start; i < rows.length; i++) {
    points.push({ date: rows[i].local_date, fast: Math.round(fast(i)), slow: Math.round(slow(i)) });
  }
  if (points.length < 2) return empty;

  const cur = points[points.length - 1];
  const state: DescentTraining["state"] =
    cur.slow <= 0 ? "maintaining"
    : cur.fast > cur.slow * 1.1 ? "building"
    : cur.fast < cur.slow * 0.9 ? "detraining"
    : "maintaining";

  return { points, currentFast: cur.fast, currentSlow: cur.slow, state, windowDays: WINDOW_FAST, insufficient: false };
}
