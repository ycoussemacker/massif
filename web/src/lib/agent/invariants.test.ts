/** L'INVARIANT D'ÉCRITURE DE L'AGENT, prouvé par exécution.
 *  Run : `npx tsx --test src/lib/agent/invariants.test.ts`
 *
 *  L'énoncé, tel qu'il est défendu dans coach/README.md et docs/AGENT_PLAN.md :
 *
 *    « Aucun outil ne mute l'état d'entraînement. Les outils propose_* insèrent une ligne `pending`
 *      dans coach_proposals — une intention, sans effet. La seule voie d'écriture vers
 *      planned_sessions / activities est un clic humain sur la carte de proposition. »
 *
 *  Une affirmation dans un README ne vaut rien : le prochain outil ajouté pourrait écrire sans que
 *  personne ne s'en aperçoive. Ce fichier exécute donc les 10 outils contre un client Supabase qui LÈVE
 *  à la moindre écriture hors liste blanche, et vérifie qu'après le passage de l'agent les tables
 *  d'entraînement sont inchangées, octet pour octet.
 *
 *  Il ne fait AUCUN appel réseau : ni Supabase, ni Anthropic (le dispatch runTool est exercé
 *  directement, la boucle du modèle n'est pas dans le périmètre de cet invariant). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runTool, TOOLS } from "../coach-chat";
import { makeFakeSupabase, WriteViolation, type FakeDb } from "./fake-supabase";

// PIÈGE RÉSEAU. Le faux client ne voit que ce qui passe PAR LUI ; un module qui se fabrique son propre
// client Supabase (createServiceClient) lui échappe totalement — c'est le trou qu'avait `listActivities`,
// corrigé en rendant le client injectable. Pour que la correction ne se re-perde pas, on donne ici des
// variables d'environnement plausibles (sans quoi le test ne tenait que par l'accident que tsx ne charge
// pas .env) et on piège fetch : tout appel réseau est enregistré ET fait échouer le test.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://invariant.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "invariant-test-key";
const netCalls: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
  netCalls.push(url);
  throw new Error(`APPEL RÉSEAU INTERDIT pendant le test d'invariant : ${url}`);
}) as typeof fetch;

/** Les tables qui PORTENT l'état d'entraînement : les toucher change ce que l'athlète fera demain. */
const TRAINING_STATE = ["planned_sessions", "activities", "daily_metrics", "coach_briefings", "athlete_profile"];

const TODAY = "2026-09-01";

function seed(): FakeDb {
  return {
    sports: [
      { id: 1, code: "trail_running", taxonomy_group: "endurance" },
      { id: 2, code: "bouldering", taxonomy_group: "climbing" },
    ],
    activities: [
      { id: "act-1", local_date: "2026-08-30", sport_id: 1, training_load: 90, aerobic_load: 60,
        neuromuscular_load: 30, load_method_used: "hrtss", duration_s: 5400, distance_m: 14000,
        vertical_gain_m: 800, vertical_loss_m: 800, avg_hr: 148, perceived_rpe: null,
        rpe_source: "estimated", updated_at: "2026-08-30T18:00:00Z" },
    ],
    daily_metrics: [
      { local_date: "2026-08-30", daily_load: 90, daily_aerobic_load: 60, daily_neuromuscular_load: 30,
        ctl: 52, atl: 61, tsb: -9, acwr: 1.1, vertical_gain_m: 800, vertical_loss_m: 800,
        ctl_aerobic: 34, atl_aerobic: 40, ctl_neuromuscular: 18, atl_neuromuscular: 21 },
    ],
    planned_sessions: [
      { id: "plan-1", planned_date: "2026-09-02", order_in_day: 0, sport_id: 1, title: "Sortie Z2",
        system_tag: "easy", is_event: false, is_pinned: false, is_key: false, target_load: 55,
        target_aerobic_load: 45, target_neuromuscular_load: 10, target_duration_s: 3600,
        modified_by: "coach", status: "planned", linked_activity_id: null,
        updated_at: "2026-09-01T06:00:00Z" },
    ],
    athlete_load_params: [],
    athlete_profile: [{ id: 1, max_hr: 188, lthr: 178, resting_hr: 48, weight_kg: 64 }],
    coach_proposals: [],
    athlete_thresholds: [],
  };
}

