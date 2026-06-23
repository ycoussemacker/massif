/** On-demand briefing generator — server-only. The SAME morning briefing the cron writes, but run
 *  inline from the web app so the athlete can regenerate it on demand (the ⋮ "Régénérer" action).
 *
 *  MIRROR of coach/src/coach.ts (web/ and coach/ are separate pnpm workspaces — no cross-import, same
 *  as load.ts ↔ load.py and coach-context.ts ↔ context.ts). Keep the SYSTEM prompt, schema and the
 *  coach_briefings / planned_sessions writes in sync with coach.ts. Differences here, by design:
 *   - the chosen coach PERSONA is injected (buildPersonaInstructions), so the briefing speaks in the
 *     same voice as the chat — the cron mirrors this via coach/src/persona.ts;
 *   - `why` is constrained to ONE sentence (the dashboard shows it collapsed + an "Afficher plus");
 *   - NO web push (the athlete is looking at the screen — the push is the cron's morning job). */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleCoachContext } from "./coach-context";
import { loadCoachSettings, buildPersonaInstructions } from "./coach-settings";
import { COACH_MODEL } from "./coach-chat";

const BRIEFING_SYSTEM = `You are the Massif coach: a personal, single-athlete, multi-sport endurance & mountain coach
(running, trail, hiking, alpinism, climbing, plus any other sport the athlete logs).

THE CORE MODEL — internalize it:
Every session produces ONE comparable training load, split into TWO channels that PARTITION the total:
- aerobic_load: cardiovascular cost. HRV / resting HR / Body Battery SEE it. Recovers in hours to 1-2 days.
- neuromuscular_load: CNS + structural/tissue cost (limit climbing, heavy strength, eccentric DESCENT, technical
  alpinism). Wearables are largely BLIND to it. Recovers in 24-72h+; tendons take weeks.
The two channels are computed INDEPENDENTLY and summed (not one number sliced by a ratio): \`method\` is only
the AEROBIC-engine method (hrtss / vertical_duration / session_rpe…); the eccentric descent (D-) is added
separately into neuromuscular_load. So two mountain outings can share method=hrtss yet differ sharply in
neuromuscular_load — more D- = more. Always explain a session's cost via the two channels, never the method label.

COACHING RULES (follow all):
1. Reason on ONE global picture — total + per-channel CTL/ATL/TSB, per-channel ACWR, trailing D+/D-, and the
   recovery composite. Never per-sport silos.
2. Classify each session by which BUDGET it spends (hard_aerobic / hard_neuromuscular / hard_structural / easy /
   recovery / rest), NOT by sport name.
3. Never two hard days back-to-back ON THE SAME SYSTEM. A hard climbing day spends the legs/CNS budget even
   though its HR (and thus aerobic load) is low.
4. Gate hard days on BOTH the recovery composite AND the load-channel history. Green HRV does not clear sore
   legs, fatigued fingers, or a taxed CNS. tsb_neuromuscular uses a SLOWER (~14d) acute τ than tsb_aerobic
   (~7d) because structural/tendon fatigue lingers weeks and is invisible to HRV: a clearly negative
   tsb_neuromuscular means carry structural fatigue even when combined TSB, tsb_aerobic and Garmin look fresh.
5. Protect the priority long session; keep roughly 80/20 easy/hard on the aerobic channel.
6. Big mountain days are multi-system bombs; use D- (descent) as a structural-injury guardrail.
7. Substitute, don't just cancel — cooked legs become easy cycling or a rest day, not a forced hard run.
8. Account for pack weight and altitude as load multipliers and recovery confounders.
9. Objectives are RANKED by the athlete (goals[], most important first) — weigh them in that order.
   A goal may target a specific sport (goals[].sport): give richer, sport-specific guidance when the
   session matches it. Weight goals with a nearer deadline (goals[].days_to) more heavily; some goals
   carry only a fuzzy horizon (goals[].horizon) and no date — honor those without computing days-to.
   Goals are optional per sport (there may be none, one, or several).

readiness: green = clear to train hard today; amber = caution, keep it easy/technical; red = recovery or rest.
Pick today's sport_code from the allowed list only. Be concrete and concise, and tie every call to the data.

RÉCUPÉRATION : \`recovery_today\` ne porte QUE les données Garmin du jour. Si \`recovery_today.available\` est
false (métriques absentes listées dans \`recovery_today.missing\`), n'invente pas de chiffres de récupération
et n'utilise PAS ceux d'un autre jour ; signale dans flag/state_assessment quelle donnée manque ce matin.

LANGUE : génère TOUT le texte libre en FRANÇAIS — l'athlète est francophone. Cela couvre
state_assessment, today.title, today.description, why, flag, et chaque week_skeleton[].focus.
EXCEPTIONS (identifiants techniques, ne pas traduire) : today.system_tag et week_skeleton[].system_tag
restent dans le vocabulaire fixe anglais (easy, hard_aerobic, hard_neuromuscular, hard_structural,
recovery, rest), et sport_code reste un code de la liste autorisée. intensity_zone en français (ex. « Z2 »).

CHAMP why : UNE SEULE PHRASE — la raison principale, la plus importante, de la reco du jour (≤ ~25 mots,
sans point-virgule enchaînant plusieurs idées). Mets le détail, les nuances et le contexte dans
state_assessment (2-4 phrases) ; ne répète pas ce détail dans why.

La PERSONNALISATION ci-dessous gouverne le TON, la VOIX, l'adresse et les emojis du texte libre — mais PAS
la LONGUEUR des champs, qui suit le schéma (why = 1 phrase, state_assessment = 2-4 phrases).

Respond ONLY with the JSON briefing matching the provided schema.`;

