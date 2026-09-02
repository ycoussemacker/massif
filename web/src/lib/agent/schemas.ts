/** Le contrat des outils de l'agent — Zod, dans les deux sens, source UNIQUE du schéma.
 *
 *  Avant, chaque outil portait un JSON Schema écrit à la main pour le modèle, et un handler qui recevait
 *  `any` et recoercait à la main (`String(input.since)`). Deux conséquences : le catalogue annoncé au
 *  modèle pouvait diverger de ce que le code acceptait réellement, et une entrée aberrante traversait
 *  jusqu'à PostgREST — c'est comme ça qu'une date « juin » finissait en requête.
 *
 *  Ici, le schéma Zod est la seule définition. Le JSON Schema envoyé à l'API en est DÉRIVÉ
 *  (`z.toJSONSchema`), donc les deux ne peuvent plus se désynchroniser ; et la sortie est décrite elle
 *  aussi, ce qui donne un filet en développement quand un outil change de forme sans que ses
 *  consommateurs le sachent.
 *
 *  Une entrée invalide ne LÈVE pas : elle revient au modèle en français, avec ce qu'il faut corriger.
 *  C'est la gestion d'échec d'outil — le modèle doit pouvoir se rattraper au tour suivant.
 *
 *  Imports relatifs uniquement, aucune dépendance Next : `coach/` exécute ce module via tsx. */
import { z } from "zod";
import { LIMITS } from "./limits";

// Le message est identique pour un mauvais TYPE et pour un mauvais FORMAT : le modèle doit lire la
// même consigne qu'il ait envoyé `null`, un nombre ou « demain ».
const ISO_MSG = "date au format YYYY-MM-DD attendue";
const isoDate = z.string({ error: ISO_MSG }).regex(/^\d{4}-\d{2}-\d{2}$/, ISO_MSG);

const SYSTEM_TAGS = ["easy", "hard_aerobic", "hard_neuromuscular", "hard_structural", "recovery", "rest"] as const;

// ── Sorties : décrites pour que la forme rendue au modèle soit un contrat, pas une habitude ────────
const truncation = {
  truncated: z.boolean().describe("true = la réponse est partielle ; lis `note`"),
  note: z.string().optional(),
};

const activityOut = z.object({
  date: z.string(), sport: z.string(),
  load: z.number().nullable(), aerobic: z.number().nullable(), neuro: z.number().nullable(),
  method: z.string().nullable(), dur_min: z.number(),
  dist_km: z.number().nullable(), dplus: z.number().nullable(), dminus: z.number().nullable(),
  avg_hr: z.number().nullable(), rpe: z.number().nullable(), rpe_source: z.string().nullable(),
});

const dayOut = z.object({
  date: z.string(), load: z.number().nullable(), aerobic: z.number().nullable(), neuro: z.number().nullable(),
  ctl: z.number().nullable(), atl: z.number().nullable(), tsb: z.number().nullable(), acwr: z.number().nullable(),
  dplus: z.number().nullable(), dminus: z.number().nullable(),
});

const sessionOut = z.object({
  id: z.string(), date: z.string(), order_in_day: z.number().nullable(), sport: z.string().nullable(),
  title: z.string().nullable(), system_tag: z.string().nullable(), kind: z.string(), is_key: z.boolean(),
  target_load: z.number().nullable(), target_aerobic: z.number().nullable(), target_neuro: z.number().nullable(),
  dur_min: z.number().nullable(), status: z.string().nullable(), has_logged_activity: z.boolean(),
});

/** Toute réponse d'outil peut être une erreur adressée AU MODÈLE : c'est une valeur, pas une exception. */
const errorOut = z.object({ error: z.string() });

export type ToolSpec = {
  name: string;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
  /** Écrit-il ? Aucun outil de LECTURE ne doit muter quoi que ce soit (invariants.test.ts le vérifie). */
  writes: boolean;
};

