# Massif

[![tests](https://github.com/ycoussemacker/massif/actions/workflows/tests.yml/badge.svg)](https://github.com/ycoussemacker/massif/actions/workflows/tests.yml)
[![agent evals](https://github.com/ycoussemacker/massif/actions/workflows/evals.yml/badge.svg)](https://github.com/ycoussemacker/massif/actions/workflows/evals.yml)

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
| `coach/` | Agent harness — the read-only `ask` CLI today; the eval suite lands here |
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
