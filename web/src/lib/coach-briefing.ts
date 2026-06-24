/** On-demand briefing generator — server-only. The SAME morning briefing the cron writes, but run
 *  inline from the web app so the athlete can regenerate it on demand (the ⋮ "Régénérer" action).
 *
 *  MIRROR of coach/src/coach.ts (web/ and coach/ are separate pnpm workspaces — no cross-import, same
 *  as load.ts ↔ load.py and coach-context.ts ↔ context.ts). The SYSTEM prompt, schema and the
 *  buildForwardPlanRows materializer live in ./briefing-shared (mirror of coach/src/briefing-shared.ts).
 *  Differences here, by design:
 *   - the chosen coach PERSONA is injected (buildPersonaInstructions), so the briefing speaks in the
 *     same voice as the chat — the cron mirrors this via coach/src/persona.ts;
 *   - NO web push (the athlete is looking at the screen — the push is the cron's morning job). */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleCoachContext, dateMinusDays } from "./coach-context";
import { loadCoachSettings, buildPersonaInstructions } from "./coach-settings";
import { COACH_MODEL } from "./coach-chat";
import { COACH_SYSTEM, COACH_BRIEFING_SCHEMA, buildForwardPlanRows, deriveToday } from "./briefing-shared";

export interface BriefingResult {
  readiness: "green" | "amber" | "red";
  today_session: string | null;
  why: string;
}

/** Regenerate today's briefing from the current DB picture (fresh profile/goals) in the athlete's
 *  chosen coach voice, and persist it (coach_briefings + the coach's forward 7-day planned_sessions,
 *  idempotent). Returns a compact summary for the UI toast. No push (on-demand path). */
export async function generateBriefing(sb: SupabaseClient): Promise<BriefingResult> {
  const [{ today, context }, settings, sportsRes] = await Promise.all([
    assembleCoachContext(sb),
    loadCoachSettings(sb),
    sb.from("sports").select("id,code,is_priority,needs_manual_rpe").order("code"),
  ]);
  const sports = sportsRes.data ?? [];
  const sportIdByCode = new Map<string, number | null>(sports.map((s: any) => [s.code, s.id]));

  const system = COACH_SYSTEM + "\n\n" + buildPersonaInstructions(settings);

  const userPrompt =
    `Allowed sport codes: ${sports.map((s: any) => s.code).join(", ")}.\n` +
    `Priority sports: ${sports.filter((s: any) => s.is_priority).map((s: any) => s.code).join(", ")}.\n` +
    `Sports needing a manual RPE (no reliable HR): ` +
    `${sports.filter((s: any) => s.needs_manual_rpe).map((s: any) => s.code).join(", ")}.\n\n` +
    `Athlete picture (JSON):\n${JSON.stringify(context, null, 1)}\n\n` +
    `Produce today's briefing for ${today}.`;

  const client = new Anthropic();
  const resp = await client.messages.create({
    model: COACH_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: COACH_BRIEFING_SCHEMA } },
    system,
    messages: [{ role: "user", content: userPrompt }],
  } as any);

  if ((resp as any).stop_reason === "refusal") {
    throw new Error("La génération du briefing a été refusée par les classifieurs de sécurité.");
  }
  const textBlock = (resp.content as any[]).find((b: any) => b.type === "text") as any;
  if (!textBlock) throw new Error("Réponse du coach vide (aucun bloc texte).");
  const briefing = JSON.parse(textBlock.text);

  // Materialize the coach's forward 7-day plan (skips declared-event days, enforces no_hard_days).
  // SAFE delete scoped to the coach's own still-planned, not-yet-linked rows in [today, today+6]
  // (mirror of coach/src/db.ts replaceForwardCoachPlan).
  const noHardDays = (((context as any).athlete_constraints?.no_hard_days) as string[] | null) ?? [];
  // Days [today, today+6] carrying a chat-accepted pinned session — the materializer SKIPS them so a
  // regen never overwrites or duplicates a session the athlete validated. Derived from the context.
  const pinnedDates = new Set<string>(
    (((context as any).pinned_sessions ?? []) as any[])
      .filter((p) => p.day_offset >= 0 && p.day_offset <= 6)
      .map((p) => p.date as string),
  );
  const rows = buildForwardPlanRows(today, briefing, sportIdByCode, noHardDays, briefing.why, pinnedDates);
  const horizonEnd = dateMinusDays(today, -6);
  const del = await sb.from("planned_sessions").delete()
    .gte("planned_date", today).lte("planned_date", horizonEnd)
    .eq("modified_by", "coach").eq("status", "planned").is("linked_activity_id", null);
  if (del.error) throw new Error(del.error.message);
  let materializedIds: string[] = [];
  if (rows.length) {
    const ins = await sb.from("planned_sessions").insert(rows).select("id");
    if (ins.error) throw new Error(ins.error.message);
    materializedIds = (ins.data ?? []).map((r: any) => r.id);
  }

  const { session: todaySession, sport: todaySportCode } = deriveToday(briefing);

  const briefingIns = await sb.from("coach_briefings").insert({
    briefing_date: today,
    model: COACH_MODEL,
    readiness: briefing.readiness,
    today_session: todaySession,
    why: briefing.why,
    changed: null,
    week_skeleton: briefing.week_plan, // richer week_plan stored in the existing week_skeleton column
    flag: briefing.flag,
    reasoning: briefing.state_assessment,
    input_snapshot: context,
    actions: {
      materialized_planned_ids: materializedIds,
      detailed_sessions: briefing.detailed_sessions,
      event_targets: briefing.event_targets,
      today: { sport_code: todaySportCode, session: todaySession },
    },
    confidence: briefing.confidence,
    raw_response: textBlock.text,
  }).select("id").single();
  if (briefingIns.error) throw new Error(briefingIns.error.message);

  return {
    readiness: briefing.readiness,
    today_session: todaySession,
    why: briefing.why,
  };
}
