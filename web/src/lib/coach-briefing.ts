/** On-demand briefing generator — server-only. Builds the daily briefing from the CURRENT DB state
 *  (no inline sync — the athlete refreshes Strava/Garmin separately), in one of two modes set in the
 *  Profil (coach_settings.briefing_mode):
 *   - 'free' : 100 % algorithmic (buildAlgorithmicBriefing) — ZERO LLM tokens.
 *   - 'ai'   : same algorithmic plan, then ONE small, cached LLM call re-voices three text fields
 *              (today's description + state_assessment + why) in the athlete's coach persona.
 *  Either way it writes the SAME shape (coach_briefings + planned_sessions via buildForwardPlanRows), so
 *  the dashboard and /seance pages are unchanged. The conversational chat (coach-chat.ts) is a SEPARATE,
 *  always-available AI feature and is not touched here. */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleCoachContext, dateMinusDays } from "./coach-context";
import { loadCoachSettings, buildPersonaInstructions, type CoachSettings } from "./coach-settings";
import { COACH_MODEL } from "./coach-chat";
import { buildForwardPlanRows, deriveToday } from "./briefing-shared";
import { buildAlgorithmicBriefing, type AlgoBriefing } from "./briefing-algo";

export interface BriefingResult {
  readiness: "green" | "amber" | "red";
  today_session: string | null;
  why: string;
  mode: "free" | "ai";
}

/** Generate today's briefing from the current DB picture and persist it (coach_briefings + the forward
 *  7-day planned_sessions, idempotent). Returns a compact summary for the UI. No push, no sync. */
export async function generateBriefing(sb: SupabaseClient): Promise<BriefingResult> {
  const [{ today, context }, settings, sportsRes] = await Promise.all([
    assembleCoachContext(sb),
    loadCoachSettings(sb),
    sb.from("sports").select("id,code,is_priority,needs_manual_rpe").order("code"),
  ]);
  const sports = sportsRes.data ?? [];
  const sportIdByCode = new Map<string, number | null>(sports.map((s: any) => [s.code, s.id]));

  // 1) Algorithmic core (0 token) — always.
  const briefing = buildAlgorithmicBriefing(context);

  // 2) Optional AI re-voicing (paid mode) — rewrites only 3 text fields in the persona voice.
  if (settings.briefing_mode === "ai") {
    try {
      await enrichBriefingWithLLM(briefing, settings);
    } catch (e) {
      // Never let the LLM layer break the briefing — fall back to the algorithmic text.
      console.error("briefing AI enrich failed, using algorithmic text:", (e as Error)?.message ?? e);
    }
  }

  // 3) Materialize the forward 7-day plan (skips declared-event days + chat-accepted pinned sessions).
  const noHardDays = (((context as any).athlete_constraints?.no_hard_days) as string[] | null) ?? [];
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
    model: settings.briefing_mode === "ai" ? COACH_MODEL : "algo",
    readiness: briefing.readiness,
    today_session: todaySession,
    why: briefing.why,
    changed: null,
    week_skeleton: briefing.week_plan,
    flag: briefing.flag,
    reasoning: briefing.state_assessment,
    input_snapshot: context,
    actions: {
      mode: settings.briefing_mode,
      materialized_planned_ids: materializedIds,
      detailed_sessions: briefing.detailed_sessions,
      event_targets: briefing.event_targets,
      today: { sport_code: todaySportCode, session: todaySession },
    },
    confidence: briefing.confidence,
    raw_response: JSON.stringify(briefing),
  }).select("id").single();
  if (briefingIns.error) throw new Error(briefingIns.error.message);

  return {
    readiness: briefing.readiness,
    today_session: todaySession,
    why: briefing.why,
    mode: settings.briefing_mode,
  };
}

// ── AI re-voicing layer (paid mode only) — small, cached, no thinking ───────────────────────────
const ENRICH_SYSTEM = `Tu es le coach Massif. Un briefing du jour a DÉJÀ été calculé (séance, charges, zones FC, état de forme).
Ta SEULE tâche : RÉÉCRIRE trois textes courts dans TA voix, en FRANÇAIS — sans changer aucun chiffre, zone FC,
durée ni la nature de la séance ; reprends fidèlement les valeurs fournies (bpm, charges).
- today_description : 2-3 phrases — comment mener la séance du jour + une intention/un conseil concret.
- state_assessment : 2-3 phrases — l'état de forme + le cap de la semaine (une TENDANCE, pas une liste de chiffres).
- why : UNE seule phrase — la raison n°1 de la séance d'aujourd'hui.
N'invente aucune donnée. Réponds uniquement avec le JSON demandé.`;

const ENRICH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    today_description: { type: "string" },
    state_assessment: { type: "string" },
    why: { type: "string" },
  },
  required: ["today_description", "state_assessment", "why"],
};

/** Mutate the briefing's three text fields in place with persona-voiced versions. Small + cached + no
 *  thinking → ~cheap. The numbers/zones/plan are decided algorithmically and are NOT sent for change. */
async function enrichBriefingWithLLM(briefing: AlgoBriefing, settings: CoachSettings): Promise<void> {
  const today0 = briefing.detailed_sessions.find((d) => d.day_offset === 0) ?? briefing.detailed_sessions[0] ?? null;
  const plan0 = briefing.week_plan[0];
  const facts = {
    readiness: briefing.readiness,
    today: {
      title: today0?.title ?? plan0?.focus,
      system_tag: plan0?.system_tag,
      sport: plan0?.sport_code,
      zone: today0?.intensity_zone ?? null,
      hr_low: today0?.target_hr_low ?? null,
      hr_high: today0?.target_hr_high ?? null,
      duration_min: today0?.target_duration_min ?? null,
      aerobic_load: today0?.target_aerobic_load ?? null,
      neuro_load: today0?.target_neuromuscular_load ?? null,
    },
    week: briefing.week_plan.map((d) => ({ off: d.day_offset, tag: d.system_tag, sport: d.sport_code, load: d.target_load, is_key: d.is_key })),
    flag: briefing.flag,
    // The algorithmic drafts — keep the substance, rewrite the voice.
    draft: { today_description: today0?.description ?? "", state_assessment: briefing.state_assessment, why: briefing.why },
  };

  const client = new Anthropic();
  const resp: any = await client.messages.create({
    model: COACH_MODEL,
    max_tokens: 1500,
    output_config: { format: { type: "json_schema", schema: ENRICH_SCHEMA } },
    system: [{ type: "text", text: ENRICH_SYSTEM + "\n\n" + buildPersonaInstructions(settings), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Faits du jour (JSON) — réécris uniquement les 3 textes de "draft" dans ta voix :\n${JSON.stringify(facts)}` }],
  } as any);

  if (resp?.stop_reason === "refusal") return; // keep algorithmic text
  const textBlock = (resp.content as any[]).find((b: any) => b.type === "text") as any;
  if (!textBlock) return;
  const out = JSON.parse(textBlock.text) as { today_description?: string; state_assessment?: string; why?: string };

  if (out.state_assessment) briefing.state_assessment = out.state_assessment;
  if (out.why) briefing.why = out.why;
  if (out.today_description && today0) today0.description = out.today_description;
}
