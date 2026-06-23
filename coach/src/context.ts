/** Assemble the ONE unified training picture from the DB — shared by the briefing run and Q&A. */
import {
  ATHLETE_TZ, todayLocal, daysBetween, dateMinusDays,
  loadProfile, loadSports, loadDailyMetrics, loadRecentActivities, loadUpcomingPlanned, loadGoals,
} from "./db.js";

/** Map raw goal rows → the coach's compact, ranked goal view (sport code + days-to / fuzzy horizon). */
export function mapGoals(goals: any[], codeById: Map<number, string>, today: string) {
  return (goals ?? []).map((g) => ({
    title: g.title,
    sport: g.sport_id != null ? (codeById.get(g.sport_id) ?? null) : null,
    kind: g.kind ?? null,
    rank: g.priority_rank,
    detail: g.target_detail ?? null,
    date: g.target_date ?? null,
    days_to: g.target_date ? daysBetween(today, g.target_date) : null,
    horizon: g.target_horizon ?? null,
  }));
}

/** Garmin recovery metrics we surface, with FR labels (used to name what's missing). */
const RECOVERY_METRICS: [string, string][] = [
  ["sleep_score", "sommeil"],
  ["hrv_overnight_ms", "VFC (HRV)"],
  ["resting_hr", "FC de repos"],
  ["body_battery_high", "Body Battery"],
  ["training_readiness", "readiness"],
];

/** TODAY's Garmin recovery ONLY — deliberately NO fallback to an earlier day (mirror of
 *  web/src/lib/coach-context.ts recoveryToday). Recovery is a same-morning signal; quoting a stale
 *  day's numbers as if current misleads the coach. When today isn't synced, `available` is false and
 *  `missing` names the absent metrics so the coach can say what it lacks instead of guessing. Today's
 *  recovery is stored under local_date == today (last night's sleep; see ingest/garmin.py).
 *  Always returns an object (never null) carrying the freshness signal. */
export function recoveryToday(dm: any[], today: string): Record<string, unknown> {
  const row = dm.find((d) => d.local_date === today) ?? null;
  const val = (k: string) => (row && row[k] != null ? row[k] : null);
  const missing = RECOVERY_METRICS.filter(([k]) => val(k) == null).map(([, label]) => label);
  return {
    date: today,
    available: missing.length < RECOVERY_METRICS.length, // false = no Garmin recovery synced for today yet
    missing, // metrics absent for today (FR labels) — name them if a call depends on them
    sleep_score: val("sleep_score"),
    sleep_duration_h: row && row.sleep_duration_s != null ? Math.round((row.sleep_duration_s / 3600) * 10) / 10 : null,
    hrv_overnight_ms: val("hrv_overnight_ms"),
    hrv_status: val("hrv_status"),
    resting_hr: val("resting_hr"),
    body_battery_high: val("body_battery_high"),
    body_battery_low: val("body_battery_low"),
    stress_avg: val("stress_avg"),
    training_readiness: val("training_readiness"),
    // Garmin/Firstbeat acclimation — context for HOW to read an elevated HR / depressed recovery, not a
    // recovery score itself (see docs/research/heat-altitude.md). Null when not synced today.
    heat_acclimation_pct: val("heat_acclimation_pct"),
    altitude_acclimation_m: val("altitude_acclimation_m"),
  };
}

/** Heat & altitude EXPOSURE over the last 7 days + today's acclimation — context the coach uses to read
 *  HR/recovery, never a load input (docs/research/heat-altitude.md). Mirror of coach-context.ts environment. */
function environment(acts7: any[], todayRow: any): Record<string, unknown> {
  const temps = acts7.map((a) => a.avg_temp_c).filter((v) => v != null) as number[];
  const alts = acts7.map((a) => a.max_altitude_m).filter((v) => v != null) as number[];
  const timeHighS = acts7.reduce((t, a) => t + Number(a.time_high_altitude_s || 0), 0);
  return {
    heat_acclimation_pct: todayRow?.heat_acclimation_pct ?? null,
    altitude_acclimation_m: todayRow?.altitude_acclimation_m ?? null,
    hot_sessions_7d: temps.filter((t) => t >= 22).length, // sessions at/above Garmin's ~22 °C heat threshold
    hottest_temp_c_7d: temps.length ? Math.max(...temps) : null,
    max_altitude_m_7d: alts.length ? Math.max(...alts) : null,
    time_high_altitude_min_7d: Math.round(timeHighS / 60), // minutes above ~1500 m
  };
}

