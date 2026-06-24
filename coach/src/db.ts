/** Config + Supabase access for the coach (service-role; reads the model picture, writes briefings). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../.env") }); // repo-root .env (shared with ingest)

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const COACH_MODEL = process.env.COACH_MODEL ?? "claude-sonnet-4-6";
export const ATHLETE_TZ = process.env.ATHLETE_TZ ?? "Europe/Paris";

export const db: SupabaseClient = createClient(
  need("NEXT_PUBLIC_SUPABASE_URL"),
  need("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

/** Calendar date (YYYY-MM-DD) in the athlete's timezone. */
export function todayLocal(tz = ATHLETE_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** Current local time HH:MM (24h) + weekday in the athlete's timezone — so the coach reasons with the
 *  HOUR, not just the date (don't advise "run before 8am" at 15h30). Mirror of web coach-context.ts nowLocal. */
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

// ── reads ───────────────────────────────────────────────────────────────────

export async function loadProfile(): Promise<any> {
  const { data, error } = await db.from("athlete_profile").select("*").limit(1);
  if (error) throw error;
  return data?.[0] ?? {};
}

/** Active goals, most important first. The athlete orders them by priority_rank in the Profil UI. */
export async function loadGoals(): Promise<any[]> {
  const { data, error } = await db
    .from("goals")
    .select("title,sport_id,kind,priority_rank,target_date,target_horizon,target_detail,notes,status")
    .eq("status", "active")
    .order("priority_rank", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function loadSports(): Promise<any[]> {
  const { data, error } = await db
    .from("sports")
    .select("id,code,display_name,taxonomy_group,needs_manual_rpe,is_priority")
    .order("code");
  if (error) throw error;
  return data ?? [];
}

export async function loadDailyMetrics(days: number): Promise<any[]> {
  const { data, error } = await db
    .from("daily_metrics").select("*")
    .order("local_date", { ascending: false }).limit(days);
  if (error) throw error;
  return (data ?? []).reverse(); // chronological
}

export async function loadRecentActivities(sinceDate: string): Promise<any[]> {
  const { data, error } = await db
    .from("activities")
    .select("local_date,sport_id,training_load,aerobic_load,neuromuscular_load," +
            "load_method_used,duration_s,vertical_gain_m,vertical_loss_m,avg_hr,rpe_source," +
            "avg_temp_c,max_altitude_m,time_high_altitude_s")
    .gte("local_date", sinceDate)
    .order("local_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function loadUpcomingPlanned(fromDate: string): Promise<any[]> {
  const { data, error } = await db
    .from("planned_sessions").select("*")
    .gte("planned_date", fromDate).neq("status", "skipped").order("planned_date");
  if (error) throw error;
  return data ?? [];
}

/** Daily weather forecast from `fromDate` onward (today..+7). Lenient: returns [] on error / missing
 *  table (pre-migration) so the coach simply gets no `weather` rather than failing the run. */
export async function loadWeather(fromDate: string): Promise<any[]> {
  const { data, error } = await db
    .from("daily_weather")
    .select("local_date,temp_min_c,temp_max_c,feels_max_c,precip_mm,wind_kmh")
    .gte("local_date", fromDate).order("local_date", { ascending: true });
  if (error) return [];
  return data ?? [];
}

/** Personalized neuromuscular acute τ (athlete_load_params.neuro_atl_days) or null → projection default. */
export async function loadNeuroAtlDays(): Promise<number | null> {
  const { data } = await db.from("athlete_load_params").select("value").eq("param", "neuro_atl_days").maybeSingle();
  const v = Number((data as any)?.value);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// ── writes ──────────────────────────────────────────────────────────────────

/** True if a briefing already exists for `date`. Used by the cloud cron (COACH_SKIP_IF_DONE) to be
 * idempotent: a second scheduled attempt the same morning is a no-op (no duplicate push). */
export async function briefingExists(date: string): Promise<boolean> {
  const { data, error } = await db
    .from("coach_briefings")
    .select("id")
    .eq("briefing_date", date)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function saveBriefing(row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.from("coach_briefings").insert(row).select("id").single();
  if (error) throw error;
  return (data as any).id;
}

/** Idempotent per day: drop today's still-planned coach sessions, then insert the new one. */
export async function replaceTodayPlanned(date: string, row: Record<string, unknown>): Promise<string> {
  const del = await db.from("planned_sessions").delete()
    .eq("planned_date", date).eq("modified_by", "coach").eq("status", "planned");
  if (del.error) throw del.error;
  const { data, error } = await db.from("planned_sessions").insert(row).select("id").single();
  if (error) throw error;
  return (data as any).id;
}

/** Materialize the coach's full forward plan (today..today+6). Idempotent + SAFE: the delete is scoped
 *  to the coach's OWN still-planned, not-yet-done rows in the window, so athlete-declared events
 *  (modified_by='user'), completed/modified rows, and rows already linked to an activity are never
 *  touched. Returns the inserted ids. Mirror of the inline version in web/src/lib/coach-briefing.ts. */
export async function replaceForwardCoachPlan(
  today: string,
  rows: Record<string, unknown>[],
): Promise<string[]> {
  const horizonEnd = dateMinusDays(today, -6); // today + 6
  const del = await db.from("planned_sessions").delete()
    .gte("planned_date", today).lte("planned_date", horizonEnd)
    .eq("modified_by", "coach").eq("status", "planned").is("linked_activity_id", null);
  if (del.error) throw del.error;
  if (!rows.length) return [];
  const { data, error } = await db.from("planned_sessions").insert(rows).select("id");
  if (error) throw error;
  return (data ?? []).map((r: any) => r.id);
}
