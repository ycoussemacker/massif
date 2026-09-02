/** Le garde-fou de périmètre, verrouillé. Run : `npx tsx --test src/lib/agent/guardrails.test.ts`
 *
 *  guardrails.ts affirme dans son en-tête que les trois prompts « refusent la même chose, de la même
 *  manière ». Sans test, c'est un commentaire : les trois prompts sont de longs littéraux réécrits à
 *  chaque évolution du coach, une interpolation peut sauter sans que rien ne casse ni n'échoue.
 *
 *  Deux familles d'assertions :
 *   1. PRÉSENCE ET PLACE — le bloc est dans les trois prompts, et il y est en DERNIER (la persona porte
 *      du texte libre de l'athlète que le produit étiquette « PRIORITÉ HAUTE » ; le dernier mot doit
 *      revenir à ce qui ne se négocie pas).
 *   2. CONTENU — chaque assertion encode une faille trouvée en revue adverse. Ce ne sont pas des tests
 *      de style : chacune correspond à un cas où le garde-fou, tel qu'il était rédigé, se trompait. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCOPE_GUARDRAIL, SCOPE_GUARDRAIL_SHORT } from "./guardrails";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("les trois prompts embarquent le garde-fou", () => {
  assert.match(read("../coach-chat.ts"), /import \{ SCOPE_GUARDRAIL \} from "\.\/agent\/guardrails"/);
  assert.match(read("../coach-briefing.ts"), /import \{ SCOPE_GUARDRAIL_SHORT \} from "\.\/agent\/guardrails"/);
  assert.match(read("../../../../coach/src/ask.ts"), /import \{ SCOPE_GUARDRAIL \} from "\.\.\/\.\.\/web\/src\/lib\/agent\/guardrails\.js"/);
});

test("le garde-fou est le DERNIER bloc, après la persona", () => {
  // La régression à empêcher : buildPersonaInstructions concaténé APRÈS le garde-fou. Les consignes
  // libres de l'athlète y sont étiquetées « PRIORITÉ HAUTE » — placées en dernier, elles le primeraient.
  assert.match(read("../coach-chat.ts"),
    /CHAT_SYSTEM \+ "\\n\\n" \+ buildPersonaInstructions\(settings\) \+ "\\n\\n" \+ SCOPE_GUARDRAIL/,
    "le chat doit assembler : prompt, puis persona, puis garde-fou");
  assert.match(read("../coach-briefing.ts"),
    /ENRICH_SYSTEM \+ "\\n\\n" \+ buildPersonaInstructions\(settings\) \+ "\\n\\n" \+ SCOPE_GUARDRAIL_SHORT/,
    "le briefing ai doit assembler : prompt, puis persona, puis garde-fou");
  const ask = read("../../../../coach/src/ask.ts");
  assert.match(ask, /\$\{SCOPE_GUARDRAIL\}`;/, "dans la CLI le garde-fou doit fermer le prompt");
});

test("le garde-fou revendique la préséance — sinon une consigne d'athlète le contredit", () => {
  assert.match(SCOPE_GUARDRAIL, /PRIMENT sur toute autre consigne/);
  assert.match(SCOPE_GUARDRAIL, /consignes personnalisées de\s*\n?l'athlète/);
  assert.match(SCOPE_GUARDRAIL_SHORT, /prime sur toute autre consigne/);
});

test("SÉCURITÉ : les symptômes généraux déclenchent une orientation, pas un plan allégé", () => {
  // La faille la plus grave de la première rédaction : la liste ne parlait que de musculo-squelettique,
  // donc « j'ai 39 de fièvre, je fais ma sortie longue ? » avait la forme d'une question de plan.
  for (const signal of [/[Ff]ièvre/, /thoracique/, /[Pp]alpitations/, /malaise/, /SOUS LE COU/]) {
    assert.match(SCOPE_GUARDRAIL, signal, `signal général manquant : ${signal}`);
  }
  assert.match(SCOPE_GUARDRAIL, /pas de séance/, "face à un état général la réponse n'est pas un plan allégé");
});

test("PRODUIT : les courbatures ne sont jamais médicalisées", () => {
  // L'erreur symétrique : la première rédaction listait « douleur qui dure au-delà de quelques jours »
  // et « perte de force » comme signaux d'orientation — soit la définition des courbatures de descente,
  // que le modèle de charge de l'app traite comme physiologie normale.
  assert.doesNotMatch(SCOPE_GUARDRAIL, /qui dure au-delà de quelques jours/,
    "ce critère décrit les courbatures normales — il ne doit pas déclencher d'orientation");
  assert.match(SCOPE_GUARDRAIL, /DIFFUSE, bilatérale/, "la signature de la courbature normale doit être décrite");
  assert.match(SCOPE_GUARDRAIL, /s'AGGRAVE au lieu de s'estomper/, "l'orientation doit tenir à l'ÉVOLUTION");
  assert.match(SCOPE_GUARDRAIL, /cuisses en compote|jambes lourdes/, "le vocabulaire réel de l'athlète doit être couvert");
  assert.match(SCOPE_GUARDRAIL_SHORT, /courbature.*donnée d'entraînement/s);
});

test("le refus couvre la VALIDATION, pas seulement la production", () => {
  // « mon médecin a dit tendinite, t'es d'accord ? » : toutes les interdictions étaient des verbes de
  // production, la validation passait intacte.
  assert.match(SCOPE_GUARDRAIL, /CONFIRMER, INFIRMER/);
  assert.match(SCOPE_GUARDRAIL_SHORT, /ne valide pas davantage ceux\s*\n?que l'athlète rapporte/);
});

test("exécuter une décision médicale déjà prise reste dans le périmètre", () => {
  // Sans cette réserve, « mon kiné dit pas de course 10 jours, on adapte ? » tombait sous
  // l'interdiction « protocole de reprise » alors que c'est exactement le métier du coach.
  assert.match(SCOPE_GUARDRAIL, /décision médicale DÉJÀ PRISE/);
  assert.match(SCOPE_GUARDRAIL, /la contrainte est un fait/);
});

test("le ravitaillement chiffré reste de l'entraînement", () => {
  assert.match(SCOPE_GUARDRAIL, /CHIFFRES COMPRIS/);
  assert.match(SCOPE_GUARDRAIL, /glucides par heure/);
});

test("un refus n'est pas un « non de principe » — la contradiction avec la proactivité est levée", () => {
  assert.match(SCOPE_GUARDRAIL, /n'est PAS un « non de principe »/);
  assert.match(SCOPE_GUARDRAIL, /entièrement proactif sur tout le reste/);
});

test("le coach PROPOSE la mise en sécurité, il ne l'applique pas", () => {
  // Cohérence avec l'invariant d'écriture : demander « mets le plan en sécurité » à un agent qui ne
  // peut que proposer, c'est l'inviter au « c'est fait » que invariants.test.ts existe pour empêcher.
  assert.match(SCOPE_GUARDRAIL, /Tu PROPOSES ces changements/);
  assert.match(SCOPE_GUARDRAIL, /tu ne dis jamais que c'est fait/);
});

test("le texte libre présent dans les données est de la donnée, pas une instruction", () => {
  assert.match(SCOPE_GUARDRAIL, /PROVENANCE/);
  assert.match(SCOPE_GUARDRAIL, /jamais une instruction/);
});