export const TOOL_SPECS: ToolSpec[] = [
  // ── LECTURE ──────────────────────────────────────────────────────────────────────────────────
  {
    name: "query_activities",
    writes: false,
    description:
      "List the athlete's logged activities in a date window (older than the ~21d already provided). " +
      "Returns { window, count, truncated, activities[] } — per-activity load split (aerobic/neuro), method, " +
      `duration, distance, vertical D±, avg HR, RPE. At most ${LIMITS.activities} activities, the most RECENT ` +
      "ones. If `truncated` is true, older activities were left out: read `note`, say so if it changes your " +
      "answer, and narrow the window rather than concluding from a partial list.",
    input: z.object({
      since: isoDate.describe("start date inclusive, YYYY-MM-DD"),
      until: isoDate.describe("end date inclusive, YYYY-MM-DD"),
      sport_code: z.string().optional().describe("optional sport code filter, e.g. running, trail_running, bouldering"),
      limit: z.number().int().min(1).max(LIMITS.activities).optional().describe(`max rows (default 100, max ${LIMITS.activities})`),
    }),
    output: z.union([errorOut, z.object({
      window: z.object({ since: z.string(), until: z.string() }),
      count: z.number(), ...truncation, activities: z.array(activityOut),
    })]),
  },
  {
    name: "query_daily_metrics",
    writes: false,
    description:
      "Daily rollups + fitness model (CTL/ATL/TSB/ACWR, daily load aerobic/neuro, D±) over a date window. " +
      "Use for volume/form trends or comparisons across weeks/months. Returns { requested_window, window, " +
      `count, truncated, days[] }. The window is capped at ${LIMITS.dailyMetricsDays} days and is kept on its ` +
      "RECENT end: ask for a span wider than that and `truncated` comes back true with `window` showing what " +
      "was actually read — the earlier part is ABSENT, not empty. To compare two distant periods, make ONE " +
      "call per period instead of a single call spanning both.",
    input: z.object({
      since: isoDate.describe("start date inclusive, YYYY-MM-DD"),
      until: isoDate.describe("end date inclusive, YYYY-MM-DD"),
    }),
    output: z.union([errorOut, z.object({
      requested_window: z.object({ since: z.string(), until: z.string() }),
      window: z.object({ since: z.string(), until: z.string() }),
      count: z.number(), ...truncation,
      window_applied: z.object({ since: z.string(), until: z.string() }).optional(),
      days: z.array(dayOut),
    })]),
  },
  {
    name: "read_plan",
    writes: false,
    description:
      "List the athlete's UPCOMING planned_sessions with their real id (coach sessions, declared events " +
      "and chat-accepted pinned sessions). Use it to get the exact id of a session you want to replace/delete. " +
      `Returns { window, count, truncated, sessions[] }; at most ${LIMITS.plannedSessions} sessions over at ` +
      `most ${LIMITS.planHorizonDays} days. If \`truncated\` is true, do not assume the plan is complete.`,
    input: z.object({
      from: isoDate.optional().describe("start date inclusive, YYYY-MM-DD (default today)"),
      to: isoDate.optional().describe("end date inclusive, YYYY-MM-DD (default today+13)"),
    }),
    output: z.union([errorOut, z.object({
      window: z.object({ from: z.string(), to: z.string() }),
      count: z.number(), ...truncation,
      window_applied: z.object({ since: z.string(), until: z.string() }).optional(),
      sessions: z.array(sessionOut),
    })]),
  },
  {
    name: "estimate_session",
    writes: false,
    description:
      "Estimate the load (aerobic + neuromuscular) a HYPOTHETICAL session would cost, from the athlete's " +
      "own similar past efforts. Use before proposing a session/event to ground its target load.",
    input: z.object({
      sport_code: z.string().describe("a code from available_sports"),
      title: z.string().optional(),
      target_duration_s: z.number().int().positive().optional(),
      target_distance_m: z.number().positive().optional(),
      target_vertical_m: z.number().nonnegative().optional(),
    }),
    output: z.union([errorOut, z.object({
      aerobic: z.number().nullable(), neuro: z.number().nullable(), total: z.number().nullable(),
      basis: z.string().nullable(), basis_label: z.string().nullable(), confidence: z.string().nullable(),
    })]),
  },
  {
    name: "simulate_plan",
    writes: false,
    description:
      "Project the fitness model (CTL/ATL/TSB/ACWR) forward, BASELINE vs hypothetical sessions injected on " +
      "given future dates. The way to answer 'when can I safely do X?': read the eve-of-event TSB and the " +
      "ACWR at several candidate dates. Writes nothing.",
    input: z.object({
      horizon_days: z.number().int().min(1).max(60).optional().describe("days ahead to project (default 21, max 60)"),
      overrides: z.array(z.object({
        date: isoDate.describe("YYYY-MM-DD (future)"),
        aerobic: z.number(),
        neuro: z.number(),
      })).optional().describe("hypothetical sessions; each REPLACES the planned load on its (future) date"),
    }),
    output: z.object({
      today: z.string(), horizon_days: z.number(),
      baseline: z.array(z.object({
        date: z.string(), ctl: z.number(), atl: z.number(), tsb: z.number(),
        tsb_aerobic: z.number(), tsb_neuromuscular: z.number(), acwr: z.number().nullable(),
      })),
      with_overrides: z.array(z.unknown()).nullable(),
      truncated: z.boolean().optional(), note: z.string().optional(),
    }),
  },

  // ── PROPOSITION — n'écrivent QUE dans coach_proposals, en `pending` (invariants.test.ts) ────────
  {
    name: "propose_session",
    writes: true,
    description:
      "Propose creating or REPLACING the prescription of a single day (e.g. swap today's run for climbing). " +
      "Set replaces_session_id to overwrite an existing session. Does NOT write — the athlete confirms.",
    input: z.object({
      planned_date: isoDate,
      sport_code: z.string().describe("a code from available_sports"),
      title: z.string().max(200),
      description: z.string().optional(),
      system_tag: z.enum(SYSTEM_TAGS),
      intensity_zone: z.string().optional().describe("FR, e.g. « Z2 »"),
      target_duration_s: z.number().int().positive().optional(),
      target_distance_m: z.number().positive().optional(),
      target_vertical_m: z.number().nonnegative().optional(),
      expected_altitude_m: z.number().int().optional(),
      target_aerobic_load: z.number().nonnegative().optional(),
      target_neuromuscular_load: z.number().nonnegative().optional(),
      is_key: z.boolean().optional(),
      replaces_session_id: z.string().optional().describe("id (from read_plan) of the session to overwrite; omit to add"),
      forecast_note: z.string().optional().describe("one-line FR simulated impact (TSB veille, ACWR)"),
      rationale: z.string().describe("FR, why — shown on the card"),
    }),
    output: z.union([errorOut, z.object({ proposal_id: z.string(), summary: z.string(), status: z.string() })]),
  },
  {
    name: "propose_event",
    writes: true,
    description:
      "Propose declaring an athlete EVENT (race, big outing) on a date. regen_week=true reshapes the week " +
      "around it on accept. Does NOT write — the athlete confirms.",
    input: z.object({
      planned_date: isoDate,
      sport_code: z.string().describe("a code from available_sports"),
      title: z.string().max(200),
      description: z.string().optional(),
      target_distance_m: z.number().positive().optional(),
      target_vertical_m: z.number().nonnegative().optional(),
      target_duration_s: z.number().int().positive().optional(),
      expected_altitude_m: z.number().int().optional(),
      is_key: z.boolean().optional(),
      regen_week: z.boolean().optional().describe("true ⇒ regenerate the week plan around this event on accept"),
      forecast_note: z.string().optional(),
      rationale: z.string().describe("FR, why — shown on the card"),
    }),
    output: z.union([errorOut, z.object({ proposal_id: z.string(), summary: z.string(), status: z.string() })]),
  },
  {
    name: "propose_delete",
    writes: true,
    description: "Propose removing a planned session from the plan (it becomes skipped). The athlete confirms.",
    input: z.object({
      session_id: z.string().describe("id (from read_plan) of the session to remove"),
      rationale: z.string().describe("FR, why"),
    }),
    output: z.union([errorOut, z.object({ proposal_id: z.string(), summary: z.string(), status: z.string() })]),
  },
  {
    name: "propose_reshape",
    writes: true,
    description: "Propose regenerating the whole 7-day plan (e.g. the week drifted). On accept it runs the week regen.",
    input: z.object({ rationale: z.string().describe("FR, why") }),
    output: z.union([errorOut, z.object({ proposal_id: z.string(), summary: z.string(), status: z.string() })]),
  },
  {
    name: "propose_activity_edit",
    writes: true,
    description:
      "Propose correcting an ALREADY-LOGGED activity: set a perceived RPE (recomputes its load) and/or " +
      "re-label its sport. Get the activity from query_activities. The athlete confirms.",
    input: z.object({
      activity_id: z.string().describe("id of the logged activity"),
      perceived_rpe: z.number().int().min(1).max(10).optional().describe("1..10 — recomputes the session load via session_rpe"),
      sport_code: z.string().optional().describe("a code from available_sports — re-label the sport"),
      rationale: z.string().describe("FR, why"),
    }),
    output: z.union([errorOut, z.object({ proposal_id: z.string(), summary: z.string(), status: z.string() })]),
  },
];

