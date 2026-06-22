/** Massif coach — the agentic morning run.
 *
 * Reads the ONE unified picture (cross-sport load split into aerobic + neuromuscular channels,
 * the CTL/ATL/TSB model, and Garmin recovery), asks Claude to reason on it under the level-5
 * coaching rules, then persists a briefing + today's recommended session. Phase-7 MVP: it writes
 * today's session from scratch (no multi-week plan to reshape yet) and logs every run for audit.
 */
import Anthropic from "@anthropic-ai/sdk";
import { COACH_MODEL, saveBriefing, replaceTodayPlanned, briefingExists } from "./db.js";
import { assemblePicture } from "./context.js";
import { sendBriefingPush } from "./push.js";

const SYSTEM = `You are the Massif coach: a personal, single-athlete, multi-sport endurance & mountain coach
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
   legs, fatigued fingers, or a taxed CNS.
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

LANGUE : génère TOUT le texte libre en FRANÇAIS — l'athlète est francophone. Cela couvre
state_assessment, today.title, today.description, why, flag, et chaque week_skeleton[].focus.
EXCEPTIONS (identifiants techniques, ne pas traduire) : today.system_tag et week_skeleton[].system_tag
restent dans le vocabulaire fixe anglais (easy, hard_aerobic, hard_neuromuscular, hard_structural,
recovery, rest), et sport_code reste un code de la liste autorisée. intensity_zone en français (ex. « Z2 »).

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
    why: { type: "string", description: "rationale for today's session, grounded in the data" },
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

async function main() {
  const { today, sports, context } = await assemblePicture();

  // Idempotent cloud cron: if today's briefing is already written, don't re-run (no duplicate push).
  // The Mac path leaves COACH_SKIP_IF_DONE unset and always regenerates, as before.
  if (process.env.COACH_SKIP_IF_DONE && (await briefingExists(today))) {
    console.log(`coach: briefing for ${today} already exists — skipping (idempotent cron).`);
    return;
  }

  const sportByCode = new Map<string, any>(sports.map((s) => [s.code, s]));

  const userPrompt =
    `Allowed sport codes: ${sports.map((s) => s.code).join(", ")}.\n` +
    `Priority sports: ${sports.filter((s) => s.is_priority).map((s) => s.code).join(", ")}.\n` +
    `Sports needing a manual RPE (no reliable HR): ` +
    `${sports.filter((s) => s.needs_manual_rpe).map((s) => s.code).join(", ")}.\n\n` +
    `Athlete picture (JSON):\n${JSON.stringify(context, null, 1)}\n\n` +
    `Produce today's briefing for ${today}.`;

  console.log(`Massif coach — ${today} — model ${COACH_MODEL}`);
  const client = new Anthropic();
  const resp = await client.messages.create({
    model: COACH_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: BRIEFING_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  } as any);

  if ((resp as any).stop_reason === "refusal") {
    throw new Error("Coach request was refused by safety classifiers.");
  }
  const textBlock = resp.content.find((b: any) => b.type === "text") as any;
  if (!textBlock) throw new Error("No text block in coach response.");
  const briefing = JSON.parse(textBlock.text);

  // Map the recommended sport -> sport_id (fall back to 'unknown').
  const sport = sportByCode.get(briefing.today.sport_code) ?? sportByCode.get("unknown");

  const plannedId = await replaceTodayPlanned(today, {
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
  });

  const briefingId = await saveBriefing({
    briefing_date: today,
    model: COACH_MODEL,
    readiness: briefing.readiness,
    today_session: briefing.today.title,
    why: briefing.why,
    changed: null, // no prior plan to reshape in the MVP
    week_skeleton: briefing.week_skeleton,
    flag: briefing.flag,
    reasoning: briefing.state_assessment,
    input_snapshot: context,
    actions: { created_planned_session: plannedId, today: briefing.today },
    confidence: briefing.confidence,
    raw_response: textBlock.text,
  });

  // Human-readable summary.
  const dot = { green: "🟢", amber: "🟡", red: "🔴" }[briefing.readiness as string] ?? "•";
  console.log(`\n${dot} Readiness: ${briefing.readiness}   (confidence ${briefing.confidence})`);
  console.log(`State: ${briefing.state_assessment}`);
  console.log(`\nToday → ${briefing.today.title}  [${briefing.today.sport_code} · ${briefing.today.system_tag}]`);
  console.log(`  ${briefing.today.description}`);
  console.log(`  ~${briefing.today.target_duration_min} min · ~${briefing.today.target_load} load pts · ${briefing.today.intensity_zone}`);
  console.log(`Why: ${briefing.why}`);
  if (briefing.flag) console.log(`⚠️  ${briefing.flag}`);
  console.log(`\nWeek ahead:`);
  for (const d of briefing.week_skeleton) console.log(`  +${d.day_offset}d  ${d.system_tag.padEnd(18)} ${d.focus}`);
  console.log(`\nSaved: coach_briefings ${briefingId} · planned_sessions ${plannedId}`);

  // Best-effort morning push to the installed PWA (never fails the briefing).
  try {
    await sendBriefingPush({
      readiness: briefing.readiness,
      title: briefing.today.title,
      why: briefing.why,
    });
  } catch (e) {
    console.log(`push: skipped (${(e as Error)?.message ?? e})`);
  }
}

main().catch((e) => {
  console.error("coach failed:", e?.message ?? e);
  process.exit(1);
});
