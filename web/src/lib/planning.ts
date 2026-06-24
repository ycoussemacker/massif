/** Build the coach's planning view of upcoming planned_sessions: the athlete's DECLARED EVENTS (each with
 *  its persisted load estimate + the CTL/ATL/TSB projected the day before it) and the coach's PRIOR PLAN.
 *  Pure (date helpers passed in so it imports no DB). MIRROR of coach/src/planning.ts — keep in sync. */
import { projectFromMetrics, type DayLoad, type SeedMetric } from "./project";

/** Rough channel split of a total target_load by system_tag, when explicit channel targets are absent. */
const NEURO_FRAC_BY_TAG: Record<string, number> = {
  hard_aerobic: 0.15,
  hard_neuromuscular: 0.6,
  hard_structural: 0.7,
  easy: 0.2,
  recovery: 0.2,
  rest: 0.2,
};
function splitByTag(total: number, tag: string | null): { aerobic: number; neuro: number } {
  const nf = (tag ? NEURO_FRAC_BY_TAG[tag] : undefined) ?? 0.25;
  return { aerobic: total * (1 - nf), neuro: total * nf };
}

/** Future daily loads from the upcoming plan — a declared event OVERRIDES the coach plan on its day.
 *  Shared by the coach context, the dashboard projection and the calendar goal forecast. */
export function buildPlannedLoads(upcoming: any[]): DayLoad[] {
  const coachByDate = new Map<string, DayLoad>();
  const eventByDate = new Map<string, DayLoad>();
  for (const r of upcoming) {
    const date = r.planned_date as string;
    if (r.is_event) {
      let aer = r.predicted_aerobic_load ?? r.target_aerobic_load;
      let neu = r.predicted_neuromuscular_load ?? r.target_neuromuscular_load;
      if (aer == null && neu == null && r.target_load != null) {
        const s = splitByTag(Number(r.target_load), r.system_tag); aer = s.aerobic; neu = s.neuro;
      }
      const cur = eventByDate.get(date) ?? { date, aerobic: 0, neuro: 0 };
      eventByDate.set(date, { date, aerobic: cur.aerobic + (Number(aer) || 0), neuro: cur.neuro + (Number(neu) || 0) });
    } else {
      let a = r.target_aerobic_load;
      let n = r.target_neuromuscular_load;
      if (a == null && n == null && r.target_load != null) {
        const s = splitByTag(Number(r.target_load), r.system_tag); a = s.aerobic; n = s.neuro;
      }
      const cur = coachByDate.get(date) ?? { date, aerobic: 0, neuro: 0 };
      coachByDate.set(date, { date, aerobic: cur.aerobic + (Number(a) || 0), neuro: cur.neuro + (Number(n) || 0) });
    }
  }
  const merged = new Map<string, DayLoad>(coachByDate);
  for (const [date, dl] of eventByDate) merged.set(date, dl);
  return [...merged.values()];
}

export type PlanningView = { declared_events: any[]; coach_prior_plan: any[]; pinned_sessions: any[] };

export function buildPlanningView(opts: {
  today: string;
  daysBetween: (from: string, to: string) => number;
  dateMinusDays: (iso: string, days: number) => string;
  dm: SeedMetric[]; // chronological daily metrics (for the projection seed)
  upcoming: any[]; // planned_sessions rows with planned_date >= today
  codeById: Map<number, string>;
  neuroAtlDays?: number;
}): PlanningView {
  const { today, daysBetween, dateMinusDays, dm, upcoming, codeById, neuroAtlDays } = opts;

  // Future daily loads — a declared event OVERRIDES the coach plan on the same day.
  const plannedLoads = buildPlannedLoads(upcoming);

  const offsets = upcoming.map((r) => daysBetween(today, r.planned_date as string));
  const horizon = Math.min(60, Math.max(14, 0, ...offsets));
  const projected = projectFromMetrics(dm, plannedLoads, { today, horizonDays: horizon, neuroAtlDays });
  const projByDate = new Map(projected.map((p) => [p.local_date, p]));

  const forecastFor = (eventDate: string) => {
    const eve = dateMinusDays(eventDate, 1);
    const p = projByDate.get(eve);
    if (!p) return null;
    return { date: p.local_date, ctl: p.ctl, atl: p.atl, tsb: p.tsb, tsb_aerobic: p.tsb_aerobic, tsb_neuromuscular: p.tsb_neuromuscular };
  };

  const declared_events = upcoming
    .filter((r) => r.is_event)
    .map((r) => ({
      ref: r.id,
      date: r.planned_date,
      day_offset: daysBetween(today, r.planned_date as string),
      sport: r.sport_id != null ? (codeById.get(r.sport_id) ?? null) : null,
      title: r.title,
      is_key: !!r.is_key,
      distance_m: r.target_distance_m ?? null,
      vertical_m: r.target_vertical_m ?? null,
      expected_altitude_m: r.expected_altitude_m ?? null, // hypoxia context: expect higher HR if under-acclimated
      duration_min: r.target_duration_s ? Math.round(Number(r.target_duration_s) / 60) : null,
      estimated_load: {
        aerobic: r.predicted_aerobic_load ?? r.target_aerobic_load ?? null,
        neuro: r.predicted_neuromuscular_load ?? r.target_neuromuscular_load ?? null,
        basis: r.prediction_basis ?? null,
      },
      forecast: forecastFor(r.planned_date as string),
    }));

  const coach_prior_plan = upcoming
    .filter((r) => !r.is_event && r.modified_by === "coach")
    .map((r) => ({
      ref: r.id,
      date: r.planned_date,
      day_offset: daysBetween(today, r.planned_date as string),
      system_tag: r.system_tag ?? null,
      target_load: r.target_load ?? null,
    }));

  // PINNED sessions = coach prescriptions the athlete accepted via chat (is_pinned, modified_by='user').
  // FIXED anchors the coach plans AROUND — like a declared event, but a prescription (target_*). The
  // briefing must never overwrite their day (see buildForwardPlanRows pinnedDates + COACH_SYSTEM).
  const pinned_sessions = upcoming
    .filter((r) => r.is_pinned && !r.is_event)
    .map((r) => ({
      ref: r.id,
      date: r.planned_date,
      day_offset: daysBetween(today, r.planned_date as string),
      sport: r.sport_id != null ? (codeById.get(r.sport_id) ?? null) : null,
      title: r.title,
      system_tag: r.system_tag ?? null,
      target_load: r.target_load ?? null,
      is_key: !!r.is_key,
    }));

  return { declared_events, coach_prior_plan, pinned_sessions };
}

/** Favourite sports by recent frequency (most-frequent first), excluding unknown/null. */
export function favouriteSports(acts: { sport_id: number }[], codeById: Map<number, string>): string[] {
  const count = new Map<string, number>();
  for (const a of acts) {
    const c = codeById.get(a.sport_id);
    if (!c || c === "unknown") continue;
    count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c);
}

/** Compact athlete constraints for the coach (injury/weakness notes, no-hard days, weekly cap). */
export function athleteConstraints(profile: any): Record<string, unknown> | null {
  const c = profile?.constraints;
  if (!c) return null;
  return {
    max_weekly_hours: c.max_weekly_hours ?? null,
    no_hard_days: c.no_hard_days ?? null,
    notes: c.notes ?? null,
  };
}