export interface Picture {
  today: string;
  sports: any[];
  context: Record<string, unknown>;
}

/** Read profile + 21d of daily metrics + 14d of activities + upcoming plan → one compact picture. */
export async function assemblePicture(): Promise<Picture> {
  const today = todayLocal();
  const [profile, sports, dm, goals] = await Promise.all([
    loadProfile(), loadSports(), loadDailyMetrics(21), loadGoals(),
  ]);
  const acts = await loadRecentActivities(dateMinusDays(today, 14));
  const upcoming = await loadUpcomingPlanned(today);

  const codeById = new Map<number, string>(sports.map((s) => [s.id, s.code]));
  const mappedGoals = mapGoals(goals, codeById, today);
  // The last calendar row is often a Garmin recovery-only upsert (no rollup past the last activity),
  // so its CTL/ATL/TSB are null — use the most recent row that actually has the computed model.
  let latest: any = null;
  for (let i = dm.length - 1; i >= 0; i--) {
    if (dm[i].ctl != null) { latest = dm[i]; break; }
  }
  const since7 = dateMinusDays(today, 7);
  const acts7 = acts.filter((a) => a.local_date >= since7);
  const sum = (xs: any[], k: string) => Math.round(xs.reduce((t, a) => t + Number(a[k] || 0), 0) * 10) / 10;

  const context = {
    today,
    athlete_tz: ATHLETE_TZ,
    // Ranked objectives (most important first). Each may be sport-linked and may have a structured
    // date (days_to) and/or a fuzzy horizon (e.g. "avant mes 30 ans"); some have neither.
    goals: mappedGoals,
    primary_goal: mappedGoals[0] ?? null,
    thresholds: {
      max_hr: profile.max_hr, resting_hr: profile.resting_hr, lthr: profile.lthr, weight_kg: profile.weight_kg,
    },
    fitness_model_latest: latest && {
      date: latest.local_date, ctl: latest.ctl, atl: latest.atl, tsb: latest.tsb,
      ctl_aerobic: latest.ctl_aerobic, atl_aerobic: latest.atl_aerobic, tsb_aerobic: latest.tsb_aerobic,
      ctl_neuromuscular: latest.ctl_neuromuscular, atl_neuromuscular: latest.atl_neuromuscular,
      // Neuromuscular form uses a slower (~14d) acute τ: structural/tendon fatigue lingers weeks and is
      // invisible to HRV. A clearly negative tsb_neuromuscular = carry structural fatigue even if aerobic
      // freshness (tsb_aerobic) and Garmin recovery look fine.
      tsb_neuromuscular: latest.tsb_neuromuscular,
      acwr: latest.acwr,
    },
    recovery_today: recoveryToday(dm, today),
    // Heat/altitude EXPOSURE + acclimation — read HR & recovery through this lens; never a load input.
    environment: environment(acts7, dm.find((d) => d.local_date === today) ?? null),
    daily_load_21d: dm.map((d) => ({
      date: d.local_date, load: d.daily_load, aerobic: d.daily_aerobic_load, neuro: d.daily_neuromuscular_load,
      by_group: d.load_by_group, dplus: d.vertical_gain_m, dminus: d.vertical_loss_m,
    })),
    recent_activities_14d: acts.map((a) => ({
      date: a.local_date, sport: codeById.get(a.sport_id) ?? "unknown",
      load: a.training_load, aerobic: a.aerobic_load, neuro: a.neuromuscular_load,
      method: a.load_method_used, dur_min: Math.round((a.duration_s || 0) / 60),
      dplus: a.vertical_gain_m, dminus: a.vertical_loss_m, avg_hr: a.avg_hr, rpe: a.rpe_source,
      temp_c: a.avg_temp_c ?? null, alt_max_m: a.max_altitude_m ?? null,
    })),
    trailing_7d: { d_plus_m: sum(acts7, "vertical_gain_m"), d_minus_m: sum(acts7, "vertical_loss_m") },
    upcoming_planned: upcoming,
  };

  return { today, sports, context };
}