const BRIEFING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    readiness: { type: "string", enum: ["green", "amber", "red"] },
    state_assessment: { type: "string", description: "the athlete's current state in 2-4 sentences" },
    today: {
      type: "object",
      additionalProperties: false,
      properties: {
        sport_code: { type: "string", description: "one of the allowed sport codes" },
        system_tag: {
          type: "string",
          enum: ["easy", "hard_aerobic", "hard_neuromuscular", "hard_structural", "recovery", "rest"],
        },
        title: { type: "string" },
        description: { type: "string" },
        target_duration_min: { type: "integer" },
        target_load: { type: "number" },
        intensity_zone: { type: "string" },
        is_key: { type: "boolean" },
      },
      required: ["sport_code", "system_tag", "title", "description", "target_duration_min",
                 "target_load", "intensity_zone", "is_key"],
    },
    why: { type: "string", description: "ONE sentence max — the single most important reason for today's call, grounded in the data" },
    week_skeleton: {
      type: "array",
      description: "rough shape of the next ~7 days (offset 1..7)",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          day_offset: { type: "integer" },
          focus: { type: "string" },
          system_tag: { type: "string" },
        },
        required: ["day_offset", "focus", "system_tag"],
      },
    },
    flag: { type: ["string", "null"], description: "any guardrail/warning, or null" },
    confidence: { type: "number", description: "0..1" },
  },
  required: ["readiness", "state_assessment", "today", "why", "week_skeleton", "flag", "confidence"],
};

export interface BriefingResult {
  readiness: "green" | "amber" | "red";
  today_session: string;
  why: string;
}

/** Regenerate today's briefing from the current DB picture (fresh profile/goals) in the athlete's
 *  chosen coach voice, and persist it (coach_briefings + today's coach planned_session, idempotent).
 *  Returns a compact summary for the UI toast. No push (on-demand path). */
export async function generateBriefing(sb: SupabaseClient): Promise<BriefingResult> {
  const [{ today, context }, settings, sportsRes] = await Promise.all([
    assembleCoachContext(sb),
    loadCoachSettings(sb),
    sb.from("sports").select("id,code,is_priority,needs_manual_rpe").order("code"),
  ]);
  const sports = sportsRes.data ?? [];
  const sportByCode = new Map<string, any>(sports.map((s: any) => [s.code, s]));

  const system = BRIEFING_SYSTEM + "\n\n" + buildPersonaInstructions(settings);

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
    output_config: { format: { type: "json_schema", schema: BRIEFING_SCHEMA } },
    system,
    messages: [{ role: "user", content: userPrompt }],
  } as any);

  if ((resp as any).stop_reason === "refusal") {
    throw new Error("La génération du briefing a été refusée par les classifieurs de sécurité.");
  }
  const textBlock = (resp.content as any[]).find((b: any) => b.type === "text") as any;
  if (!textBlock) throw new Error("Réponse du coach vide (aucun bloc texte).");
  const briefing = JSON.parse(textBlock.text);

  // Map the recommended sport -> sport_id (fall back to 'unknown').
  const sport = sportByCode.get(briefing.today.sport_code) ?? sportByCode.get("unknown");

  // Idempotent per day: drop today's still-planned coach session, then insert the new one
  // (mirror of coach/src/db.ts replaceTodayPlanned).
  const del = await sb.from("planned_sessions").delete()
    .eq("planned_date", today).eq("modified_by", "coach").eq("status", "planned");
  if (del.error) throw new Error(del.error.message);
  const plannedIns = await sb.from("planned_sessions").insert({
    planned_date: today,
    sport_id: sport?.id ?? null,
    title: briefing.today.title,
    description: briefing.today.description,
    target_load: briefing.today.target_load,
    target_duration_s: Math.round((briefing.today.target_duration_min || 0) * 60),
    intensity_zone: briefing.today.intensity_zone,
    system_tag: briefing.today.system_tag,
    is_key: briefing.today.is_key,
    status: "planned",
    modified_by: "coach",
    modified_reason: briefing.why,
  }).select("id").single();
  if (plannedIns.error) throw new Error(plannedIns.error.message);

  const briefingIns = await sb.from("coach_briefings").insert({
    briefing_date: today,
    model: COACH_MODEL,
    readiness: briefing.readiness,
    today_session: briefing.today.title,
    why: briefing.why,
    changed: null,
    week_skeleton: briefing.week_skeleton,
    flag: briefing.flag,
    reasoning: briefing.state_assessment,
    input_snapshot: context,
    actions: { created_planned_session: plannedIns.data.id, today: briefing.today },
    confidence: briefing.confidence,
    raw_response: textBlock.text,
  }).select("id").single();
  if (briefingIns.error) throw new Error(briefingIns.error.message);

  return {
    readiness: briefing.readiness,
    today_session: briefing.today.title,
    why: briefing.why,
  };
}
