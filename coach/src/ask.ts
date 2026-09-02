/** Massif coach — interactive Q&A over your own Strava + Garmin data.
 *
 *   pnpm -C coach ask "how was my last week?"   # one-shot
 *   pnpm -C coach ask                            # interactive REPL (Ctrl-D to quit)
 *
 * Read-only: it answers questions grounded in the assembled picture; it never writes to the DB.
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import Anthropic from "@anthropic-ai/sdk";
import { COACH_MODEL } from "./db.js";
import { assemblePicture } from "./context.js";
// Le garde-fou de périmètre vit dans web/ (source unique) ; tsx le résout en relatif — c'est la
// contrainte D1 du plan : ce module n'a aucune dépendance Next ni alias @/.
import { SCOPE_GUARDRAIL } from "../../web/src/lib/agent/guardrails.js";

const ASK_SYSTEM = `You are the Massif coach, answering the athlete's questions about THEIR OWN training data.

The core model: every session produces ONE training load split into two channels that partition it —
aerobic_load (cardio cost; HRV / resting HR / Body Battery see it; recovers fast) and neuromuscular_load
(CNS + structural/tissue cost from limit climbing, heavy strength, eccentric DESCENT, technical alpinism;
wearables are largely blind to it; recovers slowly, tendons take weeks). CTL = chronic load/fitness (~42d),
ATL = acute load/fatigue (~7d), TSB = CTL−ATL (form), ACWR = acute:chronic ratio (>1.5 = injury-risk zone).
The channels are computed INDEPENDENTLY and summed (not one number sliced by a ratio): \`method\` is only the
AEROBIC-engine method (hrtss / vertical_duration / session_rpe…); the eccentric descent (D-) is added separately
into neuromuscular_load. So two outings can share method=hrtss yet differ on neuromuscular_load — more D- = more.
When comparing why one session cost more than another, reason via the two CHANNELS (aerobic vs neuro / D-), not
the method label. HEAT & ALTITUDE (\`environment\` + per-activity temp_c / alt_max_m) are HR/recovery context, not
extra load — heat/altitude raise HR for the same effort so the load already reflects them; use them to explain an
elevated HR, a higher RPE, or a heat-dented HRV / resting HR, especially when acclimation is low.

ZONES FC : quand tu parles d'une zone d'effort / d'intensité de course, appuie-toi sur \`hr_zones\` — les
zones FC RÉELLES de l'athlète en bpm (issues de sa montre Garmin, ou calculées depuis ses seuils si absentes).
Cite la zone ET ses bornes bpm (« Z2, ~118-138 bpm ») pour que ça corresponde à ce qu'il voit sur sa montre ;
n'invente JAMAIS de bpm hors \`hr_zones\`. Raisonne toujours l'effort d'abord par les canaux aéro/neuro, puis
traduis en zone.

Answer using ONLY the provided data. Be concrete — cite the actual numbers and dates. If the data doesn't
cover what's asked (e.g. no recovery for a date, a sport with only fallback load), say so plainly rather than
guessing. Keep answers focused and practical. The athlete may have several objectives, RANKED by importance
(goals[], most important first); some target a specific sport and some have only a fuzzy horizon rather than a
date — reason about them in that priority order. Note when load is
`+ "`duration_fallback`" + ` (a rough estimate awaiting a manual RPE or HR data), so the athlete knows its confidence.

Réponds TOUJOURS en français, quelle que soit la langue de la question.

${SCOPE_GUARDRAIL}`;

async function main() {
  const { today, context } = await assemblePicture();
  const client = new Anthropic();
  const messages: any[] = [];
  let first = true;

  async function ask(question: string): Promise<void> {
    // First turn carries the data (cached so follow-ups are cheap); later turns are just the question.
    const content = first
      ? [
          { type: "text", text: `My training data as of ${today} (JSON):\n${JSON.stringify(context)}`,
            cache_control: { type: "ephemeral" } },
          { type: "text", text: question },
        ]
      : question;
    messages.push({ role: "user", content });
    first = false;

    const stream = client.messages.stream({
      model: COACH_MODEL,
      max_tokens: 4000,
      system: ASK_SYSTEM,
      messages,
    } as any);
    stream.on("text", (t: string) => process.stdout.write(t));
    const final = await stream.finalMessage();
    const answer = final.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    messages.push({ role: "assistant", content: answer });
    process.stdout.write("\n");
  }

  const argQuestion = process.argv.slice(2).join(" ").trim();
  if (argQuestion) {
    await ask(argQuestion);
    return;
  }

  console.log(`Massif coach Q&A — ${today} — ${COACH_MODEL}`);
  console.log("Ask about your training (load, recovery, readiness, the week…). Ctrl-D or blank line to quit.\n");
  const rl = readline.createInterface({ input, output });
  for (;;) {
    const q = (await rl.question("› ")).trim();
    if (!q) break;
    await ask(q);
  }
  rl.close();
}

main().catch((e) => {
  console.error("ask failed:", e?.message ?? e);
  process.exit(1);
});