/** Un jeu d'entrées réaliste par outil — y compris les cinq propose_*, ceux qui écrivent. */
const CALLS: { tool: string; input: Record<string, unknown> }[] = [
  { tool: "query_activities", input: { since: "2026-08-01", until: TODAY } },
  { tool: "query_daily_metrics", input: { since: "2021-01-01", until: TODAY } },
  { tool: "read_plan", input: { from: TODAY, to: "2026-09-14" } },
  { tool: "estimate_session", input: { sport_code: "trail_running", target_duration_s: 5400, target_vertical_m: 900 } },
  { tool: "simulate_plan", input: { horizon_days: 21, overrides: [{ date: "2026-09-06", aerobic: 120, neuro: 80 }] } },
  { tool: "propose_session", input: { planned_date: "2026-09-03", sport_code: "bouldering", title: "Bloc",
      system_tag: "hard_neuromuscular", rationale: "il fait trop chaud pour courir",
      replaces_session_id: "plan-1" } },
  { tool: "propose_event", input: { planned_date: "2026-10-11", sport_code: "trail_running",
      title: "Trail des Cimes", rationale: "objectif déclaré en chat", regen_week: true } },
  { tool: "propose_delete", input: { session_id: "plan-1", rationale: "semaine surchargée" } },
  { tool: "propose_reshape", input: { rationale: "la semaine a dérivé" } },
  { tool: "propose_activity_edit", input: { activity_id: "act-1", perceived_rpe: 8, rationale: "plus dur que prévu" } },
];

test("le catalogue exposé au modèle est exactement celui que le dispatch sait exécuter", () => {
  const declared = TOOLS.map((t: { name: string }) => t.name).sort();
  const exercised = CALLS.map((c) => c.tool).sort();
  assert.deepEqual(exercised, declared,
    "tout outil déclaré doit être exercé par ce test — sinon un nouvel outil pourrait écrire sans être vu");
});

test("AUCUN outil ne mute l'état d'entraînement", async () => {
  // Liste blanche : coach_proposals SEULE. Toute écriture ailleurs lève depuis le faux client.
  const fake = makeFakeSupabase(seed(), ["coach_proposals"]);
  const proposalIds: string[] = [];

  netCalls.length = 0;
  for (const { tool, input } of CALLS) {
    // Un tour plafonne à MAX_PROPOSALS_PER_TURN propositions ; ici on veut exercer les CINQ outils de
    // proposition, donc chacun part sur son propre tour (tableau neuf), et on cumule les intentions.
    const turn: string[] = [];
    const out = await runTool(fake.client as never, tool, input, tool.startsWith("propose_") ? turn : proposalIds);
    proposalIds.push(...turn);
    // NON-VACUITÉ : un outil qui renvoie { error } n'écrit rien, donc il satisferait l'invariant sans
    // rien prouver. On exige que chaque outil ait réellement parcouru son chemin nominal.
    assert.ok(!out?.error,
      `${tool} a échoué contre le faux client — le test ne prouverait plus rien : ${out?.error}`);
  }

  assert.deepEqual(fake.violations, [], "aucune écriture interdite ne doit avoir été TENTÉE");
  assert.deepEqual(netCalls, [],
    `aucun appel réseau ne doit sortir : un module qui se fabrique son propre client échapperait au ` +
    `faux client. Appels observés : ${netCalls.join(", ")}`);
  assert.deepEqual(fake.tablesWritten(), ["coach_proposals"],
    `seule coach_proposals doit être écrite ; obtenu : ${fake.tablesWritten().join(", ")}`);
  for (const t of TRAINING_STATE) {
    assert.equal(fake.writes().filter((w) => w.table === t).length, 0, `${t} doit rester intacte`);
  }
  assert.equal(proposalIds.length, 5, "les cinq propose_* doivent avoir enregistré une intention");
});

