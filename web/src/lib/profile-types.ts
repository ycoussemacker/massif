/** Profile types + pure helpers — client-safe (NO server-only imports like next/headers).
 *  Server-side reads live in lib/profile.ts; keep this module free of the Supabase server client so
 *  client components ("use client") can import these without pulling next/headers into their bundle. */

export type AthleteProfile = {
  id: number;
  name: string | null;
  birthdate: string | null;        // ISO date; age is derived for display
  sex: "M" | "F" | "other" | null;
  height_cm: number | null;
  weight_kg: number | null;
  // physiological baselines (manually entered overrides — nothing re-syncs these today)
  max_hr: number | null;
  resting_hr: number | null;
  lthr: number | null;
  hrv_baseline_ms: number | null;
  hr_zones: HrZones;               // the athlete's real HR training zones (bpm) — Garmin's, or computed
  // training preferences (jsonb)
  weekly_structure: Record<string, unknown> | null;
  constraints: Record<string, unknown> | null;
  timezone: string | null;
};

/** One HR training zone (bpm band) + the whole set as stored in athlete_profile.hr_zones. `source`:
 *  'garmin' = read from the watch (matches it exactly); 'computed' = %HRR/%maxHR fallback from thresholds. */
export type HrZone = { n: number; name: string; low_bpm: number; high_bpm: number };
export type HrZones = {
  source: "garmin" | "computed" | string | null;
  model: string | null;
  updated_at: string | null;
  zones: HrZone[];
} | null;

export type Goal = {
  id: string;
  sport_id: number | null;
  sport_code: string | null;
  sport_name: string | null;       // FR display name (null = general goal)
  title: string;
  kind: string | null;
  priority_rank: number;           // smaller = more important
  target_date: string | null;      // structured deadline (drives days-to math)
  target_horizon: string | null;   // fuzzy deadline ("cette année", "avant mes 30 ans")
  target_detail: string | null;
  notes: string | null;
  status: "active" | "achieved" | "abandoned";
};

export type SportOption = { id: number; code: string; name: string };

export type ConnectionStatus = {
  strava: {
    connected: boolean;            // a token row exists in integration_tokens
    athleteId: string | null;
    expiresAt: string | null;
    lastActivity: string | null;   // most recent strava activity started_at (ISO)
  };
  garmin: {
    lastRecovery: string | null;   // most recent daily_metrics row with recovery data (local_date)
  };
};

export type ProfilePageData = {
  profile: AthleteProfile | null;
  goals: Goal[];                   // ALL goals, ordered active-first then priority_rank
  sports: SportOption[];           // for the goal sport dropdown
  connections: ConnectionStatus;
};

/** Compact goal for page headers (dashboard + coach). */
export type GoalHeader = {
  title: string;
  sport_code: string | null;
  target_date: string | null;
  target_horizon: string | null;
  target_detail: string | null;
};

/** Map raw goal rows + a sport-id→code map to the single top-priority active goal for headers. */
export function pickTopGoal(
  rows: any[] | null | undefined,
  sportCodeById: Map<number, string>,
): GoalHeader | null {
  const g = (rows ?? [])[0];
  if (!g) return null;
  return {
    title: g.title,
    sport_code: g.sport_id != null ? (sportCodeById.get(g.sport_id) ?? null) : null,
    target_date: g.target_date ?? null,
    target_horizon: g.target_horizon ?? null,
    target_detail: g.target_detail ?? null,
  };
}

/** Whole days from now (UTC midnight) to an ISO date; null if no date. */
export function daysTo(dateISO: string | null | undefined): number | null {
  if (!dateISO) return null;
  const ms = Date.parse(dateISO + "T00:00:00Z") - Date.now();
  return Number.isNaN(ms) ? null : Math.ceil(ms / 86_400_000);
}

/** Age in whole years from an ISO birthdate, or null. */
export function ageFrom(birthdate: string | null | undefined): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate + "T00:00:00Z");
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}

/** Freshness bucket for a date (ISO date or datetime): green <2d, amber <7d, red older/never. */
export function freshness(dateISO: string | null | undefined): "ok" | "stale" | "old" {
  if (!dateISO) return "old";
  const t = Date.parse(dateISO.length === 10 ? dateISO + "T00:00:00Z" : dateISO);
  if (Number.isNaN(t)) return "old";
  const days = (Date.now() - t) / 86_400_000;
  return days < 2 ? "ok" : days < 7 ? "stale" : "old";
}
