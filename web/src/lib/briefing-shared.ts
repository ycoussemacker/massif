/** Briefing materializer helpers shared by the on-demand briefing path.
 *
 *  The coach briefing is now built ALGORITHMICALLY (web/src/lib/briefing-algo.ts) and optionally re-voiced
 *  by a small LLM call (coach-briefing.ts) — there is no longer a big LLM SYSTEM prompt or output schema
 *  here (the morning cron that used them is retired). What remains is the pure plan→DB materialization
 *  (buildForwardPlanRows) + small helpers, consumed by coach-briefing.ts. */
import { dateMinusDays } from "./coach-context";

/** French weekday key (lundi…dimanche) for a date — matches athlete_profile.constraints.no_hard_days. */
export function frWeekday(dateISO: string): string {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" })
    .format(new Date(dateISO + "T00:00:00Z"))
    .toLowerCase();
}

/** The day-0 session/sport derived from the briefing (today's detailed session if any, else the plan). */
export function deriveToday(briefing: any): { session: string | null; sport: string | null } {
  const det = (briefing.detailed_sessions ?? []).find((s: any) => s.day_offset === 0) ?? null;
  const plan0 = (briefing.week_plan ?? []).find((d: any) => d.day_offset === 0) ?? null;
  return { session: det?.title ?? plan0?.focus ?? null, sport: plan0?.sport_code ?? null };
}

/** Build the planned_sessions rows for the coach's forward 7-day plan from a briefing. Skips days that
 *  ARE a declared event (anchors_event_ref) OR carry a chat-accepted PINNED session (pinnedDates — fixed
 *  prescriptions the athlete validated), folds in each day's detailed-session targets+bounds + HR band,
 *  and enforces no_hard_days (a hard tag on a forbidden weekday is downgraded to easy). Pure. */
export function buildForwardPlanRows(
  today: string,
  briefing: any,
  sportIdByCode: Map<string, number | null>,
  noHardDays: string[],
  why: string | null,
  pinnedDates: Set<string> = new Set(),
): Record<string, unknown>[] {
  const detailedByOffset = new Map<number, any>((briefing.detailed_sessions ?? []).map((s: any) => [s.day_offset, s]));
  const rows: Record<string, unknown>[] = [];
  for (const d of (briefing.week_plan ?? [])) {
    if (d.anchors_event_ref) continue; // athlete-declared event day — hands off
    const date = dateMinusDays(today, -d.day_offset); // today + offset
    if (pinnedDates.has(date)) continue; // chat-accepted pinned session — fixed, plan around it
    let systemTag: string = d.system_tag;
    if (typeof systemTag === "string" && systemTag.startsWith("hard") && noHardDays.includes(frWeekday(date))) {
      systemTag = "easy";
    }
    const det = detailedByOffset.get(d.day_offset) ?? null;
    rows.push({
      planned_date: date,
      sport_id: sportIdByCode.get(d.sport_code) ?? sportIdByCode.get("unknown") ?? null,
      title: det?.title ?? d.focus,
      description: det?.description ?? null,
      target_load: d.target_load,
      target_aerobic_load: det?.target_aerobic_load ?? null,
      target_neuromuscular_load: det?.target_neuromuscular_load ?? null,
      target_aerobic_min: det?.target_aerobic_min ?? null,
      target_aerobic_max: det?.target_aerobic_max ?? null,
      target_neuromuscular_min: det?.target_neuromuscular_min ?? null,
      target_neuromuscular_max: det?.target_neuromuscular_max ?? null,
      target_duration_s: det ? Math.round((det.target_duration_min || 0) * 60) : null,
      intensity_zone: det?.intensity_zone ?? null,
      target_hr_low: det?.target_hr_low ?? null,
      target_hr_high: det?.target_hr_high ?? null,
      system_tag: systemTag,
      is_key: !!d.is_key,
      week_index: 0,
      status: "planned",
      modified_by: "coach",
      modified_reason: d.day_offset === 0 ? why : d.focus,
    });
  }
  return rows;
}
