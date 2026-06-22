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
invariant can never drift. Crucially the two channels are computed **independently and summed**, NOT
one number sliced by a fixed per-sport ratio: the aerobic channel comes from the cardiac engine
(power/HR/pace), the neuromuscular channel from stressors wearables can't see — the eccentric
**descent (D−)**, carried mass, and the impact of the locomotion. A long descent therefore adds real
neuromuscular cost *on top of* a calm-HR aerobic load instead of being invisible (the old "pick one
method, split by ratio" model under-counted descents — e.g. a 3000 m-D− trail scored below a smaller
hike). This is what lets the coach reason: a hard climbing day has low HR (low aerobic load) but high
neuromuscular load, so it still spends the next day's "hard" budget — the coach must not stack a hard
run on top just because HRV looks green.

Three stressable systems with different recovery kinetics (aerobic / neuromuscular-CNS /
structural-tissue) are tracked so the coach gates hard days on **both** the recovery composite
(HRV, sleep, RHR, Body Battery) **and** the load-channel history.

## Design system

The visual language mirrors this core idea: the logo's **blue→orange gradient is the two load channels**.
Blue (Alpine) = aerobic / fitness / fresh; orange (Summit) = neuromuscular / fatigue. Green·amber·red = the
readiness state; sports carry no colour. The full token system, rules, and do/don't live in
[`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) (binding for all `web/` work) — values in `web/src/app/globals.css`
(`@theme`), chart colours in `web/src/lib/theme.ts`.

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
- **`athlete_profile`** — single-row identity (name, birthdate, sex, height, weight) + physiological
  baselines (max_hr, lthr, resting_hr, hrv_baseline) + training preferences (`weekly_structure`,
  `constraints` jsonb). Edited from the **Profil** page (`web/src/app/profil/`); nothing re-syncs it.
- **`goals`** — flexible, **ranked, multi-sport** objectives (replaces the old single
  `athlete_profile.goal_*` columns, kept only for back-compat). `sport_id` is nullable (a goal need
  not target a sport); `priority_rank` orders them by the athlete's importance; the deadline is
  **optional and either** a structured `target_date` (drives days-to math) **or** a fuzzy
  `target_horizon` ("cette année", "avant mes 30 ans"). The coach reads them in priority order.
- **`integration_tokens`** — provider OAuth tokens. Strava is now connected from the **Profil** page
  (web OAuth → writes the `strava` row); `ingest/strava.py` reads the refresh token from here first
  (falling back to `STRAVA_REFRESH_TOKEN` in `.env`) and persists Strava's rotated token back. Garmin
  re-auth stays in the CLI (interactive MFA → `python-garminconnect`).

### The load ladder & the two channels

`sports.load_method_ladder` is ordered; `load.compute_load` walks it to pick the **aerobic-engine**
method — the first whose inputs are present, always ending in a fallback so no load is ever NULL:

`tss` (power) → `hrtss` (HR) → `rtss` (pace) → `vertical_duration` (no-HR mountain) → `grade_volume`
(climbing) → `tonnage_rpe` (strength) → `session_rpe` (RPE × duration) → `duration_fallback`.

`vertical_duration` is the **no-HR mountain estimate** (duration + ascent × carried-mass); it defers to
`hrtss` whenever HR is usable, so the climb's aerobic cost isn't double-counted. The chosen method's
points are the **aerobic** channel. The **neuromuscular** channel is then built additively and summed
(see `load.py`):

- **aerobic-engine sports** (run/bike/hike/swim…): `neuromuscular = impact_frac × aerobic + descent_term`,
  where `descent_term = (D− / 1000) × DESCENT_LOAD_PER_1000M × mass_factor` — independent of HR, so a big
  descent registers even when the heart stayed calm. `impact_frac` is the small HRV-blind cost of the
  locomotion itself (foot-strike, uphill muscular).
- **strength / technical sports** (`STRUCTURAL_EFFORT_GROUPS`): no aerobic engine, so the session effort
  (sRPE / grade / tonnage) is split aerobic : neuromuscular by taxonomy (mostly neuromuscular).

Coefficients (`DESCENT_LOAD_PER_1000M`, `IMPACT_FRAC`, `ASCENT_AEROBIC_PER_1000M`, the strength split) are
population starting points — calibrate per athlete (see "personalization"). After editing them, re-apply
to history with `python -m massif_ingest.sync --recompute-loads`.

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
- Weigh objectives in the athlete's **priority order** (`goals[]`); give richer, sport-specific
  feedback when a session matches a goal's sport; weight nearer deadlines (`days_to`) more, while
  honoring goals that carry only a fuzzy `horizon`.

## Deferred (documented future migrations / phases)

- **Effective-dated thresholds + bodyweight** (`athlete_thresholds`) so historical load is
  reproducible after a threshold/FTP change. Interim: snapshot the values used into
  `activities.sport_specific.computed_with`.
- **`training_blocks` / mesocycle parent** for `planned_sessions` (atomic week reshaping).
- **Multi-user accounts + Auth + RLS** before any public/cloud deploy (currently local-first,
  single-row `athlete_profile`, RLS off). Product vision: let several people (e.g. the author's
  roommates) each use the app in their own sports. The **Profil** UI is already account-ready
  (per-athlete fields + goals), but multi-tenancy requires an `athletes`/user concept, threading an
  `athlete_id` FK through `athlete_profile`/`goals`/`activities`/`daily_metrics`/`planned_sessions`,
  and RLS policies. Deferred intentionally — not implemented in the local-first phase.
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
6. Athlete profile (✅ Profil page: identity/personal/baselines/prefs + ranked multi-sport goals +
   Strava OAuth connect) + plan-edit UI + manual RPE.
7. Coach Brain (Claude) — daily briefing + plan reshaping.
8. Scheduling (cron → nightly.sh).
9. Migrate hosting → Vercel + personal Supabase cloud (+ auth/RLS).
