/** Massif coach — the agentic morning run.
 *
 * Reads the ONE unified picture (cross-sport load split into aerobic + neuromuscular channels,
 * the CTL/ATL/TSB model, and Garmin recovery), asks Claude to reason on it under the level-5
 * coaching rules, then persists a briefing + today's recommended session. Phase-7 MVP: it writes
 * today's session from scratch (no multi-week plan to reshape yet) and logs every run for audit.
 */
import Anthropic from "@anthropic-ai/sdk";
import { COACH_MODEL, saveBriefing, replaceForwardCoachPlan, briefingExists } from "./db.js";
import { assemblePicture } from "./context.js";
import { sendBriefingPush } from "./push.js";
import { loadCoachSettings, buildPersonaInstructions } from "./persona.js";
import { COACH_SYSTEM, COACH_BRIEFING_SCHEMA, buildForwardPlanRows, deriveToday } from "./briefing-shared.js";

const SYSTEM = COACH_SYSTEM;
const BRIEFING_SCHEMA = COACH_BRIEFING_SCHEMA;

async function main() {
  const { today, sports, context } = await assemblePicture();

  // Idempotent cloud cron: if today's briefing is already written, don't re-run (no duplicate push).
  // The Mac path leaves COACH_SKIP_IF_DONE unset and always regenerates, as before.
  if (process.env.COACH_SKIP_IF_DONE && (await briefingExists(today))) {
    console.log(`coach: briefing for ${today} already exists — skipping (idempotent cron).`);
    return;
  }

  // The athlete's chosen coach persona/voice (same one the chat uses) shapes the briefing's free text.
  const settings = await loadCoachSettings();
  const system = SYSTEM + "\n\n" + buildPersonaInstructions(settings);

  const userPrompt =
    `Allowed sport codes: ${sports.map((s) => s.code).join(", ")}.\n` +
    `Priority sports: ${sports.filter((s) => s.is_priority).map((s) => s.code).join(", ")}.\n` +
    `Sports needing a manual RPE (no reliable HR): ` +
    `${sports.filter((s) => s.needs_manual_rpe).map((s) => s.code).join(", ")}.\n\n` +
    `Athlete picture (JSON):\n${JSON.stringify(context, null, 1)}\n\n` +
    `Produce today's briefing for ${today}.`;

  console.log(`Massif coach — ${today} — model ${COACH_MODEL}`);
  const client = new Anthropic();
  // STREAM then await the final message. Two reasons, coupled: adaptive thinking can burn ~14k tokens on a
  // heavy week, and at max_tokens 16000 the JSON output block got truncated to nothing ("No text block in
  // coach response"); raising the ceiling fixes that, but a ceiling > ~21k trips the SDK's 10-minute
  // non-streaming guard — so we stream (the SDK-recommended path) and read finalMessage(). max_tokens is a
  // ceiling only; adaptive thinking still uses just what it needs, so this doesn't raise cost.
  // Mirror in coach-briefing.ts.
  const resp = await client.messages.stream({
    model: COACH_MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: BRIEFING_SCHEMA } },
    system,
    messages: [{ role: "user", content: userPrompt }],
  } as any).finalMessage();

  if ((resp as any).stop_reason === "refusal") {
    throw new Error("Coach request was refused by safety classifiers.");
  }
  const textBlock = resp.content.find((b: any) => b.type === "text") as any;
  if (!textBlock) throw new Error("No text block in coach response.");
  const briefing = JSON.parse(textBlock.text);

  // Materialize the full forward 7-day plan as coach planned_sessions (skips declared-event days,
  // enforces no_hard_days). Mirror of the inline version in web/src/lib/coach-briefing.ts.
  const sportIdByCode = new Map<string, number | null>(sports.map((s) => [s.code, s.id]));
  const noHardDays = (((context as any).athlete_constraints?.no_hard_days) as string[] | null) ?? [];
  // Days [today, today+6] carrying a chat-accepted pinned session — the materializer SKIPS them so a
  // regen never overwrites or duplicates a session the athlete validated. Derived from the context.
  const pinnedDates = new Set<string>(
    (((context as any).pinned_sessions ?? []) as any[])
      .filter((p) => p.day_offset >= 0 && p.day_offset <= 6)
      .map((p) => p.date as string),
  );
  const rows = buildForwardPlanRows(today, briefing, sportIdByCode, noHardDays, briefing.why, pinnedDates);
  const materializedIds = await replaceForwardCoachPlan(today, rows);

  const { session: todaySession, sport: todaySportCode } = deriveToday(briefing);

  const briefingId = await saveBriefing({
    briefing_date: today,
    model: COACH_MODEL,
    readiness: briefing.readiness,
    today_session: todaySession,
    why: briefing.why,
    changed: null, // no prior plan to reshape in the MVP
    week_skeleton: briefing.week_plan, // the richer week_plan lives in the existing week_skeleton column
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
  });

  // Human-readable summary.
  const dot = { green: "🟢", amber: "🟡", red: "🔴" }[briefing.readiness as string] ?? "•";
  console.log(`\n${dot} Readiness: ${briefing.readiness}   (confidence ${briefing.confidence})`);
  console.log(`State: ${briefing.state_assessment}`);
  console.log(`\nToday → ${todaySession ?? "—"}  [${todaySportCode ?? "—"}]`);
  console.log(`Why: ${briefing.why}`);
  if (briefing.flag) console.log(`⚠️  ${briefing.flag}`);
  console.log(`\nWeek plan:`);
  for (const d of (briefing.week_plan ?? [])) {
    const tag = String(d.system_tag ?? "").padEnd(18);
    console.log(`  +${d.day_offset}d  ${tag} ${d.sport_code} · ${d.focus}${d.anchors_event_ref ? " (événement)" : ""}`);
  }
  console.log(`\nSaved: coach_briefings ${briefingId} · ${materializedIds.length} planned_sessions`);

  // Best-effort morning push to the installed PWA (never fails the briefing).
  try {
    await sendBriefingPush({
      readiness: briefing.readiness,
      title: todaySession ?? "Séance du jour",
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
