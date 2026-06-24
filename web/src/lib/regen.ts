/** Shared "regenerate the week plan" runner — the paid, rate-limited pipeline behind the background
 *  regeneration (web/src/app/api/coach/regen). Pulls fresh Strava + recomputes the model, then
 *  regenerates today's briefing + the forward 7-day plan, and posts the LLM-free day verdict.
 *  Run from an API route (plain fetch) rather than a Server Action so it never blocks navigation. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncStrava } from "./strava-sync";
import { rollupDailyMetrics } from "./rollup";
import { generateBriefing, type BriefingResult } from "./coach-briefing";
import { postDayVerdictMessage } from "./day-verdict";

/** Cost/abuse guard (shared DB state, works on serverless): 2/min burst, 20/day on coach_briefings. */
async function enforceRate(sb: SupabaseClient): Promise<void> {
  const now = Date.now();
  const since1m = new Date(now - 60_000).toISOString();
  const since1d = new Date(now - 86_400_000).toISOString();
  const [burst, daily] = await Promise.all([
    sb.from("coach_briefings").select("id", { count: "exact", head: true }).gte("created_at", since1m),
    sb.from("coach_briefings").select("id", { count: "exact", head: true }).gte("created_at", since1d),
  ]);
  if ((burst.count ?? 0) >= 2) throw new Error("Le plan vient d'être régénéré — attends un instant.");
  if ((daily.count ?? 0) >= 20) throw new Error("Limite quotidienne de régénérations atteinte (20/jour).");
}

export async function runRegen(sb: SupabaseClient): Promise<{ pulled: number; briefing: BriefingResult }> {
  await enforceRate(sb);
  const { pulled } = await syncStrava(sb);
  await rollupDailyMetrics(sb);
  const briefing = await generateBriefing(sb);
  try { await postDayVerdictMessage(sb); } catch { /* non-critical side-effect */ }
  return { pulled, briefing };
}
