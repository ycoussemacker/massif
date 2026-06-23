/** The coach's conversational brain for the /coach chat — server-only.
 *  Same persona/model as coach/src/ask.ts, but agentic: the recent ~21d picture is provided up front
 *  (cached) and the coach can call tools to pull ANY older window from the DB on demand. */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleCoachContext, loadTodayBriefing, todayLocal } from "./coach-context";
import { loadCoachSettings, buildPersonaInstructions } from "./coach-settings";

export const COACH_MODEL = process.env.COACH_MODEL ?? "claude-sonnet-4-6";

const CHAT_SYSTEM = `You are the Massif coach, the SAME coach who writes this athlete's daily briefings,
now chatting with them about their own training.

THE CORE MODEL: every session produces ONE training load split into two channels that partition it —
aerobic_load (cardio cost; HRV / resting HR / Body Battery see it; recovers fast) and neuromuscular_load
(CNS + structural/tissue cost from limit climbing, heavy strength, eccentric DESCENT, technical alpinism;
wearables are largely blind to it; recovers slowly, tendons take weeks). CTL = chronic load/fitness (~42d),
ATL = acute load/fatigue (~7d), TSB = CTL−ATL (form), ACWR = acute:chronic ratio (>1.5 = injury-risk zone).
The channels are computed INDEPENDENTLY and summed (not one number sliced by a ratio): \`method\` is only the
AEROBIC-engine method (hrtss / vertical_duration / session_rpe…); the eccentric descent (D-) is added separately
into neuromuscular_load. Two outings can share method=hrtss yet differ on neuromuscular_load — more D- = more.
When explaining why one session cost more than another, reason via the two CHANNELS (aerobic vs neuro / D-),
never the method label.

HEAT & ALTITUDE (\`environment\` + per-activity temp_c / alt_max_m) are HR/recovery context, NOT extra load:
heat and altitude raise HR for the same effort, so the load already counts that strain — never tell the
athlete a hot or high session "should" have scored more. Use them to explain an elevated HR, a higher RPE,
or a depressed HRV / raised resting HR (a hot day or high altitude can dent recovery independently of
training fatigue), especially when heat/altitude acclimation (\`environment\`) is low.

The athlete's state over the last ~21 days is already provided to you (fitness model, recovery, recent
activities, upcoming plan). Answer grounded in that data — cite the actual numbers and dates. Use the tools
ONLY to look further back than what's provided (older periods, volume/form comparisons across months,
a specific sport's history). Don't call a tool for something already in the provided picture.

When asked to comment on a session/day, compare what was actually done against that day's briefing/plan:
did they follow it? too much / not enough? which channel did it spend (aerobic vs neuromuscular)? what does
it mean for recovery and the next days? Be specific and practical. The athlete's objectives are provided as a
RANKED list (goals[], most important first); reason about them in that order, give richer sport-specific
feedback when a session matches a goal's sport (goals[].sport), and weight goals with a nearer deadline
(goals[].days_to) more — some goals carry only a fuzzy horizon (goals[].horizon) and no date.

If the data doesn't cover what's asked, say so plainly rather than guessing. Note when a load is
\`duration_fallback\` (a rough estimate awaiting a manual RPE or HR), so the athlete knows its confidence.

RÉCUPÉRATION (Garmin) — \`recovery_today\` ne contient QUE les données du jour (date = today). N'utilise
JAMAIS la récupération d'un autre jour comme si elle était celle de ce matin. Si \`recovery_today.available\`
est false, ou si une métrique figure dans \`recovery_today.missing\`, dis franchement à l'athlète quelle
donnée te manque pour trancher en confiance (« il me manque le sommeil / la VFC / la FC de repos de ce matin
pour être pleinement légitime ») — n'invente pas un Body Battery, une VFC ou une FC de repos qui ne sont pas là.

BRIEFING DU JOUR — \`today_briefing\` est le briefing que tu as déjà écrit ce matin (readiness, séance, why,
state_assessment, flag). Reste cohérent avec lui ; si l'athlète pousse vers autre chose tu peux ajuster, mais
explique l'écart plutôt que de te contredire. S'il est null, aucun briefing n'a encore été produit aujourd'hui.

Réponds TOUJOURS en français, quelle que soit la langue de la question. Reste concis et conversationnel.`;

const TOOLS = [
  {
    name: "query_activities",
    description:
      "List the athlete's logged activities in a date window (older than the ~21d already provided). " +
      "Returns per-activity load split (aerobic/neuro), method, duration, distance, vertical D±, avg HR, RPE.",
    input_schema: {
      type: "object",
      properties: {
        since: { type: "string", description: "start date inclusive, YYYY-MM-DD" },
        until: { type: "string", description: "end date inclusive, YYYY-MM-DD" },
        sport_code: { type: "string", description: "optional sport code filter, e.g. running, trail_running, bouldering" },
        limit: { type: "integer", description: "max rows (default 100, max 300)" },
      },
      required: ["since", "until"],
    },
  },
  {
    name: "query_daily_metrics",
    description:
      "Daily rollups + fitness model (CTL/ATL/TSB/ACWR, daily load aerobic/neuro, D±) over a date window. " +
      "Use for volume/form trends or comparisons across weeks/months.",
    input_schema: {
      type: "object",
      properties: {
        since: { type: "string", description: "start date inclusive, YYYY-MM-DD" },
        until: { type: "string", description: "end date inclusive, YYYY-MM-DD" },
      },
      required: ["since", "until"],
    },
  },
];

