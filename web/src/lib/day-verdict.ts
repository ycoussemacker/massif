/** Day-verdict assembly — bridges the pure logic (day-progress) + copy (coach-voice) to the data layer.
 *  Two consumers:
 *    · the dashboard (page.tsx) calls `assembleVerdict` with data it already has → renders in CoachHero;
 *    · the on-demand sync (actions.syncNow / generateBriefingNow) calls `postDayVerdictMessage` →
 *      upserts ONE coach message per day into the conversation (so multiple syncs don't spam it).
 *  Both share `assembleVerdict`, so the dashboard text and the conversation text never drift. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayLocal } from "./coach-context";
import { avgLoadRecent, isoMinusDays } from "./format";
import { sportName } from "./labels";
import {
  computeDayProgress, rankedFavorites, todaySportCodes, dominantTodaySportCode,
  type DayProgress,
} from "./day-progress";
import { buildVerdictVoice, type VerdictVoice } from "./coach-voice";

type ActLite = { local_date: string; sport_code: string | null; training_load: number | null };

/** Pure: turn the day's facts into the coach-voice verdict (headline + conversation copy). */
export function assembleVerdict(input: {
  hasPlan: boolean;
  target: number | null;
  isRest: boolean;
  activities: ActLite[];
  avgLoad: number | null;
  today: string;
}): { progress: DayProgress | null; voice: VerdictVoice | null } {
  const { hasPlan, target, isRest, activities, avgLoad, today } = input;
  const actual = activities
    .filter((a) => a.local_date === today)
    .reduce((s, a) => s + (a.training_load ?? 0), 0);

  const progress = computeDayProgress({
    hasPlan, target, isRest, actual, avgLoad,
    todaySports: todaySportCodes(activities, today),
    favorites: rankedFavorites(activities),
  });
  if (!progress) return { progress: null, voice: null };

  const todaySportCode = dominantTodaySportCode(activities, today);
  const voice = buildVerdictVoice(
    progress,
    {
      todaySport: todaySportCode ? sportName(todaySportCode, todaySportCode) : null,
      suggSport: progress.suggestion?.sportCode ? sportName(progress.suggestion.sportCode, progress.suggestion.sportCode) : null,
    },
    today,
  );
  return { progress, voice };
}

/** Marker used to find/replace today's auto verdict in the conversation (model is free text, no DB
 *  constraint). Scoped to the day so a new day appends a fresh message and history is preserved. */
const verdictMarker = (today: string) => `auto:verdict:${today}`;

/** Upsert today's verdict into the coach conversation — best-effort, called from the sync paths.
 *  Posts only once a real session exists today (actual > 0) and never for "rest kept" (an ongoing
 *  non-event), so the morning's empty/rest state doesn't create chatter. One message per day, updated
 *  in place across syncs (so it stays where it first landed and never duplicates). */
export async function postDayVerdictMessage(sb: SupabaseClient): Promise<void> {
  const today = todayLocal();
  const from = isoMinusDays(today, 14); // window for the avgLoad reference (typical session)

  const [plannedRes, actsRes, sportsRes] = await Promise.all([
    sb.from("planned_sessions").select("target_load,system_tag")
      .eq("planned_date", today).eq("modified_by", "coach").eq("status", "planned"),
    sb.from("activities").select("local_date,sport_id,training_load")
      .gte("local_date", from).order("started_at", { ascending: true }),
    sb.from("sports").select("id,code"),
  ]);

  const codeById = new Map<number, string>((sportsRes.data ?? []).map((s: any) => [s.id, s.code]));
  const activities: ActLite[] = (actsRes.data ?? []).map((a: any) => ({
    local_date: a.local_date, sport_code: codeById.get(a.sport_id) ?? null, training_load: a.training_load,
  }));

  const planned = (plannedRes.data ?? []) as { target_load: number | null; system_tag: string | null }[];
  const hasPlan = planned.length > 0;
  const target = hasPlan ? planned.reduce((s, r) => s + (r.target_load ?? 0), 0) : null;
  const isRest = planned.some((r) => r.system_tag === "rest");
  const avgLoad = avgLoadRecent(activities, today, 15);

  const { progress, voice } = assembleVerdict({ hasPlan, target, isRest, activities, avgLoad, today });
  if (!progress || !voice) return;
  if (progress.actual <= 0 || progress.status === "rest_kept") return; // nothing logged yet / ongoing rest

  const marker = verdictMarker(today);
  const upd = await sb.from("coach_messages").update({ content: voice.chatText }).eq("model", marker).select("id");
  if (!upd.error && (upd.data?.length ?? 0) === 0) {
    await sb.from("coach_messages").insert({ role: "coach", kind: "chat", content: voice.chatText, model: marker });
  }
}
