/** The ONE unified training picture, assembled server-side for the coach chat.
 *  Mirrors coach/src/context.ts (web/ and coach/ are separate pnpm workspaces — no cross-import,
 *  same as load.ts ↔ load.py). Keep the shape in sync so the chat reasons like the briefing run. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPlanningView, favouriteSports, athleteConstraints } from "./planning";
import { computeSessionBaselines } from "./session-baselines";
import { descentModelConfidence } from "./load";

export const ATHLETE_TZ = process.env.ATHLETE_TZ ?? "Europe/Paris";

/** Calendar date (YYYY-MM-DD) in the athlete's timezone. */
export function todayLocal(tz = ATHLETE_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** Current local time HH:MM (24h) + weekday in the athlete's timezone — so the coach reasons with the
 *  HOUR, not just the date (don't advise "run before 8am" at 15h30). Mirror of coach/src/db.ts nowLocal. */
export function nowLocal(tz = ATHLETE_TZ): { time: string; weekday: string } {
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const weekday = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long" }).format(new Date());
  return { time, weekday };
}

export function daysBetween(fromISO: string, toISO: string): number {
  const ms = Date.parse(toISO + "T00:00:00Z") - Date.parse(fromISO + "T00:00:00Z");
  return Math.round(ms / 86_400_000);
}

export function dateMinusDays(iso: string, days: number): string {
  const t = Date.parse(iso + "T00:00:00Z") - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** French phrasing for "commente mon activité ___" relative to `today`: d'aujourd'hui / d'hier / du 19 juin.
 *  Shared by the timeline (optimistic chat bubble) and the server action so the wording matches exactly. */
export function whenLabelFr(localDate: string, today: string): string {
  if (localDate === today) return "d'aujourd'hui";
  if (localDate === dateMinusDays(today, 1)) return "d'hier";
  const d = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(localDate + "T00:00:00Z"));
  return `du ${d}`;
}

/** The athlete's REAL heart-rate training zones (bpm) — so the coach prescribes a "Z2" that matches the
 *  watch. `source` is 'garmin' (the watch's own config) or 'computed' (a %HRR fallback from thresholds).
 *  Null when none are set yet. Mirror of coach/src/context.ts hrZones. */
function hrZones(profile: any): Record<string, unknown> | null {
  const z = profile?.hr_zones;
  if (!z || !Array.isArray(z.zones) || z.zones.length === 0) return null;
  return {
    source: z.source ?? null,
    zones: z.zones.map((zz: any) => ({ zone: zz.name, low_bpm: zz.low_bpm, high_bpm: zz.high_bpm })),
  };
}

/** Garmin recovery metrics we surface, with FR labels (used to name what's missing). */
const RECOVERY_METRICS: [string, string][] = [
  ["sleep_score", "sommeil"],
  ["hrv_overnight_ms", "VFC (HRV)"],
  ["resting_hr", "FC de repos"],
  ["body_battery_high", "Body Battery"],
  ["training_readiness", "readiness"],
];

/** TODAY's Garmin recovery ONLY — deliberately NO fallback to an earlier day. Recovery (sleep / HRV /
 *  Body Battery / readiness) is a same-morning signal: citing a stale day's numbers as if they were
 *  this morning's misleads the coach (that bug had the chat quote a days-old Body Battery 5/100 while
 *  the briefing correctly said "recovery absent"). When today's data isn't synced yet, `available` is
 *  false and `missing` names the absent metrics so the coach can say "il me manque telle donnée"
 *  instead of guessing. Recovery for today is stored under local_date == today (last night's sleep;
 *  see ingest/garmin.py). Always returns an object (never null) carrying the freshness signal. */
function recoveryToday(dm: any[], today: string): Record<string, unknown> {
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
 *  HR/recovery, never a load input (docs/research/heat-altitude.md). Mirror of context.ts environment. */
function environment(acts7: any[], dm: any[]): Record<string, unknown> {
  const temps = acts7.map((a) => a.avg_temp_c).filter((v) => v != null) as number[];
  const alts = acts7.map((a) => a.max_altitude_m).filter((v) => v != null) as number[];
  const timeHighS = acts7.reduce((t, a) => t + Number(a.time_high_altitude_s || 0), 0);
  // Acclimation is a slow status (days–weeks) Garmin doesn't write every day → carry forward the last
  // known value across the window, with its date, rather than reading today's (usually empty) row.
  let heat: number | null = null, alt: number | null = null, asOf: string | null = null;
  for (let i = dm.length - 1; i >= 0; i--) {
    if (dm[i].heat_acclimation_pct != null || dm[i].altitude_acclimation_m != null) {
      heat = dm[i].heat_acclimation_pct ?? null;
      alt = dm[i].altitude_acclimation_m ?? null;
      asOf = dm[i].local_date;
      break;
    }
  }
  return {
    heat_acclimation_pct: heat,
    altitude_acclimation_m: alt,
    acclimation_as_of: asOf, // date of the carried-forward acclimation (may be earlier than today)
    hot_sessions_7d: temps.filter((t) => t >= 22).length, // sessions at/above Garmin's ~22 °C heat threshold
    hottest_temp_c_7d: temps.length ? Math.max(...temps) : null,
    max_altitude_m_7d: alts.length ? Math.max(...alts) : null,
    time_high_altitude_min_7d: Math.round(timeHighS / 60), // minutes above ~1500 m
  };
}

/** Upcoming forecast the coach reads heat/acclimation advice against — today..+7, each day flagged `hot`
 *  (apparent "feels-like" ≥ 25 °C, else dry max ≥ 25). CONTEXT, never a load input. Mirror of
 *  context.ts weatherView. */
function weatherView(rows: any[]): any[] {
  return (rows ?? []).map((r) => {
    const feels = r.feels_max_c ?? r.temp_max_c;
    return {
      date: r.local_date,
      temp_max_c: r.temp_max_c, temp_min_c: r.temp_min_c, feels_max_c: r.feels_max_c,
      precip_mm: r.precip_mm, wind_kmh: r.wind_kmh,
      hot: feels != null && feels >= 25,
    };
  });
}

/** Today's coach briefing (the latest if it was regenerated), compact — so the chat stays consistent
 *  with the morning call instead of silently re-deriving a different one. Null when none yet today. */
export async function loadTodayBriefing(
  sb: SupabaseClient,
  today: string = todayLocal(),
): Promise<Record<string, unknown> | null> {
  const { data } = await sb.from("coach_briefings")
    .select("readiness,today_session,why,reasoning,flag,week_skeleton,confidence,created_at")
    .eq("briefing_date", today)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!data) return null;
  return {
    readiness: data.readiness,
    today_session: data.today_session,
    why: data.why,
    state_assessment: data.reasoning,
    flag: data.flag,
    week_skeleton: data.week_skeleton,
    confidence: data.confidence,
  };
}

/** Bornes du plan lu pour le contexte coach (mirror : coach/src/db.ts loadUpcomingPlanned). Sous les
 *  1000 lignes de PostgREST, qui tronquerait sinon en silence. */
const PLAN_HORIZON_DAYS = 400;
const PLAN_ROWS = 200;

/** Read profile + 21d of daily metrics + 14d of activities + upcoming plan → one compact picture.
 *  Same object as coach/src/context.ts so the chat persona has the briefing run's exact view. */
export async function assembleCoachContext(sb: SupabaseClient): Promise<{ today: string; context: Record<string, unknown> }> {
  const today = todayLocal();
  const since14 = dateMinusDays(today, 14);

  const [pm, mm, am, sm, plm, gm, npm, wm, bm, twm] = await Promise.all([
    sb.from("athlete_profile").select("*").limit(1).maybeSingle(),
    sb.from("daily_metrics").select("*").order("local_date", { ascending: false }).limit(21),
    sb.from("activities")
      .select("local_date,sport_id,training_load,aerobic_load,neuromuscular_load,load_method_used," +
              "duration_s,vertical_gain_m,vertical_loss_m,avg_hr,rpe_source,rpe_cardio,rpe_legs,rpe_grip," +
              "avg_temp_c,max_altitude_m,time_high_altitude_s")
      .gte("local_date", since14).order("local_date", { ascending: false }),
    sb.from("sports").select("id,code"),
    // Plan à venir : borné + plafonné. Ici l'ordre ASCENDANT est le bon : si la limite mord, elle
    // écarte le futur le plus LOINTAIN, pas les jours qui viennent. L'horizon reste large (400 j) pour
    // qu'un objectif daté à un an — une course déclarée — reste dans le contexte du coach.
    sb.from("planned_sessions").select("*")
      .gte("planned_date", today).lte("planned_date", dateMinusDays(today, -PLAN_HORIZON_DAYS))
      .neq("status", "skipped")
      .order("planned_date", { ascending: true }).limit(PLAN_ROWS),
    sb.from("goals")
      .select("title,sport_id,kind,priority_rank,target_date,target_horizon,target_detail,notes,status")
      .eq("status", "active").order("priority_rank", { ascending: true }),
    sb.from("athlete_load_params").select("value").eq("param", "neuro_atl_days").maybeSingle(),
    sb.from("daily_weather").select("local_date,temp_min_c,temp_max_c,feels_max_c,precip_mm,wind_kmh")
      .gte("local_date", today).order("local_date", { ascending: true }),
    // ~90 d of realised loads → the athlete's PERSONAL per-session-type baselines (replaces the
    // hard-coded coach target loads; falls back to them when a bucket is thin). See session-baselines.ts.
    // local_date+vertical_loss_m also feed the descent-model reliability alert (descentModelConfidence).
    sb.from("activities").select("training_load,aerobic_load,neuromuscular_load,intensity_factor,local_date,vertical_loss_m")
      .gte("local_date", dateMinusDays(today, 90)).order("local_date", { ascending: false }).limit(400),
    // Fenêtres de contrainte (Upgrade 10) : actives, à venir, et terminées depuis ≤ 7 j (la grâce
    // post-décharge du moteur en a besoin). Tolérant à la table absente pré-migration (→ []).
    sb.from("training_windows").select("id,starts_on,ends_on,label,effect,no_mountains,limited_hills,reduced_volume,notes")
      .gte("ends_on", dateMinusDays(today, 7)).order("starts_on", { ascending: true }).limit(20),
  ]);

  const profile: any = pm.data ?? {};
  const dm: any[] = (mm.data ?? []).slice().reverse(); // chronological
  const acts: any[] = am.data ?? [];
  const upcoming: any[] = plm.data ?? [];
  const codeById = new Map<number, string>((sm.data ?? []).map((s: any) => [s.id, s.code]));
  const neuroAtlDays = Number((npm.data as any)?.value) || undefined;
  const weatherRows = (wm.data ?? []) as any[]; // upcoming forecast (today..+7); [] if table absent
  // Declared events (with persisted estimate + projected J-1 form), the coach's prior plan, and any
  // chat-accepted PINNED sessions (fixed anchors the coach plans around).
  const { declared_events, coach_prior_plan, pinned_sessions } = buildPlanningView({
    today, daysBetween, dateMinusDays, dm, upcoming, codeById, neuroAtlDays,
  });

  // Ranked objectives (most important first), mirroring coach/src/context.ts mapGoals.
  const mappedGoals = (gm.data ?? []).map((g: any) => ({
    title: g.title,
    sport: g.sport_id != null ? (codeById.get(g.sport_id) ?? null) : null,
    kind: g.kind ?? null,
    rank: g.priority_rank,
    detail: g.target_detail ?? null,
    date: g.target_date ?? null,
    days_to: g.target_date ? daysBetween(today, g.target_date) : null,
    horizon: g.target_horizon ?? null,
  }));

  // The last calendar row is often a Garmin recovery-only upsert (no rollup past the last activity),
  // so its CTL/ATL/TSB are null — use the most recent row that actually has the computed model.
  let latest: any = null;
  for (let i = dm.length - 1; i >= 0; i--) {
    if (dm[i].ctl != null) { latest = dm[i]; break; }
  }
  const since7 = dateMinusDays(today, 7);
  const acts7 = acts.filter((a) => a.local_date >= since7);
  const sum = (xs: any[], k: string) => Math.round(xs.reduce((t, a) => t + Number(a[k] || 0), 0) * 10) / 10;

  const nowL = nowLocal();
  const context = {
    today,
    // Current LOCAL time (HH:MM) + weekday — reason with the HOUR of day, not only the date: never advise a
    // slot already passed ("ce matin avant 8h" à 15h30), adapt to the hours left or push to another day.
    now_local: `${nowL.weekday} ${nowL.time}`,
    athlete_tz: ATHLETE_TZ,
    // Ranked objectives (most important first); each may be sport-linked, dated (days_to) and/or have
    // a fuzzy horizon ("avant mes 30 ans"). Mirrors coach/src/context.ts.
    goals: mappedGoals,
    primary_goal: mappedGoals[0] ?? null,
    thresholds: {
      max_hr: profile.max_hr, resting_hr: profile.resting_hr, lthr: profile.lthr, weight_kg: profile.weight_kg,
    },
    // The athlete's REAL HR zones (bpm) — translate an aerobic target into a concrete band the watch shows.
    hr_zones: hrZones(profile),
    // Personalised per-session-type target loads, derived from ~90 d of the athlete's own efforts (the
    // briefing uses these over the hard-coded BASE_LOAD when a bucket has enough samples).
    session_baselines: computeSessionBaselines((bm.data ?? []) as any[]),
    // Reliability of the descent-trainability adjustment (Upgrade 7): 'off'/'low'/'ok' by descent-history
    // depth. When 'low', tell the athlete the descent cost is adjusted to recent exposure but the estimate
    // is still firming up — don't present it as fact. (90 d window proxy of the all-history gate.)
    descent_model: descentModelConfidence(
      Object.fromEntries(
        ((bm.data ?? []) as any[]).reduce((m: Map<string, number>, r: any) => {
          if (r.local_date) m.set(r.local_date, (m.get(r.local_date) ?? 0) + Number(r.vertical_loss_m || 0));
          return m;
        }, new Map<string, number>()),
      ),
    ),
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
    environment: environment(acts7, dm),
    // Upcoming forecast (today..+7) — the heat the coach reads acclimation against for PROSPECTIVE advice
    // (a `hot` day + low heat_acclimation ⇒ expect HR drift / higher RPE; advise timing/hydration/pacing).
    weather: weatherView(weatherRows),
    daily_load_21d: dm.map((d) => ({
      date: d.local_date, load: d.daily_load, aerobic: d.daily_aerobic_load, neuro: d.daily_neuromuscular_load,
      by_group: d.load_by_group, dplus: d.vertical_gain_m, dminus: d.vertical_loss_m,
    })),
    recent_activities_14d: acts.map((a) => ({
      date: a.local_date, sport: codeById.get(a.sport_id) ?? "unknown",
      load: a.training_load, aerobic: a.aerobic_load, neuro: a.neuromuscular_load,
      method: a.load_method_used, dur_min: Math.round((a.duration_s || 0) / 60),
      dplus: a.vertical_gain_m, dminus: a.vertical_loss_m, avg_hr: a.avg_hr, rpe: a.rpe_source,
      // Differential RPE (Phase 2): present only when the athlete rated systems separately — the aero/neuro
      // split was then perception-derived (souffle → aérobie, jambes/avant-bras → neuro).
      rpe_diff: (a.rpe_cardio != null || a.rpe_legs != null || a.rpe_grip != null)
        ? { cardio: a.rpe_cardio ?? null, legs: a.rpe_legs ?? null, grip: a.rpe_grip ?? null } : undefined,
      temp_c: a.avg_temp_c ?? null, alt_max_m: a.max_altitude_m ?? null,
    })),
    trailing_7d: { d_plus_m: sum(acts7, "vertical_gain_m"), d_minus_m: sum(acts7, "vertical_loss_m") },
    // Favourite sports (recent frequency) — prefer these when filling the 7-day plan.
    favourite_sports: favouriteSports(acts, codeById),
    // Limits + injury/weakness memory the coach plans around (no_hard_days, weekly cap, free-text notes).
    athlete_constraints: athleteConstraints(profile),
    // Activities the athlete DECLARED for the week (coach plans around them, never overwrites). Each
    // carries its persisted load estimate + the CTL/ATL/TSB projected the day before it under the plan.
    declared_events,
    // What the coach previously planned forward (so it can stay coherent / reshape, not contradict).
    coach_prior_plan,
    // Sessions the athlete ACCEPTED from a coach proposal in chat — FIXED prescriptions: plan around them,
    // never overwrite them (set anchors_event_ref to their ref on their day, like a declared event).
    pinned_sessions,
    // Fenêtres de contrainte déclarées (déplacement, terrain plat, temps réduit…) — le plan reporte les
    // décharges dessus, charge le D+ avant une fenêtre sans montagne et adapte les séances pendant.
    training_windows: ((twm.data ?? []) as any[]).map((w) => ({
      starts_on: w.starts_on, ends_on: w.ends_on, label: w.label, effect: w.effect ?? "auto",
      no_mountains: !!w.no_mountains, limited_hills: !!w.limited_hills, reduced_volume: !!w.reduced_volume,
      notes: w.notes ?? null,
      days_to_start: daysBetween(today, w.starts_on), days_to_end: daysBetween(today, w.ends_on),
    })),
  };

  return { today, context };
}
