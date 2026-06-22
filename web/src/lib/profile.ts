/** Profile-page data access — server-side reads via the service-role client (RLS off, local-first).
 *  Mirrors the shape of lib/data.ts. Pure types/helpers live in lib/profile-types.ts (client-safe);
 *  this module is server-only because it imports the Supabase server client (next/headers). */
import { createServiceClient } from "./supabase/server";
import { sportName } from "./labels";
import type { Goal, SportOption, ProfilePageData, AthleteProfile } from "./profile-types";

// Re-export types only (erased at compile — safe). Import the pure VALUE helpers (ageFrom, freshness,
// daysTo, pickTopGoal) directly from "@/lib/profile-types" so client bundles never pull this server module.
export type { AthleteProfile, Goal, SportOption, ConnectionStatus, ProfilePageData, GoalHeader } from "./profile-types";

/** One round-trip-batched read for the whole /profil page (mirrors getDashboard in lib/data.ts). */
export async function getProfilePageData(): Promise<ProfilePageData> {
  const sb = await createServiceClient();
  const [pm, gm, sm, stravaActM, stravaTokM, garminRecM] = await Promise.all([
    sb.from("athlete_profile").select("*").limit(1).maybeSingle(),
    sb.from("goals")
      .select("id,sport_id,title,kind,priority_rank,target_date,target_horizon,target_detail,notes,status")
      .order("status", { ascending: true }) // 'achieved' < 'active' alpha, so re-sort below
      .order("priority_rank", { ascending: true }),
    sb.from("sports").select("id,code,display_name").order("display_name"),
    sb.from("activities").select("started_at").eq("source", "strava")
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("integration_tokens").select("athlete_id,expires_at").eq("provider", "strava").maybeSingle(),
    sb.from("daily_metrics")
      .select("local_date,hrv_overnight_ms,sleep_score,training_readiness,resting_hr")
      .order("local_date", { ascending: false }).limit(60),
  ]);

  const sports: SportOption[] = (sm.data ?? []).map((s: any) => ({
    id: s.id, code: s.code, name: sportName(s.code, s.display_name),
  }));
  const sportById = new Map<number, SportOption>(sports.map((s) => [s.id, s]));

  const goals: Goal[] = (gm.data ?? []).map((g: any) => {
    const s = g.sport_id != null ? sportById.get(g.sport_id) : undefined;
    return {
      ...g,
      sport_code: s?.code ?? null,
      sport_name: s?.name ?? null,
    };
  });
  // active first, then by priority_rank (the DB order put 'achieved' before 'active' alphabetically).
  goals.sort((a, b) =>
    (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) ||
    a.priority_rank - b.priority_rank);

  // Garmin "last recovery": most recent day that actually carries recovery data.
  let lastRecovery: string | null = null;
  for (const d of garminRecM.data ?? []) {
    if (d.hrv_overnight_ms != null || d.sleep_score != null || d.training_readiness != null) {
      lastRecovery = d.local_date;
      break; // rows are newest-first
    }
  }

  return {
    profile: (pm.data as AthleteProfile) ?? null,
    goals,
    sports,
    connections: {
      strava: {
        connected: !!stravaTokM.data,
        athleteId: (stravaTokM.data as any)?.athlete_id ?? null,
        expiresAt: (stravaTokM.data as any)?.expires_at ?? null,
        lastActivity: (stravaActM.data as any)?.started_at ?? null,
      },
      garmin: { lastRecovery },
    },
  };
}
