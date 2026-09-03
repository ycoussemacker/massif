# Massif

[![tests](https://github.com/ycoussemacker/massif/actions/workflows/tests.yml/badge.svg)](https://github.com/ycoussemacker/massif/actions/workflows/tests.yml)
[![agent evals](https://github.com/ycoussemacker/massif/actions/workflows/evals.yml/badge.svg)](https://github.com/ycoussemacker/massif/actions/workflows/evals.yml)

> Plusieurs sommets, un seul massif. Une app d'entraînement multi-sport personnelle qui lit tout ton
> sport comme un seul système adaptatif.

> 🇬🇧 **English version below** — see [Massif, in English](#massif-in-english).

Massif rassemble tes données **Strava** et **Garmin** dans un même store, calcule une **charge
d'entraînement unifiée sur tous les sports** (course, trail, rando, escalade, alpinisme, vélo,
renforcement…) et fait tourner un coach par-dessus : un briefing quotidien algorithmique, plus un
agent conversationnel qui répond aux questions ouvertes sur ton propre entraînement.

L'idée : chaque activité — même une séance de bloc ou une grosse rando, là où il n'y a pas d'allure et
où la fréquence cardiaque ment — produit **un** chiffre de charge comparable, séparé en deux canaux,
**aérobie** et **neuromusculaire/structurel**. Une grosse journée d'escalade fatigue donc correctement
la course du lendemain, et le coach n'empile jamais deux jours durs sur le même budget physiologique.

| Chemin | Quoi |
|---|---|
| `web/` | L'app Next.js — dashboard, chat coach, agenda, analyse. Héberge aussi le coach : `briefing-algo.ts` (briefing algorithmique) et `coach-chat.ts` (la boucle de l'agent) |
| `ingest/` | Ingestion et calcul de charge en Python (`massif_ingest`) |
| `coach/` | Le harnais de l'agent — CLI `ask`, évals, agrégat de traces. **[Lire `coach/README.md`](coach/README.md)** |
| `supabase/migrations/` | Le schéma Postgres (source de vérité) |
| `docs/ARCHITECTURE.md` | Conception et justifications — **commence par là** |
| `docs/MODEL_UPGRADES.md` | Journal de chaque évolution du modèle charge / fatigue / forme |
| `docs/AGENT_PLAN.md` | Plan de durcissement de l'agent |

## La frontière déterministe / agent

Deux natures de code cohabitent, et la séparation est délibérée.

**Le cœur déterministe.** Le calcul de charge, le rollup CTL/ATL/TSB/ACWR et le briefing quotidien
lui-même (`web/src/lib/briefing-algo.ts`) sont des fonctions ordinaires : même entrée, même sortie,
aucun appel de modèle. `buildAlgorithmicBriefing` — readiness, plan à 7 jours, phase de périodisation,
cadence de décharge, rampe de CTL — est **pur**, couvert par **31 tests**, et coûte **zéro token**. Un
plan du jour n'est pas un problème d'agent : c'est une fonction de la charge des 7 derniers jours, du
ratio aigu/chronique et de la récupération du matin.

**L'agent.** Une boucle d'outils (`web/src/lib/coach-chat.ts`) traite les questions dont le nombre et
l'ordre des lectures dépendent de la question elle-même. Dix outils : cinq lisent, cinq proposent.
Six itérations au plafond, contexte récent injecté en tête et mis en cache.

> **La règle :** si le nombre et l'ordre des lectures sont connus à l'avance, c'est une fonction.
> Sinon, c'est l'agent.

**Rien de ce que l'agent appelle ne mute l'état d'entraînement.** Les outils `propose_*` insèrent une
ligne `pending` dans `coach_proposals` — une intention, sans effet. La seule voie d'écriture vers
`planned_sessions` / `activities` est un clic humain sur la carte. Cet invariant est **prouvé par un
test** (`web/src/lib/agent/invariants.test.ts`), pas affirmé. L'agent porte aussi un garde-fou de
périmètre médical partagé par les trois prompts, et une suite de **26 évals** — trois familles, porte
dure à 100 % sur le refus médical en trois passes. Détail : **[`coach/README.md`](coach/README.md)**.

## Démarrage rapide

```bash
# 1. App web  (secrets : .env à la racine + web/.env.local)
pnpm -C web install
pnpm -C web dev                       # http://localhost:3100

# 2. Ingestion
python -m venv ingest/.venv && source ingest/.venv/bin/activate
pip install -e ingest
cp .env.example ingest/.env           # renseigner Strava + Garmin
python -m massif_ingest.sync          # 30 j de pull + recalcul du modèle

# 3. Base — les migrations passent par la CLI Supabase
supabase db push

# 4. Tests
ingest/.venv/bin/python -m pytest ingest/tests   # 74 — ingestion + modèle de charge
pnpm -C web test                                 # 68 — moteur, bornes, garde-fou, invariant
pnpm -C coach evals                              # 26 — évals de l'agent, sans appel API
```

## État

**En production** pour son unique athlète, sur Vercel (derrière un mot de passe, installable en PWA),
contre un projet Supabase cloud personnel. ~400 activités Strava depuis 2021, récupération Garmin, et
le coach en usage quotidien.

**Ce qui marche** — l'ingestion (Strava avec historique profond et synchro à la demande, récupération
Garmin) · le modèle de charge, une charge comparable par activité séparée en deux canaux, avec dix
évolutions documentées · le briefing quotidien, algorithmique et sans token en mode `free` · le coach
conversationnel, avec propositions validées par l'athlète · l'app web (dashboard, chat, agenda avec
fenêtres de contrainte, navigateur d'activités, comparaison de périodes, profil et objectifs classés).

**Ce qui n'est pas construit** — le **multi-utilisateur** (un seul athlète, RLS en deny-all à la clé
anon) · la **Phase 4 métriques** (découplage FC/allure, temps en zone) · **ni cron nocturne ni
notifications push**, retirés volontairement pour le coût et la fragilité : le briefing se génère à la
demande.

## Feuille de route

| # | Phase | État |
|---|---|---|
| 1 | Squelette — dépôt, schéma, Next.js, paquet Python | ✅ |
| 2 | Ingestion Strava | ✅ |
| 3 | Ingestion Garmin | ✅ |
| 4 | Métriques — découplage, temps en zone, affinage du modèle | 🟡 partiel — dix évolutions du modèle livrées ; découplage et temps en zone restent |
| 5 | Dashboard | ✅ |
| 6 | Profil, édition du plan, RPE manuel | ✅ profil, objectifs classés, agenda, RPE CR10 |
| 7 | Cerveau du coach | ✅ en production — durcissement suivi dans `docs/AGENT_PLAN.md` |
| 8 | Ordonnancement | ⛔ retiré — le cron nocturne a été remplacé par la génération à la demande |
| 9 | Hébergement — Vercel + Supabase cloud + RLS | ✅ mono-utilisateur ; l'auth multi-utilisateur reste à faire |

Projet personnel. Sans affiliation avec Strava, Garmin ou toute autre app citée.

---

<a name="massif-in-english"></a>

# Massif, in English

> Many summits, one massif. A personal multi-sport training app that reads all your sport as one
> adaptive system.

Massif pulls your **Strava** and **Garmin** data into one store, computes a **unified training
load across every sport** (running, trail, hiking, climbing, alpinism, cycling, strength… —
whatever you do), and runs a coach on top of it: an algorithmic daily briefing, plus a
conversational agent that answers the open questions about your own training.

The trick: every activity — even climbing or a big hike, where there's no pace and HR lies —
produces one comparable load number, split into an **aerobic** and a **neuromuscular/structural**
channel. So a hard bouldering day correctly fatigues tomorrow's run, and the coach never stacks
two hard days on the same physiological budget.

## Structure

| Path | What |
|---|---|
| `web/` | Next.js app — dashboard, coach chat, agenda, analysis (Next 16 · React 19 · Tailwind 4 · Supabase). Also hosts the coach: `briefing-algo.ts` (algorithmic briefing) and `coach-chat.ts` (the agent loop) |
| `ingest/` | Python ingestion + load computation (`massif_ingest`) |
| `coach/` | Agent harness — `ask` CLI, evals, trace aggregate. **[Read `coach/README.md`](coach/README.md)** |
| `supabase/migrations/` | Postgres schema (source of truth) |
| `docs/ARCHITECTURE.md` | Design & rationale — **start here** |
| `docs/MODEL_UPGRADES.md` | Log of every change to the load / fatigue / form model |
| `docs/AGENT_PLAN.md` | Plan for hardening the agent (typing, traces, evals, CI) |

## The deterministic / agent boundary

Two very different kinds of code live here, and the split is deliberate.

**The deterministic core.** Load computation (`ingest/massif_ingest/load.py` and its TypeScript
mirror), the CTL/ATL/TSB/ACWR rollup, and the daily briefing itself
(`web/src/lib/briefing-algo.ts`) are plain functions: same input, same output, no model call.
`buildAlgorithmicBriefing` — readiness, the 7-day plan, periodization phase, deload cadence, CTL
ramp — is pure, covered by **31 unit tests**, and costs **zero tokens**. A daily plan is not an
agent problem: it's a function of the last 7 days of load, the acute:chronic ratio and this
morning's recovery.

**The agent.** A tool-use loop (`web/src/lib/coach-chat.ts`) handles the questions where the number
and order of reads depend on the question itself — *"am I ready for that race in three weeks?"*,
*"why is tomorrow easy when I feel good?"*, *"my neuromuscular load spiked, is it the climbing or
the trail?"*. Ten tools: five read the athlete's data, five raise a **proposal**. Up to 8
iterations per turn, with the recent picture injected up front and cached.

> **The rule:** if the number and order of the reads are known in advance, it's a function.
> Otherwise it's the agent.

**Nothing the agent calls mutates training state.** The `propose_*` tools insert a `pending` row
into `coach_proposals` — an intent, inert. The only write path to `planned_sessions` / `activities`
is a human clicking *Accepter* on the proposal card. That invariant is **proved by a test**
(`web/src/lib/agent/invariants.test.ts`), not asserted: all ten tools run against a fake Supabase
client that throws on any write outside `coach_proposals`.

The agent also has a **medical-scope guardrail** shared by all three prompts, and an **eval suite** —
26 cases across three families (nominal, missing data, out of scope), with a hard 100 % gate on
medical refusal over three passes. See [`coach/evals/README.md`](coach/evals/README.md).

## Quickstart

```bash
# 1. Web app  (secrets: .env at the repo root + web/.env.local)
pnpm -C web install
pnpm -C web dev                       # http://localhost:3100

# 2. Ingestion
python -m venv ingest/.venv && source ingest/.venv/bin/activate
pip install -e ingest
cp .env.example ingest/.env           # fill Strava + Garmin creds
python -m massif_ingest.sync          # pull 30 d + roll up the fitness model

# 3. Database — migrations are applied with the Supabase CLI
supabase db push

# 4. Tests
ingest/.venv/bin/python -m pytest ingest/tests   # 74 — ingestion + load model
pnpm -C web test                                 # 68 — engine, read bounds, guardrail, write invariant
pnpm -C coach evals                              # 26 — agent evals, replayed model, zero API calls
```

## Status

**In production** for its single athlete on Vercel (password-gated, installable as a PWA), against a
personal Supabase cloud project. ~400 Strava activities since 2021, Garmin recovery, coach in daily
use.

**What works today**

- **Ingestion** — Strava (deep history + an in-app on-demand sync) and Garmin recovery (sleep, HRV,
  Body Battery, resting HR). 74 unit tests.
- **The load model** — one comparable `training_load` per activity, split into aerobic and
  neuromuscular channels, with ten documented upgrades (eccentric-descent trainability, heat &
  altitude, differential RPE, non-stationary recovery constants…).
- **The daily briefing** — algorithmic and token-free in `free` mode; in `ai` mode a single small
  cached model call re-voices three text fields in the athlete's chosen coach persona.
- **The conversational coach** — the agent loop above, with human-validated proposals for anything
  that would change the plan.
- **The web app** — dashboard, coach chat, calendar/agenda with constraint windows, activity
  browser, A-vs-B period analysis, profile & ranked goals.

**Not built yet**

- **Multi-user.** Single athlete, single profile row. RLS is on and denies everything to the anon
  key; per-user policies come with the multi-user epic.
- **Agent typing and tracing.** Zod schemas on the tool boundary and persisted execution traces are
  still to come — see [`docs/AGENT_PLAN.md`](docs/AGENT_PLAN.md). (The medical-scope guardrail, the
  write invariant, the eval suite and CI are done.)
- **Phase 4 metrics.** HR/pace decoupling and time-in-zone are still open; only the load-model side
  advanced.
- **No nightly cron, no push notifications.** Both retired on purpose — cost and fragility. The
  briefing is generated on demand instead.

## Roadmap

| # | Phase | State |
|---|---|---|
| 1 | Scaffold — repo, schema, Next.js, Python package | ✅ |
| 2 | Strava ingestion | ✅ |
| 3 | Garmin ingestion | ✅ |
| 4 | Metrics — decoupling, time-in-zone, load-model refinement | 🟡 partial — ten model upgrades shipped; decoupling and time-in-zone remain |
| 5 | Dashboard | ✅ |
| 6 | Profile, plan editing, manual RPE | ✅ profile, ranked goals, agenda, CR10 RPE |
| 7 | Coach brain | ✅ in production — hardening tracked in `docs/AGENT_PLAN.md` |
| 8 | Scheduling | ⛔ retired — the nightly cron was replaced by on-demand generation |
| 9 | Hosting — Vercel + Supabase cloud + RLS | ✅ single-user; multi-user auth still to come |

Personal project. Not affiliated with Strava, Garmin, or any named app.
