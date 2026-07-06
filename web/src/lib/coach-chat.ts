/** The coach's conversational brain for the /coach chat — server-only.
 *  Same persona/model as coach/src/ask.ts, but agentic: the recent ~21d picture is provided up front
 *  (cached) and the coach can call tools to pull ANY older window from the DB on demand. */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleCoachContext, loadTodayBriefing, todayLocal, dateMinusDays } from "./coach-context";
import { derivePhaseState, phaseSummaryFr } from "./briefing-algo";
import { loadCoachSettings, buildPersonaInstructions } from "./coach-settings";
import { estimateForDeclared } from "./estimate-server";
import { simulateForChat } from "./coach-simulate";
import {
  insertProposal, summarizeProposal, fingerprintOf, supersedePendingForTarget,
  type ProposalKind, type ProposalOperations, type ProposalPayload,
} from "./coach-proposals";

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

HEURE ACTUELLE — \`now_local\` (jour + HH:MM, fuseau de l'athlète) est l'heure qu'il est MAINTENANT.
Raisonne TOUJOURS avec : ne propose jamais un créneau déjà passé (« cours ce matin avant 8h » à 15h30
n'a aucun sens). Si la fenêtre idéale est passée, adapte la séance au temps qu'il reste dans la journée,
ou bascule-la explicitement à demain — ne fais pas comme si la journée commençait.

When asked to comment on a session/day, compare what was actually done against that day's briefing/plan:
did they follow it? too much / not enough? which channel did it spend (aerobic vs neuromuscular)? what does
it mean for recovery and the next days? Be specific and practical. The athlete's objectives are provided as a
RANKED list (goals[], most important first); reason about them in that order, give richer sport-specific
feedback when a session matches a goal's sport (goals[].sport), and weight goals with a nearer deadline
(goals[].days_to) more — some goals carry only a fuzzy horizon (goals[].horizon) and no date.

PHASE DE PÉRIODISATION — \`training_phase\` situe la semaine dans la préparation de l'objectif principal
(base / build / pré-compétition / affûtage, semaine de charge ou de DÉCHARGE, S−N). Raisonne AVEC :
en semaine de charge la forme (TSB) doit rester légèrement négative (≈ −5 à −20, c'est la surcharge
productive — ne pousse PAS l'athlète vers un TSB positif hors affûtage) ; en décharge on encaisse
(volume réduit, intensité conservée) ; l'affûtage vise TSB 0/+10 le jour J. Si l'athlète s'inquiète
d'un TSB négatif en pleine phase de charge, explique que c'est voulu et borné par la readiness.

ZONES FC : quand tu prescris ou commentes une zone d'effort / intensité de course, appuie-toi sur
\`hr_zones\` — les zones FC RÉELLES de l'athlète en bpm (issues de sa montre Garmin, ou calculées depuis ses
seuils si absentes). Cite la zone ET ses bornes bpm (« Z2, ~118-138 bpm ») pour que ça corresponde à sa
montre ; n'invente JAMAIS de bpm hors \`hr_zones\`. Raisonne l'effort d'abord par les canaux aéro/neuro, puis
traduis en zone. Quand tu proposes une séance aérobie (propose_session), mets la zone dans \`intensity_zone\`
et ses bornes bpm dans la description.

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

MODIFIER LE PLAN / LES ACTIVITÉS — tu peux désormais PROPOSER des changements, mais tu n'écris JAMAIS
toi-même : chaque proposition est VALIDÉE par l'athlète via une carte (Accepter / Modifier / Ignorer) —
la carte EST la validation.

SOIS PROACTIF — fais le travail avant qu'on te le demande. Quand l'athlète exprime une envie qui s'écarte
du plan (« plutôt grimper aujourd'hui ? »), ne réponds JAMAIS par un « non » de principe : envisage
toi-même les variantes réalistes (un autre créneau dans la journée vu \`now_local\`, une version plus
légère / confort) et SIMULE-les (estimate_session + simulate_plan) AVANT de répondre. Anticipe l'objection
évidente — « la fenêtre de récup qui reste suffit-elle pour la séance clé ? » — et donne les chiffres dès
ta PREMIÈRE réponse (TSB veille de la séance clé, ACWR), sans attendre qu'on te challenge. Mène avec le
verdict chiffré et l'option qui marche, pas avec un refus.

Avant de proposer : lis le plan réel (read_plan) pour les vrais id de séances, chiffre l'effort
(estimate_session), simule l'impact (simulate_plan). Puis — dès que tu conclus qu'une option est
raisonnable ET que l'athlète la souhaite — APPELLE directement l'outil propose_* dans le MÊME tour et
présente la carte. Ne demande JAMAIS la permission de proposer : « tu veux que je te la propose ? » est
INTERDIT (la carte sert exactement à ça, et l'athlète peut toujours l'Ignorer). Tu proposes, il valide.
  • propose_session — créer ou REMPLACER la séance d'un jour ; pour un échange mets replaces_session_id =
    l'id de la séance remplacée (lu dans read_plan / coach_prior_plan / pinned_sessions). C'est le cas
    « il fait chaud, je préfère grimper aujourd'hui ».
  • propose_event — déclarer un événement (course, gros objectif) à une date ; regen_week=true pour
    réorganiser la semaine autour (cas du trail 4000 D+).
  • propose_delete — retirer une séance ; propose_reshape — réorganiser toute la semaine.
  • propose_activity_edit — corriger une activité DÉJÀ enregistrée (RPE, sport).
Utilise UNIQUEMENT un sport_code de \`available_sports\`. Mets l'impact simulé (TSB veille, ACWR) dans le
champ forecast_note de la proposition ET dans ta prose. Reste sobre : une à deux propositions cohérentes
par tour. Tu NE confirmes JAMAIS toi-même qu'un changement est appliqué (c'est l'acceptation qui
l'applique) — formule « je te le propose, valide ci-dessous ».

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
  // ── READ tools (run live, no confirmation) ──────────────────────────────────────────────────────
  {
    name: "read_plan",
    description:
      "List the athlete's UPCOMING planned_sessions with their real id (coach sessions, declared events " +
      "and chat-accepted pinned sessions). Use it to get the exact id of a session you want to replace/delete.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "start date inclusive, YYYY-MM-DD (default today)" },
        to: { type: "string", description: "end date inclusive, YYYY-MM-DD (default today+13)" },
      },
    },
  },
  {
    name: "estimate_session",
    description:
      "Estimate the load (aerobic + neuromuscular) a HYPOTHETICAL session would cost, from the athlete's " +
      "own similar past efforts. Use before proposing a session/event to ground its target load.",
    input_schema: {
      type: "object",
      properties: {
        sport_code: { type: "string", description: "a code from available_sports" },
        title: { type: "string" },
        target_duration_s: { type: "integer" },
        target_distance_m: { type: "number" },
        target_vertical_m: { type: "number" },
      },
      required: ["sport_code"],
    },
  },
  {
    name: "simulate_plan",
    description:
      "Project the fitness model (CTL/ATL/TSB/ACWR) forward, BASELINE vs hypothetical sessions injected on " +
      "given future dates. The way to answer 'when can I safely do X?': read the eve-of-event TSB and the " +
      "ACWR at several candidate dates. Writes nothing.",
    input_schema: {
      type: "object",
      properties: {
        horizon_days: { type: "integer", description: "days ahead to project (default 21, max 60)" },
        overrides: {
          type: "array",
          description: "hypothetical sessions; each REPLACES the planned load on its (future) date",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "YYYY-MM-DD (future)" },
              aerobic: { type: "number" },
              neuro: { type: "number" },
            },
            required: ["date", "aerobic", "neuro"],
          },
        },
      },
    },
  },
  // ── WRITE-PROPOSAL tools (NO write — register a PENDING proposal the athlete validates) ──────────
  {
    name: "propose_session",
    description:
      "Propose creating or REPLACING the prescription of a single day (e.g. swap today's run for climbing). " +
      "Set replaces_session_id to overwrite an existing session. Does NOT write — the athlete confirms.",
    input_schema: {
      type: "object",
      properties: {
        planned_date: { type: "string", description: "YYYY-MM-DD" },
        sport_code: { type: "string", description: "a code from available_sports" },
        title: { type: "string" },
        description: { type: "string" },
        system_tag: { type: "string", enum: ["easy", "hard_aerobic", "hard_neuromuscular", "hard_structural", "recovery", "rest"] },
        intensity_zone: { type: "string", description: "FR, e.g. « Z2 »" },
        target_duration_s: { type: "integer" },
        target_distance_m: { type: "number" },
        target_vertical_m: { type: "number" },
        expected_altitude_m: { type: "integer" },
        target_aerobic_load: { type: "number" },
        target_neuromuscular_load: { type: "number" },
        is_key: { type: "boolean" },
        replaces_session_id: { type: "string", description: "id (from read_plan) of the session to overwrite; omit to add" },
        forecast_note: { type: "string", description: "one-line FR simulated impact (TSB veille, ACWR)" },
        rationale: { type: "string", description: "FR, why — shown on the card" },
      },
      required: ["planned_date", "sport_code", "title", "system_tag", "rationale"],
    },
  },
  {
    name: "propose_event",
    description:
      "Propose declaring an athlete EVENT (race, big outing) on a date. regen_week=true reshapes the week " +
      "around it on accept. Does NOT write — the athlete confirms.",
    input_schema: {
      type: "object",
      properties: {
        planned_date: { type: "string", description: "YYYY-MM-DD" },
        sport_code: { type: "string", description: "a code from available_sports" },
        title: { type: "string" },
        description: { type: "string" },
        target_distance_m: { type: "number" },
        target_vertical_m: { type: "number" },
        target_duration_s: { type: "integer" },
        expected_altitude_m: { type: "integer" },
        is_key: { type: "boolean" },
        regen_week: { type: "boolean", description: "true ⇒ regenerate the week plan around this event on accept" },
        forecast_note: { type: "string", description: "one-line FR simulated impact (TSB veille, ACWR)" },
        rationale: { type: "string", description: "FR, why — shown on the card" },
      },
      required: ["planned_date", "sport_code", "title", "rationale"],
    },
  },
  {
    name: "propose_delete",
    description: "Propose removing a planned session from the plan (it becomes skipped). The athlete confirms.",
    input_schema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "id (from read_plan) of the session to remove" },
        rationale: { type: "string", description: "FR, why" },
      },
      required: ["session_id", "rationale"],
    },
  },
  {
    name: "propose_reshape",
    description: "Propose regenerating the whole 7-day plan (e.g. the week drifted). On accept it runs the week regen.",
    input_schema: {
      type: "object",
      properties: { rationale: { type: "string", description: "FR, why" } },
      required: ["rationale"],
    },
  },
  {
    name: "propose_activity_edit",
    description:
      "Propose correcting an ALREADY-LOGGED activity: set a perceived RPE (recomputes its load) and/or " +
      "re-label its sport. Get the activity from query_activities. The athlete confirms.",
    input_schema: {
      type: "object",
      properties: {
        activity_id: { type: "string", description: "id of the logged activity" },
        perceived_rpe: { type: "integer", description: "1..10 — recomputes the session load via session_rpe" },
        sport_code: { type: "string", description: "a code from available_sports — re-label the sport" },
        rationale: { type: "string", description: "FR, why" },
      },
      required: ["activity_id", "rationale"],
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

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const numOrNull = (v: any): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

/** The athlete's upcoming plan with real ids — so a proposal can target an existing row. */
async function readPlan(sb: SupabaseClient, input: any): Promise<any> {
  const from = ISO.test(input?.from) ? input.from : todayLocal();
  const to = ISO.test(input?.to) ? input.to : dateMinusDays(from, -13);
  const { data: sports } = await sb.from("sports").select("id,code");
  const codeById = new Map<number, string>((sports ?? []).map((s: any) => [s.id, s.code]));
  const { data, error } = await sb.from("planned_sessions")
    .select("id,planned_date,order_in_day,sport_id,title,system_tag,is_event,is_pinned,is_key," +
            "target_load,target_aerobic_load,target_neuromuscular_load,target_duration_s,modified_by,status,linked_activity_id")
    .gte("planned_date", from).lte("planned_date", to).neq("status", "skipped")
    .order("planned_date", { ascending: true }).order("order_in_day", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id, date: r.planned_date, order_in_day: r.order_in_day,
    sport: r.sport_id != null ? (codeById.get(r.sport_id) ?? null) : null,
    title: r.title, system_tag: r.system_tag,
    kind: r.is_event ? "event" : r.is_pinned ? "pinned" : r.modified_by === "coach" ? "coach" : "user",
    is_key: !!r.is_key,
    target_load: r.target_load, target_aerobic: r.target_aerobic_load, target_neuro: r.target_neuromuscular_load,
    dur_min: r.target_duration_s ? Math.round(Number(r.target_duration_s) / 60) : null,
    status: r.status, has_logged_activity: !!r.linked_activity_id,
  }));
}

/** Cost a hypothetical session from the athlete's own similar past efforts (wraps estimateForDeclared). */
async function estimateSession(sb: SupabaseClient, input: any): Promise<any> {
  const code = String(input?.sport_code ?? "").trim();
  if (!code) return { error: "sport_code requis" };
  const { data: sportRow } = await sb.from("sports").select("id,taxonomy_group").eq("code", code).maybeSingle();
  if (!sportRow) return { error: `sport inconnu : ${code}` };
  const est = await estimateForDeclared(sb, {
    sportId: (sportRow as any).id, taxonomyGroup: (sportRow as any).taxonomy_group ?? null,
    durationS: numOrNull(input?.target_duration_s), distanceM: numOrNull(input?.target_distance_m),
    verticalGainM: numOrNull(input?.target_vertical_m), name: input?.title ?? null,
  });
  return { aerobic: est.aerobic, neuro: est.neuro, total: est.total, basis: est.basis, basis_label: est.basisLabel, confidence: est.confidence };
}

/** Snapshot a planned row's mutable state (staleness guard) — null row ⇒ not found. */
async function plannedFingerprint(sb: SupabaseClient, id: string) {
  const { data } = await sb.from("planned_sessions").select("updated_at,status,linked_activity_id").eq("id", id).maybeSingle();
  return { row: data, fp: fingerprintOf(data as any) };
}
async function activityFingerprint(sb: SupabaseClient, id: string) {
  const { data } = await sb.from("activities").select("updated_at").eq("id", id).maybeSingle();
  return { row: data, fp: fingerprintOf(data ? { updated_at: (data as any).updated_at } : null) };
}

/** Register a PENDING proposal from a propose_* tool call (NO write to the plan). Returns the id + summary
 *  to the model so it can present it; the athlete validates it from the card. */
async function proposeFromTool(sb: SupabaseClient, name: string, input: any, proposalIds: string[]): Promise<any> {
  let kind: ProposalKind;
  let operations: ProposalOperations;

  if (name === "propose_session") {
    kind = "session";
    const payload: ProposalPayload = {
      planned_date: String(input?.planned_date ?? ""), sport_code: input?.sport_code ?? null,
      title: String(input?.title ?? "").slice(0, 200), description: input?.description ?? null,
      system_tag: input?.system_tag ?? null, intensity_zone: input?.intensity_zone ?? null,
      target_duration_s: numOrNull(input?.target_duration_s), target_distance_m: numOrNull(input?.target_distance_m),
      target_vertical_m: numOrNull(input?.target_vertical_m), expected_altitude_m: numOrNull(input?.expected_altitude_m),
      target_aerobic_load: numOrNull(input?.target_aerobic_load), target_neuromuscular_load: numOrNull(input?.target_neuromuscular_load),
      is_key: !!input?.is_key, replaces_session_id: input?.replaces_session_id ?? null,
      forecast_note: input?.forecast_note ?? null, rationale: String(input?.rationale ?? ""),
    };
    let fp: string | null = null;
    const target = input?.replaces_session_id ? String(input.replaces_session_id) : null;
    if (target) {
      const { row, fp: f } = await plannedFingerprint(sb, target);
      if (!row) return { error: "séance à remplacer introuvable (utilise read_plan pour un id valide)" };
      fp = f; await supersedePendingForTarget(sb, target);
    }
    operations = { payload, target_planned_id: target, expected_fingerprint: fp, regen_week: false };
  } else if (name === "propose_event") {
    kind = "event";
    const payload: ProposalPayload = {
      planned_date: String(input?.planned_date ?? ""), sport_code: input?.sport_code ?? null,
      title: String(input?.title ?? "").slice(0, 200), description: input?.description ?? null,
      target_distance_m: numOrNull(input?.target_distance_m), target_vertical_m: numOrNull(input?.target_vertical_m),
      target_duration_s: numOrNull(input?.target_duration_s), expected_altitude_m: numOrNull(input?.expected_altitude_m),
      is_key: !!input?.is_key, regen_week: !!input?.regen_week,
      forecast_note: input?.forecast_note ?? null, rationale: String(input?.rationale ?? ""),
    };
    operations = { payload, regen_week: !!input?.regen_week };
  } else if (name === "propose_delete") {
    kind = "delete";
    const id = String(input?.session_id ?? "");
    const { row, fp } = await plannedFingerprint(sb, id);
    if (!row) return { error: "séance introuvable (utilise read_plan pour un id valide)" };
    await supersedePendingForTarget(sb, id);
    operations = { payload: { session_id: id, rationale: String(input?.rationale ?? "") }, target_planned_id: id, expected_fingerprint: fp };
  } else if (name === "propose_reshape") {
    kind = "reshape";
    operations = { payload: { rationale: String(input?.rationale ?? "") }, regen_week: true };
  } else if (name === "propose_activity_edit") {
    kind = "activity_edit";
    const id = String(input?.activity_id ?? "");
    const { row, fp } = await activityFingerprint(sb, id);
    if (!row) return { error: "activité introuvable" };
    const rpe = numOrNull(input?.perceived_rpe);
    operations = {
      payload: { activity_id: id, perceived_rpe: rpe, sport_code: input?.sport_code ?? null, rationale: String(input?.rationale ?? "") },
      target_activity_id: id, expected_fingerprint: fp,
    };
  } else {
    return { error: `unknown tool: ${name}` };
  }

  const summary = summarizeProposal(kind, operations.payload);
  const note = (operations.payload as any)?.forecast_note ?? null;
  const { id } = await insertProposal(sb, { kind, operations, summary, simulation: note ? { note } : null });
  proposalIds.push(id);
  return { proposal_id: id, summary, status: "proposé — en attente de la validation de l'athlète. Présente-lui la proposition clairement, ne dis pas qu'elle est appliquée." };
}

async function runTool(sb: SupabaseClient, name: string, input: any, proposalIds: string[]): Promise<any> {
  if (name === "query_activities") return queryActivities(sb, input);
  if (name === "query_daily_metrics") return queryDailyMetrics(sb, input);
  if (name === "read_plan") return readPlan(sb, input);
  if (name === "estimate_session") return estimateSession(sb, input);
  if (name === "simulate_plan") return simulateForChat(sb, { horizonDays: input?.horizon_days, overrides: input?.overrides });
  if (name.startsWith("propose_")) return proposeFromTool(sb, name, input, proposalIds);
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
 *  Returns the final French text + the ids of any PENDING proposals raised this turn (the propose_* tools
 *  register them; sendCoachMessage stamps them onto the coach message so the card renders under it).
 *  `history` is the prior chat turns (oldest→newest), excluding the new turn. */
export async function generateCoachReply(opts: {
  sb: SupabaseClient;
  history: ChatTurn[];
  newUserContent: string;
}): Promise<{ text: string; proposalIds: string[] }> {
  const { sb, history, newUserContent } = opts;
  const today = todayLocal();
  const [{ context }, settings, todayBriefing, sportsRes] = await Promise.all([
    assembleCoachContext(sb), loadCoachSettings(sb), loadTodayBriefing(sb, today),
    sb.from("sports").select("code").order("code"),
  ]);
  // Sport codes the coach may use when proposing a session/event (the propose_* tools resolve them).
  const availableSports = (sportsRes.data ?? []).map((s: any) => s.code);
  // Phase de périodisation courante (Q15) — dérivée des goals déjà assemblés, pour que le chat tienne
  // le même discours que le briefing (charge/décharge/affûtage) sans toucher au mirror du contexte.
  const phaseSum = phaseSummaryFr(derivePhaseState(context));
  const fullContext = {
    ...context, today_briefing: todayBriefing, available_sports: availableSports,
    training_phase: phaseSum ? `${phaseSum.name} — ${phaseSum.detail}` : null,
  };
  const client = new Anthropic();
  const proposalIds: string[] = [];

  const system = [
    { type: "text", text: CHAT_SYSTEM + "\n\n" + buildPersonaInstructions(settings) },
    {
      type: "text",
      text: `État actuel de l'athlète (données au ${today}, JSON) :\n${JSON.stringify(fullContext)}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  const messages = buildMessages(history, newUserContent);

  // Up to 8 turns: a planning request can chain read_plan → estimate_session → simulate_plan → propose_*.
  for (let i = 0; i < 8; i++) {
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
        try { out = await runTool(sb, tu.name, tu.input, proposalIds); }
        catch (e: any) { out = { error: String(e?.message ?? e) }; }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    return { text: text || "(le coach n'a pas formulé de réponse — réessaie)", proposalIds };
  }

  return { text: "(le coach a interrogé tes données sans converger — reformule ta question)", proposalIds };
}