async function queryActivities(sb: SupabaseClient, input: any): Promise<any> {
  const lim = Math.min(Math.max(Number(input?.limit) || 100, 1), 300);
  const { data: sports } = await sb.from("sports").select("id,code");
  const codeById = new Map<number, string>((sports ?? []).map((s: any) => [s.id, s.code]));

  let q = sb.from("activities")
    .select("local_date,sport_id,training_load,aerobic_load,neuromuscular_load,load_method_used," +
            "duration_s,distance_m,vertical_gain_m,vertical_loss_m,avg_hr,perceived_rpe,rpe_source")
    .gte("local_date", String(input.since)).lte("local_date", String(input.until))
    .order("local_date", { ascending: true }).limit(lim);

  if (input?.sport_code) {
    const sid = (sports ?? []).find((s: any) => s.code === input.sport_code)?.id;
    if (sid != null) q = q.eq("sport_id", sid);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((a: any) => ({
    date: a.local_date, sport: codeById.get(a.sport_id) ?? "unknown",
    load: a.training_load, aerobic: a.aerobic_load, neuro: a.neuromuscular_load,
    method: a.load_method_used, dur_min: Math.round((a.duration_s || 0) / 60),
    dist_km: a.distance_m != null ? Math.round(a.distance_m / 100) / 10 : null,
    dplus: a.vertical_gain_m, dminus: a.vertical_loss_m, avg_hr: a.avg_hr,
    rpe: a.perceived_rpe, rpe_source: a.rpe_source,
  }));
}

async function queryDailyMetrics(sb: SupabaseClient, input: any): Promise<any> {
  const { data, error } = await sb.from("daily_metrics")
    .select("local_date,daily_load,daily_aerobic_load,daily_neuromuscular_load,ctl,atl,tsb,acwr," +
            "vertical_gain_m,vertical_loss_m")
    .gte("local_date", String(input.since)).lte("local_date", String(input.until))
    .order("local_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((d: any) => ({
    date: d.local_date, load: d.daily_load, aerobic: d.daily_aerobic_load, neuro: d.daily_neuromuscular_load,
    ctl: d.ctl, atl: d.atl, tsb: d.tsb, acwr: d.acwr, dplus: d.vertical_gain_m, dminus: d.vertical_loss_m,
  }));
}

async function runTool(sb: SupabaseClient, name: string, input: any): Promise<any> {
  if (name === "query_activities") return queryActivities(sb, input);
  if (name === "query_daily_metrics") return queryDailyMetrics(sb, input);
  return { error: `unknown tool: ${name}` };
}

export type ChatTurn = { role: "user" | "coach"; content: string };

/** Reconstruct Anthropic messages from stored chat turns + the new user content.
 *  Coalesces consecutive same-role turns (API requires alternation) and drops any leading assistant. */
function buildMessages(history: ChatTurn[], newUserContent: string): any[] {
  const turns = [...history, { role: "user" as const, content: newUserContent }];
  const merged: { role: "user" | "assistant"; content: string }[] = [];
  for (const t of turns) {
    const role = t.role === "coach" ? "assistant" : "user";
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.content += "\n\n" + t.content;
    else merged.push({ role, content: t.content });
  }
  while (merged.length && merged[0].role === "assistant") merged.shift();
  return merged.map((m) => ({ role: m.role, content: m.content }));
}

/** Generate the coach's reply: provided context (cached) + agentic tool loop over the athlete's DB.
 *  Returns the final French text. `history` is the prior chat turns (oldest→newest), excluding the new turn. */
export async function generateCoachReply(opts: {
  sb: SupabaseClient;
  history: ChatTurn[];
  newUserContent: string;
}): Promise<string> {
  const { sb, history, newUserContent } = opts;
  const today = todayLocal();
  const [{ context }, settings, todayBriefing] = await Promise.all([
    assembleCoachContext(sb), loadCoachSettings(sb), loadTodayBriefing(sb, today),
  ]);
  const fullContext = { ...context, today_briefing: todayBriefing };
  const client = new Anthropic();

  const system = [
    { type: "text", text: CHAT_SYSTEM + "\n\n" + buildPersonaInstructions(settings) },
    {
      type: "text",
      text: `État actuel de l'athlète (données au ${today}, JSON) :\n${JSON.stringify(fullContext)}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  const messages = buildMessages(history, newUserContent);

  for (let i = 0; i < 5; i++) {
    const resp = await client.messages.create({
      model: COACH_MODEL,
      max_tokens: 4000,
      system,
      tools: TOOLS,
      messages,
    } as any);

    if ((resp as any).stop_reason === "refusal") {
      throw new Error("La demande a été refusée par les classifieurs de sécurité.");
    }

    if ((resp as any).stop_reason === "tool_use") {
      const toolUses = resp.content.filter((b: any) => b.type === "tool_use");
      messages.push({ role: "assistant", content: resp.content });
      const results: any[] = [];
      for (const tu of toolUses as any[]) {
        let out: any;
        try { out = await runTool(sb, tu.name, tu.input); }
        catch (e: any) { out = { error: String(e?.message ?? e) }; }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (text) return text;
    return "(le coach n'a pas formulé de réponse — réessaie)";
  }

  return "(le coach a interrogé tes données sans converger — reformule ta question)";
}
