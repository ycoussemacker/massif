/** Auto-link a realised activity to the planned session it fulfils.
 *
 *  When the athlete logs an activity of the SAME sport, on the SAME day as a planned session (a coach
 *  session, a chat-accepted pinned one, or a declared event), that session should "complete" — point to
 *  the realised activity (linked_activity_id) instead of lingering as a separate "prévu". The /seance page
 *  then shows the realised metrics + verdict under the plan, and the calendar stops listing it as pending.
 *
 *  Idempotent + conservative: only fills NULL links, matches strictly on (date, sport_id), assigns at most
 *  one activity per session and one session per activity (the highest-load activity wins when several match).
 *  Leaves status='planned' (the LLM-free day verdict still reads planned rows; the briefing regen's delete
 *  already skips linked rows, so a completed session is never wiped). Returns the count newly linked. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayLocal } from "./coach-context";
import { isoMinusDays } from "./format";

export async function linkRealizedSessions(sb: SupabaseClient): Promise<number> {
  const today = todayLocal();
  const from = isoMinusDays(today, 3); // recent window — link freshly-logged activities

  const [actsRes, planRes] = await Promise.all([
    sb.from("activities").select("id,local_date,sport_id,training_load")
      .gte("local_date", from).lte("local_date", today),
    sb.from("planned_sessions").select("id,planned_date,sport_id,order_in_day")
      .gte("planned_date", from).lte("planned_date", today)
      .eq("status", "planned").is("linked_activity_id", null),
  ]);
  const acts = (actsRes.data ?? []) as any[];
  const plans = (planRes.data ?? []) as any[];
  if (!plans.length || !acts.length) return 0;

  const used = new Set<string>();
  let linked = 0;
  // Stable order (date, then order_in_day) so the first session of a day claims its best match first.
  plans.sort((a, b) => String(a.planned_date).localeCompare(b.planned_date) || (a.order_in_day ?? 1) - (b.order_in_day ?? 1));
  for (const p of plans) {
    if (p.sport_id == null) continue;
    const match = acts
      .filter((a) => a.local_date === p.planned_date && a.sport_id === p.sport_id && !used.has(a.id))
      .sort((x, y) => (Number(y.training_load) || 0) - (Number(x.training_load) || 0))[0];
    if (!match) continue;
    const upd = await sb.from("planned_sessions").update({ linked_activity_id: match.id })
      .eq("id", p.id).is("linked_activity_id", null);
    if (!upd.error) { used.add(match.id); linked++; }
  }
  return linked;
}
