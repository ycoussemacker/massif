# L'agent Massif

> 🇬🇧 **English version below** — see [The Massif agent, in English](#the-massif-agent-in-english).

Le coach conversationnel de [Massif](../README.md) : une boucle d'outils Anthropic qui répond aux
questions ouvertes d'un athlète sur son propre entraînement. **10 outils typés, 6 itérations au
plafond, zéro écriture directe, 26 évals rejouées à chaque push.**

Ce dossier est la porte d'entrée ; le détail vit dans [`docs/AGENT_PLAN.md`](../docs/AGENT_PLAN.md)
(le plan de durcissement), [`coach/evals/README.md`](evals/README.md) (la méthode d'évaluation) et
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) (le système complet).

## 1. La frontière

```
DÉTERMINISTE (fonctions pures, testées)          │  AGENT (boucle d'outils)
──────────────────────────────────────────────── │ ────────────────────────────────
load.py / load.ts     calcul de charge           │  questions ouvertes
rollup                EWMA CTL/ATL/TSB/ACWR      │  diagnostic d'anomalie
briefing-algo.ts      readiness, plan 7 j,       │  explication du plan
                      phase, décharge, rampe     │  projection sur un objectif daté
project.ts            projection du modèle       │  arbitrage d'un scénario de vie
                                                 │
→ même entrée, même sortie · 31 tests · 0 token  │  → n lectures, ordre imprévisible
```

**Le critère de tri, en une phrase :** si le nombre et l'ordre des lectures sont connus à l'avance,
c'est une fonction ; sinon, c'est l'agent.

Le briefing du matin — readiness, séance du jour, plan de la semaine — n'est **pas** un problème
d'agent. C'est une fonction de la charge des 7 derniers jours, du ratio aigu/chronique et de la
récupération du matin. Le confier à un modèle donnerait un système plus lent, plus cher et moins
fiable, pour un résultat qu'on ne pourrait pas reproduire. Il est donc calculé par
`buildAlgorithmicBriefing`, pur et couvert par 31 tests.

## 2. Ce que l'agent fait, lui

Les questions où le nombre et l'ordre des lectures dépendent de la question :

> « Est-ce que je suis prêt pour l'Ossau dans trois semaines ? » · « Pourquoi ma séance de demain est
> en endurance alors que je me sens bien ? » · « J'ai une fenêtre de deux jours ce week-end, qu'est-ce
> que je peux faire ? » · « Ma charge neuromusculaire a explosé — c'est l'escalade ou le trail ? »

Chacune demande un nombre variable de lectures, croisées différemment. C'est précisément le cas où
une chaîne codée en dur ne tient pas.

## 3. Le catalogue — 10 outils

Les schémas Zod sont la **seule** définition : le JSON Schema envoyé au modèle en est dérivé
(`z.toJSONSchema`), donc le catalogue annoncé ne peut pas diverger de ce que le code accepte
([`web/src/lib/agent/schemas.ts`](../web/src/lib/agent/schemas.ts)).

**Lecture** — ne mutent rien.

| Outil | Entrée | Rôle |
|---|---|---|
| `query_activities` | `since, until, sport_code?, limit?` | Les activités d'une fenêtre, avec le partage aéro/neuro par séance |
| `query_daily_metrics` | `since, until` | Le modèle quotidien : CTL/ATL/TSB/ACWR, charge par canal, D± |
| `read_plan` | `from?, to?` | Le plan à venir **avec les vrais id** — de quoi viser une séance existante |
| `estimate_session` | `sport_code, title?, target_duration_s?, target_distance_m?, target_vertical_m?` | Ce que coûterait une séance hypothétique, d'après les efforts passés de l'athlète |
| `simulate_plan` | `horizon_days?, overrides?` | Projette la forme, référence vs scénario. La façon de répondre à « quand puis-je faire X ? » |

**Proposition** — écrivent une **intention**, jamais l'état d'entraînement.

| Outil | Entrée | Rôle |
|---|---|---|
| `propose_session` | `planned_date, sport_code, title, system_tag, rationale, …` | Créer ou **remplacer** la prescription d'un jour |
| `propose_event` | `planned_date, sport_code, title, rationale, regen_week?` | Déclarer une course ou un gros objectif |
| `propose_delete` | `session_id, rationale` | Retirer une séance du plan |
| `propose_reshape` | `rationale` | Régénérer la semaine entière |
| `propose_activity_edit` | `activity_id, perceived_rpe?, sport_code?, rationale` | Corriger une activité déjà enregistrée |

**Ce qui n'est délibérément PAS un outil.** Les objectifs classés, la phase de périodisation et les
fenêtres de contrainte sont déjà dans le contexte injecté en tête (et mis en cache). Un outil qui
irait chercher une constante serait une itération payée pour rien. Savoir ce qui ne doit pas être un
outil fait partie du métier.

## 4. La boucle et ses garde-fous

- **6 itérations au plafond.** Mesuré : les tours convergent en 1,6 en moyenne. Le dépassement est
  annoncé à l'athlète, jamais silencieux.
- **Échec d'outil = une valeur, pas une exception.** Une entrée invalide revient au modèle en
  français avec ce qu'il faut corriger (« `planned_date` : date au format YYYY-MM-DD attendue »), de
  sorte qu'il se rattrape au tour suivant. La sortie est validée aussi : un écart n'est pas une faute
  du modèle mais un bug de code — journalisé, sans casser la conversation.
- **Jamais de troncature muette.** Chaque lecture est bornée explicitement et, quand la borne mord, la
  réponse le DIT au modèle. Un outil qui rend 1000 lignes sur 1806 sans le signaler produit un coach
  qui affirme « ton volume s'est effondré » alors que ce sont les données qui manquent.
  ([`agent/limits.ts`](../web/src/lib/agent/limits.ts))
- **Périmètre médical.** Le coach n'établit ni ne **valide** de contenu médical ; refus cadré en une
  phrase, orientation vers un professionnel, puis il fait son travail sur la partie entraînement. La
  ligne difficile n'est pas le refus, c'est la nuance : l'app collecte la douleur musculaire et son
  modèle de charge est bâti sur la fatigue neuromusculaire, donc une courbature déclarée est une
  **donnée d'entraînement**, pas un symptôme. ([`agent/guardrails.ts`](../web/src/lib/agent/guardrails.ts))
- **Traces.** Une ligne par tour : question, outils appelés **avec leurs arguments**, itérations,
  réponse, tokens, coût, latence. `pnpm -C coach traces` en sort l'agrégat.

### L'invariant d'écriture, prouvé et non affirmé

> Aucun outil ne mute l'état d'entraînement. Les `propose_*` insèrent une ligne **`pending`** dans
> `coach_proposals` — une intention, sans effet. La seule voie d'écriture vers `planned_sessions` /
> `activities` est un clic humain sur la carte de proposition.

[`invariants.test.ts`](../web/src/lib/agent/invariants.test.ts) exécute les 10 outils contre un faux
client Supabase qui **lève à toute écriture** hors `coach_proposals`, vérifie que la ligne insérée
naît bien en `pending`, qu'aucun appel réseau ne s'échappe (un module qui se fabriquerait son propre
client échapperait au garde), et que les tentatives interdites laissent une trace **même si
l'appelant avale l'exception**.

Ce n'est pas théorique : le test a trouvé qu'`estimate_session` contournait le client injecté.

## 5. Une trace d'exécution réelle

Modèle réel, outils réels, sur la fixture d'évals — 3 itérations, 0,076 $, 31 s.

```
Q  « Si je fais une grosse sortie samedi, ça coûte quoi à ma séance clé de mardi ? »

1  estimate_session   {"sport_code":"trail_running","title":"Grosse sortie trail samedi",
                       "target_duration_s":14400,"target_distance_m":30000,"target_vertical_m":1800}
2  read_plan          {"from":"2026-09-02","to":"2026-09-09"}
3  simulate_plan      {"horizon_days":14,
                       "overrides":[{"date":"2026-09-06","aerobic":96,"neuro":30}]}
```

> **D'abord, un point de plan** : ta séance clé de la semaine c'est **vendredi 5 septembre** (Longue
> avec D+, charge cible 150), pas mardi. Mardi 3, c'est le seuil 3×8'.
>
> Scénario : grosse sortie samedi 6 (≈ 4 h, ~30 km, ~1800 D+). Charge estimée **~126** (aérobie 96 +
> neuro 30).
>
> | Moment | Sans la sortie | Avec |
> |---|---|---|
> | Veille séance clé ven. 5 | TSB −22, ACWR 1,56 | identique (sam. est après) |
> | Samedi 6 soir | TSB −22 | TSB **−36**, ACWR **1,84** ⚠️ |
> | Jour J (23 sept.) | TSB +21 | TSB **+14** |

L'enchaînement est le point : chiffrer la séance hypothétique, lire le plan **réel** pour en connaître
les identifiants, puis injecter la charge estimée dans une projection. Aucune chaîne codée d'avance ne
produit ça — et le coach corrige au passage la prémisse de la question.

## 6. Les évals

26 cas, trois familles. Méthode complète : [`evals/README.md`](evals/README.md).

**Où elles tournent, précisément.** À chaque push, `tests.yml` rejoue les 26 cas — modèle rejoué depuis les cassettes, **outils réels** — sans un token ; ça attrape une régression d'outil, pas une régression de routage. La campagne RÉELLE, elle, tourne chaque lundi (`evals.yml`) et à la demande : c'est la seule qui mesure le routage et la tenue du garde-fou.

**Dernière campagne réelle — 4 septembre 2026, 54 exécutions** (la famille périmètre en 3 passes).
Rapport versionné, donc vérifiable :
[`evals/runs/2026-09-04-live.json`](evals/runs/2026-09-04-live.json).

| Famille | Exécutions | Réussite |
|---|---|---|
| Nominal | 7 | 100 % |
| Données manquantes | 5 | 100 % |
| **Hors périmètre** | 42 | **100 %** — porte dure, 3 passes |

Jaccard outils 1,00 · outils interdits 0 · erreurs 0 · **1,81 itération** en moyenne (6 au maximum) ·
latence 13,5 s · **0,0218 $ par tour** · 21 709 tokens · 1,18 $ la campagne entière.

Deux choses valent d'être dites. La famille « hors périmètre » compte **12 refus attendus et 2
contrôles qui ne doivent surtout pas l'être** — sans eux, un garde-fou qui refuserait tout obtiendrait
100 % tout en rendant le produit inutilisable. Et une campagne antérieure (2 septembre) donnait 6/7 en
nominal : c'est de la **variance d'échantillonnage** sur un cas, exactement ce pour quoi ce seuil est
agrégé et pourquoi seule la sécurité a une porte dure vérifiée en trois passes. Un 100 % sur une
campagne ne veut pas dire que le prochain sera à 100 %.

On ne parle pas de déterminisme : une boucle LLM n'est pas reproductible au bit près et
`temperature: 0` n'y change rien. Ce qui est visé est une **reproductibilité sous tolérance** —
données et horloge figées, assertions ensemblistes, seuils agrégés.

## 7. Lancer

```bash
pnpm -C coach ask ["question"]   # CLI de questions-réponses (lecture seule)
pnpm -C coach evals              # 26 évals, modèle rejoué, aucun appel API
pnpm -C coach evals:live         # évals réelles
pnpm -C coach traces             # agrège les tours DÉJÀ tracés (vide tant que l'agent n'a pas tourné)
pnpm -C web test                 # 68 tests, dont l'invariant d'écriture et le garde-fou
```

L'agent lui-même vit dans `web/src/lib/` (`coach-chat.ts` + `agent/`), pas ici : c'est ce que Vercel
déploie, et `coach/` est le harnais qui l'exerce — CLI et évals — via un import relatif que `tsx`
résout sans bundler. Le raisonnement est en [D1 du plan](../docs/AGENT_PLAN.md).

---

<a name="the-massif-agent-in-english"></a>

# The Massif agent, in English

The conversational coach of [Massif](../README.md): an Anthropic tool-use loop answering an athlete's
open questions about their own training. **10 typed tools, a 6-iteration cap, zero direct writes, 26
evals in CI.**

**The boundary.** Load computation, the CTL/ATL/TSB/ACWR rollup and the daily briefing itself are
plain functions — same input, same output, no model call, 31 unit tests, zero tokens. The agent only
handles questions whose decision tree is open: *am I ready for that race in three weeks? why is
tomorrow easy when I feel good? my neuromuscular load spiked — climbing or trail?* The sorting rule:
**if the number and order of the reads are known in advance, it's a function; otherwise it's the
agent.** A daily plan is not an agent problem.

**The catalogue.** Five read tools (`query_activities`, `query_daily_metrics`, `read_plan`,
`estimate_session`, `simulate_plan`) and five proposal tools (`propose_session`, `propose_event`,
`propose_delete`, `propose_reshape`, `propose_activity_edit`) — full signatures in the French table
above. Zod schemas are the single definition; the JSON Schema sent to the model is derived from them,
so the advertised catalogue cannot drift from what the code accepts. Deliberately *not* a tool: goals,
periodization phase and constraint windows, which are already in the cached context — a tool that
fetches a constant is an iteration paid for nothing.

**Guardrails.** Six iterations max (measured mean: 1.6), overrun announced rather than silent · an
invalid input returns to the model in French saying what to fix, so it can recover next turn · every
read is explicitly bounded and *says so* when the bound bites — a tool returning 1000 rows out of 1806
without flagging it produces a coach that confidently claims your volume collapsed when only the data
is missing · a medical-scope guardrail that refuses to produce **or validate** medical content, with
the hard nuance that declared muscle soreness is *training data*, not a symptom, because this app
collects it and its whole load model is built on it.

**The write invariant, proved rather than asserted.** No tool mutates training state; `propose_*`
insert a `pending` row in `coach_proposals` — an intent, inert; the only write path to
`planned_sessions` / `activities` is a human clicking Accept.
[`invariants.test.ts`](../web/src/lib/agent/invariants.test.ts) runs all ten tools against a fake
Supabase client that throws on any write outside `coach_proposals`, asserts the inserted row is born
`pending`, traps the network so a self-built client cannot escape the guard, and records forbidden
attempts *even when the caller swallows the exception*. It already caught one real bypass.

**Evals — 2026-09-04, 54 runs**, versioned report at
[`evals/runs/2026-09-04-live.json`](evals/runs/2026-09-04-live.json). Out-of-scope 100 % (42/42, hard
gate over three passes) · missing data 100 % · nominal 100 % · zero forbidden tool calls · 1.81 mean
iterations · **$0.0218 per turn**. An earlier campaign scored 6/7 on nominal — sampling variance on
one case, which is exactly why that threshold is aggregate and only safety is a hard gate. The out-of-scope
family holds 12 expected refusals **and 2 controls that must not be refused** — without them a
guardrail that refused everything would score 100 % while making the product unusable. Method:
[`evals/README.md`](evals/README.md).

**Running it:** `pnpm -C coach evals` (replayed model, no API calls) · `evals:live` · `traces`
(aggregates the turns already traced — empty until the agent has run since the migration) · `ask`
(read-only Q&A CLI).
