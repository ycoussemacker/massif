/** Shared "regenerate the week plan" runner — the rate-limited pipeline behind the on-demand
 *  regeneration (web/src/app/api/coach/regen). Reads the CURRENT DB state and (re)generates today's
 *  briefing + the forward 7-day plan, then posts the LLM-free day verdict. Data freshness (Strava
 *  pull-to-refresh / Garmin button) is a SEPARATE gesture — the briefing is instant, never blocked on a
 *  sync (that's what made it time out on mobile). Run from an API route (plain fetch) so it never blocks
 *  navigation. In 'free' briefing mode this makes ZERO Anthropic calls. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateBriefing, type BriefingResult } from "./coach-briefing";
import { postDayVerdictMessage } from "./day-verdict";
import { linkRealizedSessions } from "./link-sessions";

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

export async function runRegen(sb: SupabaseClient): Promise<{ briefing: BriefingResult }> {
  await enforceRate(sb);
  const briefing = await generateBriefing(sb); // reads current DB — no inline sync
  try { await linkRealizedSessions(sb); } catch { /* non-critical: merge realised↔planned */ }
  try { await postDayVerdictMessage(sb); } catch { /* non-critical side-effect */ }
  return { briefing };
}
