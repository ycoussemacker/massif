/** "Entraînement à la descente dans le temps" for the Profil page — the trailing-28d D− (descent volume)
 *  series, the same FAMILIARITY proxy the descent model uses (Upgrade 7). Above the athlete's own median
 *  = well adapted (the model discounts the eccentric descent cost + recovers faster); below = reprise
 *  (descents cost more, more DOMS). Server-side read; the median is the model's f=1.0 anchor (p50 of the
 *  trailing-28d D− over descent-active days, full history) so the chart matches what drives the load. */
import { createServiceClient } from "./supabase/server";
import { DESCENT_FAMILIARITY_WINDOW_D, DESCENT_FAMILIARITY_MIN_SAMPLES } from "./load";

export type DescentTrainingPoint = { date: string; m: number };
export type DescentState = "adapted" | "typical" | "deconditioned" | "insufficient";
export type DescentTraining = {
  points: DescentTrainingPoint[]; // trailing-28d D- (m) per day, last ~12 months
  medianM: number; //               the model's f=1.0 anchor (typical 28-day descent volume)
  currentM: number | null; //       latest trailing-28d D-
  state: DescentState;
  windowDays: number;
};

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function getDescentTraining(): Promise<DescentTraining> {
  const sb = await createServiceClient();
  // Full daily D- spine (paginated past the 1000-row cap). daily_metrics is contiguous + ascending, and
  // vertical_loss_m is the rollup's (multi-day-spread) D- — the same basis the model's familiarity uses.
  const rows: { local_date: string; vertical_loss_m: number | null }[] = [];
  for (let page = 0; ; page++) {
    const { data } = await sb
      .from("daily_metrics")
      .select("local_date,vertical_loss_m")
      .order("local_date", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    const chunk = (data ?? []) as typeof rows;
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  const empty: DescentTraining = { points: [], medianM: 0, currentM: null, state: "insufficient", windowDays: DESCENT_FAMILIARITY_WINDOW_D };
  if (!rows.length) return empty;

  // Sliding trailing-WINDOW sum (the days BEFORE each date — prior exposure, like the model).
  const dminus = rows.map((r) => Number(r.vertical_loss_m || 0));
  const trailing = dminus.map((_, i) => {
    let s = 0;
    for (let j = Math.max(0, i - DESCENT_FAMILIARITY_WINDOW_D); j < i; j++) s += dminus[j];
    return s;
  });

  // Anchor = p50 of the trailing sum over descent-active days (vdn > 0) — the model's f=1.0 reference.
  const active = trailing.filter((_, i) => dminus[i] > 0);
  if (active.length < DESCENT_FAMILIARITY_MIN_SAMPLES) return empty; // not enough descent history yet
  const medianM = median(active);

  // Return the FULL trailing series (the chart scrolls through it, newest-first), trimming only the dead
  // lead-in before the athlete's first descent (where the trailing window is still empty).
  let start = 0;
  while (start < trailing.length && trailing[start] <= 0) start++;
  const points = rows.slice(start).map((r, k) => ({ date: r.local_date, m: trailing[start + k] }));
  const currentM = trailing[trailing.length - 1];
  const state: DescentState =
    medianM <= 0 ? "typical"
    : currentM >= medianM * 1.15 ? "adapted"
    : currentM <= medianM * 0.7 ? "deconditioned"
    : "typical";

  return { points, medianM, currentM, state, windowDays: DESCENT_FAMILIARITY_WINDOW_D };
}