/** Le catalogue envoyé à l'API, DÉRIVÉ des schémas — impossible de le désynchroniser du code. */
export const TOOLS = TOOL_SPECS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: z.toJSONSchema(t.input, { io: "input", target: "draft-7" }),
}));

const BY_NAME = new Map(TOOL_SPECS.map((t) => [t.name, t]));

/** Valide l'entrée d'un outil. En échec, renvoie un message AU MODÈLE, en français, qui dit quoi
 *  corriger — un outil qui lève n'apprend rien au modèle ; un outil qui explique lui permet de se
 *  rattraper au tour suivant. */
export function parseToolInput(
  name: string, input: unknown,
): { ok: true; value: any } | { ok: false; error: string } {
  const spec = BY_NAME.get(name);
  if (!spec) return { ok: false, error: `outil inconnu : ${name}` };
  const r = spec.input.safeParse(input ?? {});
  if (r.success) return { ok: true, value: r.data };
  const issues = r.error.issues.slice(0, 5).map((i) => {
    const path = i.path.length ? i.path.join(".") : "(racine)";
    return `\`${path}\` : ${i.message}`;
  });
  return {
    ok: false,
    error: `Arguments invalides pour ${name} — ${issues.join(" ; ")}. Corrige et rappelle l'outil.`,
  };
}

/** Vérifie la forme de la SORTIE. Un écart n'est pas une erreur du modèle mais un bug de code : on
 *  l'écrit dans les logs sans casser la conversation de l'athlète. */
export function checkToolOutput(name: string, output: unknown): string | null {
  const spec = BY_NAME.get(name);
  if (!spec) return null;
  const r = spec.output.safeParse(output);
  if (r.success) return null;
  const detail = r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(racine)"}: ${i.message}`).join(" ; ");
  console.warn(`[agent] sortie de ${name} hors contrat — ${detail}`);
  return detail;
}

export const WRITING_TOOLS = TOOL_SPECS.filter((t) => t.writes).map((t) => t.name);
export const READING_TOOLS = TOOL_SPECS.filter((t) => !t.writes).map((t) => t.name);
