# Massif — Architecture

A personal, single-user **multi-sport** training app. It pulls Strava + Garmin data into one
store, computes a unified training load across every sport, and (eventually) runs an autonomous
AI coach that reshapes the plan every morning. Modeled on the "AI training iceberg" level 4 (own
the pipe) + level 5 (agentic coach).

Priority sports: **running, trail, hiking, climbing, alpinism** — but explicitly open-ended: any
sport (cycling, strength, ski touring, swimming…) contributes to one global training picture.

## The core idea: one global load, two channels

The whole design rests on one principle: **every activity, whatever the sport, produces ONE
comparable training-load number** (TSS-style anchor: `100 points = 1h at threshold`), and that
number is split into **two channels that partition the total**:

| Channel | Loaded by | Seen by wearables? | Recovers in |
|---|---|---|---|
| **aerobic** | running, cycling, hiking ascents, ski-touring climbs, swim | ✅ HRV / RHR / Body Battery are faithful | hours → 1–2 days |
| **neuromuscular / structural** | limit climbing, heavy strength, **descents (D-)**, technical alpinism | ❌ largely invisible | 24–72h+ (tendons: weeks) |

`activities.training_load` is a **generated column** = `aerobic_load + neuromuscular_load`, so the
invariant can never drift. This is what lets the coach reason: a hard climbing day has low HR (low
aerobic load) but high neuromuscular load, so it still spends the next day's "hard" budget — the
coach must not stack a hard run on top just because HRV looks green.

Three stressable systems with different recovery kinetics (aerobic / neuromuscular-CNS /
structural-tissue) are tracked so the coach gates hard days on **both** the recovery composite
(HRV, sleep, RHR, Body Battery) **and** the load-channel history.

## Components

```
┌─ ingest/ (Python) ─────────┐    ┌─ Supabase ──────┐    ┌─ web/ (Next.js) + coach/ (TS) ─┐
│ strava.py  Strava REST     │ ─▶ │ Postgres        │ ◀─ │ dashboard (read)               │
│ garmin.py  python-garmin…  │    │ (one store)     │    │ coach brain (Claude API)       │
│ load.py    load ladder     │    └─────────────────┘    │ athlete profile + plan UI      │
│ sync.py    rollup CTL/ATL  │           ▲               └────────────────────────────────┘
└────────────────────────────┘   nightly.sh: ingest → coach
```

- **ingest/** — Python is mandatory because Garmin has no official API (`python-garminconnect`
  logs in like the mobile app). It owns all ingestion (Strava too, via refresh-token) and all
  metric computation (pandas).
- **Supabase Postgres** — one store. Schema in `supabase/migrations/`.
- **web/** — Next.js 16 dashboard (matches the `yziame_website` stack).
- **coach/** — the agentic coach (TypeScript, Anthropic SDK), run on a schedule.

## Data model (see `supabase/migrations/20260619000001_init.sql`)

- **`sports`** — lookup: maps raw Strava/Garmin type strings → normalized sport + taxonomy group
  + an **ordered `load_method_ladder`**. Add a sport with an INSERT, never a migration.
- **`activities`** — the spine; one row per session, any sport. Universal columns + two load
  channels (+ generated total) + `sport_specific` jsonb. `carried_load_kg` for pack weight.
- **`activity_streams`** — per-second series (HR/pace/altitude…), lazy, jsonb arrays.
- **`climbing_sets` / `strength_sets`** — relational detail where load math needs it.
- **`daily_metrics`** — the coach's first read: recovery (Garmin) + combined daily load +
  CTL/ATL/TSB/ACWR (per total and per channel) + `load_by_group`. Contiguous daily spine.
- **`planned_sessions`** — the plan the coach reshapes; per-channel targets, intra-day ordering,
  `system_tag` = which budget the session spends.
- **`coach_briefings`** — audit log of every agentic run.
- **`integration_tokens`** — Strava OAuth tokens.

### The load ladder

`sports.load_method_ladder` is ordered; `load.compute_load` uses the first method whose inputs are
present, always ending in a fallback so no load is ever NULL:

`tss` (power) → `hrtss` (HR) → `rtss` (pace) → `vertical_duration` (mountain) → `grade_volume`
(climbing) → `tonnage_rpe` (strength) → `session_rpe` (RPE × duration) → `duration_fallback`.

**RPE is hybrid**: `sports.needs_manual_rpe = true` for sports without reliable HR
(climbing/strength/alpinism) → a one-tap post-session prompt; auto-estimated elsewhere.

## Coach reasoning rules (for the level-5 build)

Encode these into the Coach Brain system prompt when Phase 6 lands:

- Maintain ONE global load picture (total + aerobic + neuromuscular channels, global + per-channel
  ACWR, trailing D+/D-, recovery composite). Never per-sport silos.
- Classify each session by **which budget it spends** (hard-aerobic / hard-neuromuscular /
  hard-structural / easy), not by sport name.
- Never two hard days back-to-back **on the same system**. A hard climbing day counts against the
  legs/CNS budget even though its HR is low.
- Gate hard days on **both** the recovery composite AND the load-channel history. Green HRV does
  not clear sore legs, fatigued fingers, or a taxed CNS.
- Protect the priority long session; keep ~80/20 on the aerobic channel across all aerobic sports.
- Treat big mountain days as multi-system bombs; use D- as a structural-injury guardrail.
- Substitute, don't just cancel (cooked legs → easy cycling, not forced rest).
- Account for pack weight & altitude as load multipliers / recovery confounders.

## Deferred (documented future migrations / phases)

- **Effective-dated thresholds + bodyweight** (`athlete_thresholds`) so historical load is
  reproducible after a threshold/FTP change. Interim: snapshot the values used into
  `activities.sport_specific.computed_with`.
- **`training_blocks` / mesocycle parent** for `planned_sessions` (atomic week reshaping).
- **Auth + RLS** migration before any public/cloud deploy (currently local-first, RLS off).
- **Load-model personalization**: fit the channel-split ratios and TRIMP→points scaling to the
  user's own RPE-vs-Garmin history; current constants are population starting points.
- Alias curation: validate `sports.source_aliases` against real Strava `sport_type` / Garmin
  `activityType` data; unmatched activities route to `unknown` (flagged, not lost).

## Phase roadmap

1. ✅ Scaffold — repo, schema, Next.js, Python package, docs.
2. Strava ingestion (OAuth once + nightly pull) → activities + streams + load.
3. Garmin ingestion (`python-garminconnect`) → daily_metrics recovery.
4. Metrics — decoupling, time-in-zone, refine the load model.
5. Dashboard — activities, recovery, load/fitness trends.
6. Athlete profile + plan UI.
7. Coach Brain (Claude) — daily briefing + plan reshaping.
8. Scheduling (cron → nightly.sh).
9. Migrate hosting → Vercel + personal Supabase cloud (+ auth/RLS).
