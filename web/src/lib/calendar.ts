/** Calendar data — per-day buckets for the Calendrier grid (realised activities, planned sessions/events,
 *  goal dates, readiness). Bounded to the visible range (≤ ~1 month) → well under the PostgREST row cap. */
import { createServiceClient } from "./supabase/server";
import { listActivities, getSports } from "./activities";
import { groupByDateSpanned } from "./aggregate";
import { todayLocal } from "./coach-context";

export type CalDone = { id: string; sportCode: string | null; load: number };
export type CalPlanned = {
  id: string;
  sportCode: string | null;
  title: string;
  isKey: boolean;
  isEvent: boolean; // athlete-declared (vs coach-planned)
  isPinned: boolean; // coach session the athlete accepted via chat (a fixed prescription)
  systemTag: string | null;
};
export type CalGoal = { id: string; title: string; sportCode: string | null };

/** Forecast for a future/today day (never the past). Drives the calendar's sober weather glyph. */
export type CalWeather = {
  tempMaxC: number | null;
  tempMinC: number | null;
  feelsMaxC: number | null;
  precipMm: number | null;
  windKmh: number | null;
  weatherCode: number | null;
};

export type CalDay = {
  date: string;
  done: CalDone[];
  planned: CalPlanned[];
  goals: CalGoal[];
  tsb: number | null;
  ctl: number | null;
  weather: CalWeather | null;
};

export type CalendarData = { days: CalDay[] };

/** Read all calendar inputs for [from, to] (inclusive). Returns only days that carry something. */
export async function getCalendar(from: string, to: string): Promise<CalendarData> {
  const sb = await createServiceClient();
  const sports = await getSports();
  const codeById = new Map<number, string>(sports.map((s) => [s.id, s.code]));
  const today = todayLocal();
  // Planned sessions are FUTURE intent — only show them from today onward (a "planned" session in the past
  // is stale/meaningless; the past shows what was actually realised instead). The weather forecast is the
  // same: future/today only — a past day shows what was realised, not a stale forecast.
  const planFrom = from > today ? from : today;

  const [mm, planRes, goalRes, actPage, wxRes] = await Promise.all([
    sb.from("daily_metrics").select("local_date,tsb,ctl").gte("local_date", from).lte("local_date", to),
    sb.from("planned_sessions")
      .select("id,planned_date,sport_id,title,is_key,is_event,is_pinned,system_tag,modified_by,status,linked_activity_id")
      .gte("planned_date", planFrom).lte("planned_date", to).neq("status", "skipped"),
    sb.from("goals").select("id,title,sport_id,target_date").eq("status", "active")
      .gte("target_date", from).lte("target_date", to),
    listActivities({ from, to, order: "date_asc", limit: 1000 }),
    // Forecast only covers today..+9 and we never want a forecast glyph on past cells, so bound to [planFrom, to].
    planFrom <= to
      ? sb.from("daily_weather").select("local_date,temp_max_c,temp_min_c,feels_max_c,precip_mm,wind_kmh,weather_code")
          .gte("local_date", planFrom).lte("local_date", to)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const byDate = new Map<string, CalDay>();
  const day = (d: string): CalDay => {
    let c = byDate.get(d);
    if (!c) { c = { date: d, done: [], planned: [], goals: [], tsb: null, ctl: null, weather: null }; byDate.set(d, c); }
    return c;
  };

  // Realised activities — spread multi-day expeditions across the days they span (matches the rollup).
  for (const [date, acts] of groupByDateSpanned(actPage.rows)) {
    if (date < from || date > to) continue;
    const c = day(date);
    for (const a of acts) c.done.push({ id: a.id, sportCode: a.sport_code, load: a.training_load ?? 0 });
  }

  for (const p of (planRes.data ?? []) as any[]) {
    if (p.linked_activity_id) continue; // completed by a realised activity → shown under `done`, not as a dangling "prévu"
    const c = day(p.planned_date);
    c.planned.push({
      id: p.id,
      sportCode: p.sport_id != null ? (codeById.get(p.sport_id) ?? null) : null,
      title: p.title,
      isKey: !!p.is_key,
      isEvent: !!p.is_event,
      isPinned: !!p.is_pinned,
      systemTag: p.system_tag ?? null,
    });
  }

  for (const g of (goalRes.data ?? []) as any[]) {
    if (!g.target_date) continue;
    const c = day(g.target_date);
    c.goals.push({ id: g.id, title: g.title, sportCode: g.sport_id != null ? (codeById.get(g.sport_id) ?? null) : null });
  }

  for (const m of (mm.data ?? []) as any[]) {
    const c = byDate.get(m.local_date);
    if (c) { c.tsb = m.tsb; c.ctl = m.ctl; }
    else if (m.tsb != null || m.ctl != null) { const d = day(m.local_date); d.tsb = m.tsb; d.ctl = m.ctl; }
  }

  // Forecast (today/future only — bounded to [planFrom, to] above).
  for (const w of (wxRes.data ?? []) as any[]) {
    if (w.local_date < today) continue; // belt-and-braces: never a forecast on a past cell
    const c = day(w.local_date);
    c.weather = {
      tempMaxC: w.temp_max_c, tempMinC: w.temp_min_c, feelsMaxC: w.feels_max_c,
      precipMm: w.precip_mm, windKmh: w.wind_kmh, weatherCode: w.weather_code,
    };
  }

  return { days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}