test("un tour ne peut pas inonder l'athlète de propositions", async () => {
  // Rien ne bornait le nombre de propose_* dans un tour : le modèle peut émettre plusieurs tool_use par
  // itération, sur 8 itérations. La consigne « une à deux propositions par tour » n'était que du prompt.
  const fake = makeFakeSupabase(seed(), ["coach_proposals"]);
  const turn: string[] = [];
  const mk = (d: string) => ({ planned_date: d, sport_code: "trail_running", title: "S", system_tag: "easy", rationale: "r" });
  const outs = [];
  for (const d of ["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]) {
    outs.push(await runTool(fake.client as never, "propose_session", mk(d), turn));
  }
  assert.equal(turn.length, 3, "au plus trois propositions enregistrées dans un tour");
  assert.ok(!outs[2].error, "la troisième passe encore");
  assert.match(String(outs[3].error), /attends sa réponse/, "la quatrième est refusée AU MODÈLE, clairement");
  assert.deepEqual(fake.violations, []);
});

test("une date de proposition malformée est refusée au modèle, pas transmise à la base", async () => {
  const fake = makeFakeSupabase(seed(), ["coach_proposals"]);
  for (const bad of ["demain", "2026-9-3", "", null]) {
    const out = await runTool(fake.client as never, "propose_session",
      { planned_date: bad, sport_code: "trail_running", title: "S", system_tag: "easy", rationale: "r" }, []);
    assert.match(String(out.error), /YYYY-MM-DD/, `date « ${bad} » : le modèle doit pouvoir se corriger`);
  }
  assert.equal(fake.ops.filter((o) => o.verb === "insert").length, 0, "aucune insertion sur date invalide");
});

test("l'invariant tient aussi sur les VARIANTES d'entrée des outils qui écrivent", async () => {
  // Chaque outil n'était exercé qu'avec UN jeu d'entrées : une écriture cachée derrière une branche
  // (proposition sans séance à remplacer, édition d'activité par sport plutôt que par RPE…) serait
  // restée invisible. On repasse les propose_* par leurs autres chemins.
  const fake = makeFakeSupabase(seed(), ["coach_proposals"]);
  const variants: { tool: string; input: Record<string, unknown> }[] = [
    { tool: "propose_session", input: { planned_date: "2026-09-05", sport_code: "trail_running",
        title: "Ajout sans remplacement", system_tag: "easy", rationale: "jour libre" } },
    { tool: "propose_event", input: { planned_date: "2026-11-02", sport_code: "trail_running",
        title: "Sans régénération", rationale: "objectif secondaire", regen_week: false } },
    { tool: "propose_activity_edit", input: { activity_id: "act-1", sport_code: "bouldering",
        rationale: "mauvais sport détecté" } },
    { tool: "propose_session", input: { planned_date: "2026-09-06", sport_code: "trail_running",
        title: "Cible chiffrée", system_tag: "hard_aerobic", rationale: "seuil",
        target_aerobic_load: 90, target_neuromuscular_load: 15, is_key: true } },
  ];
  for (const { tool, input } of variants) {
    const out = await runTool(fake.client as never, tool, input, []);
    assert.ok(!out?.error, `${tool} (variante) : ${out?.error}`);
  }
  assert.deepEqual(fake.violations, []);
  assert.deepEqual(fake.tablesWritten(), ["coach_proposals"]);
});

test("une proposition est écrite en PENDING — c'est ce qui la rend inerte", async () => {
  // L'invariant littéral est « insèrent une ligne pending ». La liste blanche est par TABLE : sans cette
  // assertion, un futur insert avec status:'accepted' passerait le test tout en s'appliquant.
  const fake = makeFakeSupabase(seed(), ["coach_proposals"]);
  await runTool(fake.client as never, "propose_session", {
    planned_date: "2026-09-04", sport_code: "trail_running", title: "Z2", system_tag: "easy",
    rationale: "récup",
  }, []);
  const inserts = fake.ops.filter((o) => o.verb === "insert" && o.table === "coach_proposals");
  assert.equal(inserts.length, 1);
  const row = inserts[0].payload as Record<string, unknown>;
  assert.ok(!("status" in row) || row.status === "pending",
    `une proposition ne doit jamais naître autrement qu'en attente ; status = ${String(row.status)}`);
});

test("le faux client détecte bien une écriture interdite (le test se teste lui-même)", async () => {
  // Sans ce contre-test, un faux client silencieusement cassé ferait passer l'invariant pour vrai.
  const fake = makeFakeSupabase(seed(), ["coach_proposals"]);
  assert.throws(() => fake.client.from("planned_sessions").update({ status: "skipped" }).eq(),
    WriteViolation, "une écriture sur planned_sessions DOIT lever");
  assert.throws(() => fake.client.from("activities").insert({}), WriteViolation);
  assert.doesNotThrow(() => fake.client.from("coach_proposals").insert({ kind: "session" }));

  // Le cas qui rendait le harnais complice : l'exception avalée par l'appelant.
  const swallow = makeFakeSupabase(seed(), ["coach_proposals"]);
  try { swallow.client.from("planned_sessions").update({ status: "skipped" }).eq(); } catch { /* avalée */ }
  assert.equal(swallow.violations.length, 1,
    "une écriture interdite doit laisser une trace MÊME si l'appelant avale l'exception");
  assert.throws(() => swallow.client.rpc("apply_plan"), WriteViolation, "rpc() est aussi une écriture");
});

test("une proposition reste INERTE : le plan est inchangé après son enregistrement", async () => {
  const db = seed();
  const planBefore = JSON.stringify(db.planned_sessions);
  const actsBefore = JSON.stringify(db.activities);
  const fake = makeFakeSupabase(db, ["coach_proposals"]);
  const ids: string[] = [];

  // Le cas le plus intrusif du catalogue : remplacer la séance du jour, supprimer une séance, et
  // corriger une activité déjà enregistrée. Aucun des trois ne doit rien changer avant validation.
  await runTool(fake.client as never, "propose_session", {
    planned_date: "2026-09-02", sport_code: "bouldering", title: "Bloc", system_tag: "hard_neuromuscular",
    rationale: "chaleur", replaces_session_id: "plan-1",
  }, ids);
  await runTool(fake.client as never, "propose_delete", { session_id: "plan-1", rationale: "repos" }, ids);
  await runTool(fake.client as never, "propose_activity_edit", { activity_id: "act-1", perceived_rpe: 9, rationale: "dur" }, ids);

  assert.equal(JSON.stringify(db.planned_sessions), planBefore, "planned_sessions doit être inchangée");
  assert.equal(JSON.stringify(db.activities), actsBefore, "activities doit être inchangée");
  assert.equal(ids.length, 3, "les trois propositions doivent être enregistrées comme intentions");
});

test("une proposition annonce son statut d'attente au modèle, pour qu'il ne dise pas « c'est fait »", async () => {
  const fake = makeFakeSupabase(seed(), ["coach_proposals"]);
  const out = await runTool(fake.client as never, "propose_session", {
    planned_date: "2026-09-03", sport_code: "trail_running", title: "Seuil", system_tag: "hard_aerobic",
    rationale: "phase de charge",
  }, []);
  assert.ok(out.proposal_id, "la proposition doit rendre un id");
  assert.match(String(out.status), /attente de la validation/i);
  assert.match(String(out.status), /ne dis pas qu'elle est appliquée/i);
});

test("le module de l'agent ne contient aucun verbe d'écriture (garde anti-dérive)", () => {
  // Complément statique du test d'exécution : si quelqu'un ajoute demain un `.update()` dans un outil,
  // le test d'exécution le voit — mais seulement si l'outil est dans CALLS. Celui-ci le voit toujours.
  const src = readFileSync(new URL("../coach-chat.ts", import.meta.url), "utf8");
  const writes = [...src.matchAll(/\.(insert|update|upsert|delete)\s*\(/g)].map((m) => m[1]);
  assert.deepEqual(writes, [],
    `coach-chat.ts ne doit contenir aucune écriture directe (trouvé : ${writes.join(", ")}). ` +
    `Les écritures de proposition passent par coach-proposals.ts, confiné à coach_proposals.`);
});

test("les écritures de coach-proposals.ts ne visent que coach_proposals", () => {
  const src = readFileSync(new URL("../coach-proposals.ts", import.meta.url), "utf8");
  // Pour chaque verbe d'écriture, la table est le `.from("…")` qui le précède immédiatement.
  const re = /\.from\("([a-z_]+)"\)\s*(?:\r?\n\s*)?\.(insert|update|upsert|delete)\s*\(/g;
  const targets = [...src.matchAll(re)].map((m) => m[1]);
  assert.ok(targets.length > 0, "le module doit bien contenir les écritures de proposition");
  assert.deepEqual([...new Set(targets)], ["coach_proposals"],
    `les propositions ne doivent écrire que dans coach_proposals ; trouvé : ${[...new Set(targets)].join(", ")}`);
});
