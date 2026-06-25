# Massif — guide for Claude

Personal, **single-user, multi-sport** training app. Pulls Strava + Garmin into one Supabase
store, computes a unified cross-sport training load, and (later) runs an agentic AI coach that
reshapes the plan each morning. Read `docs/ARCHITECTURE.md` first — it holds the design rationale.

## Stack
- **web/** — Next.js 16 (App Router, `src/`) · React 19 · Tailwind 4 · TypeScript · pnpm.
  Supabase via `@supabase/ssr` (`web/src/lib/supabase/{client,server}.ts`, mirrors `yziame_website`).
  **Design system is BINDING — read `docs/DESIGN_SYSTEM.md` before any UI work.** TL;DR: colour encodes
  *physiology, never category* — **Alpine** (blue, `alpine-*`/`aerobic`) = aerobic/fitness/fresh, **Summit**
  (orange, `summit-*`/`neuro`) = neuromuscular/fatigue, green·amber·red (`ready`/`caution`/`rest`) = readiness
  only; sports are glyph+name, never coloured. Tokens live in `web/src/app/globals.css` (`@theme`); chart/SVG
  colours import from `web/src/lib/theme.ts` (`VIZ`/`STATE`/`AXIS`/`MUTED`). **Never** write a raw hex or a
  `sky-*`/`blue-*`/`orange-*` class in a component. Neutral = `stone`; canvas = `bg-page` (warm paper); type =
  Geist (`font-sans`/`font-mono`), every number `tabular-nums`; bordered-not-shadowed; the `bg-massif` gradient
  is reserved for the primary coach CTA only.
- **ingest/** — Python ≥3.11 package `massif_ingest` (Strava REST + `python-garminconnect` + pandas).
- **coach/** — TypeScript (Anthropic SDK). Phase-7 MVP: daily briefing `pnpm -C coach coach` (writes
  `coach_briefings` + `planned_sessions`); interactive Q&A `pnpm -C coach ask ["question"]` (read-only).
  Shared data assembly in `coach/src/context.ts`.

**Phase 5 (Dashboard) MVP built + verified** in `web/` — server-component page (`web/src/app/page.tsx`,
data in `web/src/lib/data.ts`, dependency-free SVG charts in `web/src/components/charts.tsx`) reading
via the service-role client (RLS now ON; service-role bypasses it). Shows: latest coach briefing, CTL/ATL/TSB/ACWR tiles,
fitness/form/per-channel-load charts, Garmin recovery, recent activities. Runs on `pnpm -C web dev`
→ **http://localhost:3100** (port pinned to dodge the parallel work project on 3000). Both `web/` and
`coach/` need their `pnpm-workspace.yaml` `allowBuilds` set (sharp/unrs-resolver for web, esbuild for
coach) or pnpm blocks the run. Next: Phase 8 (nightly cron), Phase 6 (plan UI + RPE), Phase 4 (metrics).
- **supabase/** — SQL migrations (source of truth for the schema).
- **DB** — Supabase Postgres. Local-first for now; a personal Supabase **cloud** project will be
  provisioned (org separate from the company "AFOODI V0" org).

## The one thing to understand
Every activity gets ONE comparable `training_load`, split into two channels that PARTITION it:
`training_load` is a **generated column = aerobic_load + neuromuscular_load`. The coach reasons on
both channels + recovery, because climbing/strength load the neuromuscular/structural system that
HRV/Body Battery can't see. Don't break this invariant; write the two channels, never the total.
The channels are computed **independently and summed** (not one method's points sliced by a fixed
ratio): aerobic = the cardiac engine (power/HR/pace); neuromuscular = an independent **eccentric
descent (D−)** term + carried-mass + impact (strength/climbing instead split their sRPE effort). So a
big descent adds real neuromuscular cost on top of a calm-HR aerobic load. See `load.py` + ARCHITECTURE.md.

## Conventions & gotchas
- **Strava**: read `sport_type`, NOT the legacy `type` (it returns 'Ride' for road/gravel/MTB/ebike
  and 'Run' for road/trail). `sports.source_aliases` map provider strings → sport; unmatched →
  `unknown` (flagged). Strava 'Workout' is a generic catch-all → maps to `unknown`, not strength.
- **Garmin**: no official API. `python-garminconnect`; tokens cached in `GARMIN_TOKEN_DIR`
  (`~/.garminconnect`) — **never commit them** (gitignored). For the **cloud cron** (no Mac), the
  token blob is mirrored into Supabase `integration_tokens.data` (`provider='garmin'`) and rehydrated
  in CI: `garmin.hydrate_token` writes the file before login, `garmin.persist_token` saves any
  refresh-rotation back. Seed once from the Mac: `sync --export-garmin-token`. If the refresh token
  ever expires → redo an interactive MFA login locally, then re-export.
- **Load**: `sports.load_method_ladder` is ordered; `load.compute_load` picks the first method
  whose inputs exist as the AEROBIC engine, then adds the neuromuscular channel additively (descent
  D− + impact; strength/climbing split their sRPE). Coefficients in `load.py` (`DESCENT_LOAD_PER_1000M`,
  `IMPACT_FRAC`, `ASCENT_AEROBIC_PER_1000M`) are population starting points — TODO to personalize.
  After editing them, re-score history: `python -m massif_ingest.sync --recompute-loads`
  (re-applies the model to all stored activities from their persisted fields, then rolls up — no
  provider re-pull). `web/src/lib/load.ts` now MIRRORS the FULL `compute_load` (the `computeLoad`
  export + the whole method ladder, not just session_rpe), and `web/src/lib/rollup.ts` mirrors
  `rollup_daily_metrics`'s EWMA — both power the on-demand TS sync (see Status). Python stays the
  source of truth (the nightly cron recomputes identically); KEEP load.ts/rollup.ts in sync with
  load.py/sync.py — parity verified on real data (395/395 activities, latest CTL exact).
- **RPE hybrid**: `needs_manual_rpe=true` sports prompt for a post-session RPE; others auto-estimate.
- **daily_metrics** is written by two column-scoped upserts (load rollup vs Garmin recovery) keyed
  on `local_date` — they must not include each other's columns. The rollup writes a contiguous
  daily spine (zero-load rest days included) so the EWMAs have no gaps.
- **PostgREST 1000-row cap** (bit us once): the cloud project caps each REST response at **1000 rows**.
  An *unbounded* `.order(…,{ascending:true})` silently returns only the OLDEST 1000 — the `daily_metrics`
  spine (>1000 days) stopped ~2 years back, freezing the dashboard charts + CTL/ATL tiles at that date.
  Always BOUND history reads by date range (the dashboard uses a rolling 2-month window
  `DASHBOARD_WINDOW_MONTHS`; `/analyse` bounds to the compared range) or page via `.range()`.
- **RLS** is now **ON** (migration `…0001_enable_rls`): every public table has RLS enabled with NO
  anon/authenticated policy → deny-all to the publishable/anon key (verified live: anon read `[]`,
  write `42501`). The app is unaffected — all reads/writes go through the **service-role** server
  client (`createServiceClient`), which has BYPASSRLS. Per-user policies (`auth.uid()=athlete_id`)
  come with the multi-user epic (Phase 9); until then deny-all is correct for a single-user, server-only app.
- Secrets via `.env` (root) / `ingest/.env`; see `.env.example`. `COACH_MODEL` defaults to
  `claude-sonnet-4-6` (bump to `claude-opus-4-8` for heavy analyses).

## Run
**Prod:** web on Vercel → `https://massif-omega.vercel.app` (Vercel Root Directory = `web`; login gate
via `APP_PASSWORD`/`AUTH_SECRET`). **NO cron + NO web push** (retired — see the on-demand-briefing status
below): the briefing is generated ONLY on demand in the web app; data stays fresh via on-demand Strava
pull-to-refresh + the throttled Garmin refresh (`garmin-refresh.yml`, fired by `GarminAutoRefresh` on app
open). Full runbook: `ops/PHONE_ACCESS.md`.
```bash
# web (local dev)
pnpm -C web dev                              # http://localhost:3100  (port pinned off 3000)

# ingest (venv at ingest/.venv; pip install -e ingest)
python -m massif_ingest.sync                 # pull Strava+Garmin (30d) + rollup CTL/ATL/TSB
python -m massif_ingest.sync --skip-pull     # recompute the daily fitness model only
python -m massif_ingest.sync --recompute-loads                   # re-apply load.py to all activities, then roll up
python -m massif_ingest.sync --strava-days 3650 --stream-days 90 # deep history backfill (rate-limit-safe)
python -m massif_ingest.sync --export-garmin-token               # mirror the local Garmin token to Supabase

# coach
pnpm -C coach ask ["question"]               # read-only Q&A CLI (the daily briefing is now ON-DEMAND in web/, not a CLI/cron)

# supabase
supabase db push                             # apply migrations to cloud (CLI ONLY, never the MCP)
```

## Status
Phase 1 done **and** migrations applied to the personal Supabase **cloud** project
`yxoxvktfrlavsqcfcxmp` (its account is separate from the AFOODI MCP org — drive Massif's DB with the
Supabase **CLI** only, *never* the MCP, which is reserved for the parallel work project). Env wired
(`.env` at root + `web/.env.local`; uses new `sb_publishable_…`/`sb_secret_…` keys); ingest venv at
`ingest/.venv` (`pip install -e ingest`, dev extra adds pytest), verified reading the 22 seeded
sports from cloud.

**Phase 2 (Strava) + Phase 3 (Garmin) ingestion now implemented** in `ingest/massif_ingest/`
(`strava.sync`/`garmin.sync` are wired; pure helpers `_build_activity_row` / `_normalize` are
unit-tested). Migration `…0003` made `activities_source_uniq` unconditional — the original PARTIAL
index could not be inferred as an ON CONFLICT arbiter, so every upsert errored 42P10 (fixed +
verified by a real double-upsert dedupe against cloud). Tests: `ingest/.venv/bin/python -m pytest
ingest/tests` (19, all offline/pure). Garmin's `_normalize` is defensive guesswork, tuned against the first real pull.

**Now running live** against cloud: Strava (19 activities, athlete 66964703) + Garmin recovery
(sleep/HRV/Body Battery/RHR) + `athlete_profile` populated (max_hr 188, lthr 178, resting_hr 48,
weight 64; goal Roubion-Nice 100K on 2026-09-24 — lthr/vo2max pulled from Garmin). Load is now
HR-driven: `hrtss` for runs/trail, `vertical_duration` for hikes; climbing/surf stay
`duration_fallback` until a manual RPE is entered (no RPE UI yet). Unknown provider sport_types now
**auto-create** a conservative `taxonomy_group='other'` sport via `db.get_or_create_sport` (alias
attached) instead of routing to `unknown`; `Workout` still maps to `unknown`. Garmin login gotcha:
the FIRST login must be interactive (MFA prompt) and Garmin **429-rate-limits repeated logins** — once
the token caches in `~/.garminconnect`, runs are unattended. Tests: `ingest/.venv/bin/python -m
pytest ingest/tests` (20).

**Phase 7 (Coach Brain) MVP built + verified live** in `coach/` (TypeScript, `@anthropic-ai/sdk`,
run with `pnpm -C coach coach`; reads `COACH_MODEL`). It assembles the ONE unified picture
(per-channel CTL/ATL/TSB + ACWR, trailing D±, Garmin recovery, recent sessions, goal/days-to-race),
calls Claude with adaptive thinking + a structured-output briefing schema, then writes
`coach_briefings` (audit) and replaces today's coach `planned_sessions` row (idempotent per day). The
system prompt encodes the level-5 rules from `docs/ARCHITECTURE.md`, and generates all free text in
**French** (the `system_tag` values stay the English DB enum — identifiers — and are translated for
display in `web/`). `ask.ts` likewise answers in French. First real run nailed it: flagged
a neuromuscular-channel overload (descent-driven, wearable-blind) → red/rest. Note: pnpm 11 needs
`coach/pnpm-workspace.yaml` (`allowBuilds: esbuild: true`) so tsx's esbuild binary builds.
**Phase 8 (nightly) done.** `nightly.sh` (repo root) runs Strava+Garmin pull → rollup → coach
briefing unattended — it sets its own PATH (node is fnm-managed; python via the venv's absolute path)
and reads secrets from `.env`, verified under a stripped `env -i`. The morning run is **event-driven**:
`morning.sh` (the poller, scheduled by launchd every 30 min 06:30–09:30 via `ops/io.massif.nightly.plist`)
fires `nightly.sh` once `garmin.sleep_ready()` shows last night's sleep is finalized (so the briefing
uses that morning's recovery), forces at 09:30 otherwise, and self-gates with a per-day marker
`logs/.done-YYYY-MM-DD`. No usable Garmin push API for personal use → polling is the practical trigger.
Logs to `logs/` (gitignored). Garmin must have been logged in once interactively first (cached token).
**Phase 6 (manual RPE) started:** the dashboard logs a post-session RPE on `needs_manual_rpe`
activities (`web/src/components/rpe.tsx` → server action `web/src/app/actions.ts`), recomputing that
session's load via session_rpe (`web/src/lib/load.ts` MIRRORS `load.py` — keep in sync; parity
verified) and setting `rpe_source='user'`. `strava.sync` re-applies user RPEs on every pull
(`db.load_user_rpes`) so they survive re-syncs; charts/CTL refresh on the next rollup.
GOTCHA fixed: the last `daily_metrics` row is often a Garmin recovery-only upsert (CTL/ATL/TSB null
past the last activity) — dashboard (`latestModel`) and coach (`context.ts`) now use the last row
WITH a computed model, and the dashboard reads the latest briefing by `created_at`.
Dashboard polished: time-series charts scroll horizontally (newest-first, `web/src/components/scroll-right.tsx`),
sport icons + FR names + climbing-discipline labels, colour-coded recovery tiles (FC repos / VFC vs the
athlete's baseline, sensible thresholds elsewhere), and `?` help tooltips (with the "points de charge"
unit ≈ 1 h at threshold). Climbing discipline (bloc / voie salle / falaise) is inferred in `strava.py`
(`_climbing_sport_code`) from the activity name + description (`fetch_activity_detail` — the summary
lacks description), defaulting to indoor route → maps to bouldering / indoor_climbing / rock_climbing.
**Phase 6 (Profil page) built:** `web/src/app/profil/` (route + `actions.ts`) with `web/src/lib/profile.ts`
(reads) and components `profile-form` / `goals-editor` / `connections` (+ shared `nav` + `goal-badge`).
Edits identity/personal/baselines/prefs on the single `athlete_profile` row, and manages **ranked,
multi-sport `goals`** (new table, migration `…0002`; the old single `goal_*` columns were backfilled into
it and are no longer read). Deadlines are optional: structured `target_date` (→ J−N) OR fuzzy
`target_horizon` ("avant mes 30 ans"). Dashboard + coach headers now show the rank-1 goal (`GoalBadge`),
and the coach context (`coach/src/context.ts` ↔ `web/src/lib/coach-context.ts`, kept in MIRROR) passes the
ranked `goals[]` + `primary_goal`; the 3 coach prompts (coach.ts/ask.ts/coach-chat.ts) reason in priority
order, give sport-specific feedback when a session matches a goal's sport, and weight nearer deadlines.
**Strava connect from the UI:** Profil → "Connecter Strava" runs the OAuth flow (`web/src/app/api/strava/
{authorize,callback}/route.ts`) and writes `integration_tokens`; `ingest/strava.get_access_token` now reads
the refresh token from `integration_tokens` first (fallback `.env` STRAVA_REFRESH_TOKEN) and persists the
rotated token (`db.load/save_integration_token`). Needs `STRAVA_CLIENT_ID/SECRET` in `web/.env.local` (copied
from root `.env`) and the Strava app callback domain = `localhost`. Garmin re-auth stays CLI/MFA; the panel
shows connection freshness (last Strava activity / last Garmin recovery). Tests: 26 (added token-precedence).
Multi-user (colocs) is NOT built — single-row profile; hosting will need accounts + `athlete_id` + RLS (see
ARCHITECTURE.md). Next: Phase 6 plan-edit UI, Phase 4 (metrics), Phase 9 (hosting + auth/RLS). Don't commit unless asked.

**PHONE ACCESS + PRODUCTION shipped (no Mac required).** The app is LIVE on Vercel
(`massif-omega.vercel.app`, Root Directory `web`) behind a single-password gate (`web/src/proxy.ts` —
Next 16 `proxy` convention, NOT the deprecated `middleware`; HMAC cookie in `web/src/lib/auth.ts`;
`APP_PASSWORD`/`AUTH_SECRET`, gate OFF locally when unset). Installable **PWA** (`web/src/app/manifest.ts`
+ generated `icon.tsx`/`apple-icon.tsx`; `appleWebApp` in `layout.tsx`) with **web push** of the morning
briefing (`web/public/sw.js`, sender `coach/src/push.ts` via VAPID; subscriptions table `push_subscriptions`,
opt-in `web/src/components/notification-opt-in.tsx` posting to `web/src/app/api/push`). iOS push needs the
home-screen-installed PWA. The nightly job is now **cloud** (`.github/workflows/nightly.yml`) — `nightly.sh`/
`morning.sh` + launchd are retired (unload the plist on cutover so the two don't race + double-write
`daily_metrics`). A **morning gate** (`massif_ingest.morning`, exit 0=proceed/10=skip) replicates the old
event-driven poller: the workflow fires across the morning and only generates once `garmin.sleep_ready()`
is finalized, with a `--force` final slot (`0 7 * * *`); coach is idempotent per day via `COACH_SKIP_IF_DONE`.
Garmin runs headless via the mirrored token (see Garmin gotcha). **RLS is ON** (see RLS gotcha). **History
backfilled**: 395 Strava activities since 2021 (`sync --strava-days 3650 --stream-days 90`; `--stream-days`
bounds per-activity stream/detail fetches to recent activities to stay under Strava rate limits) → CTL
converged, fixing the short-history bias that inflated ACWR (2.54→1.31) and over-flagged overload (the
coach went 🔴 repos → 🟡 récup active on the same day). Hardening: Strava activity deep-links on the
dashboard (`StravaLink` in `web/src/components/brand.tsx`), a cron failure-verify step (red job → email),
and a DB-counted coach-chat rate-limit (`enforceCoachRateLimit` in `actions.ts`, 3/min·50/day) + a hard
monthly cap to set on the Anthropic console. Secrets live in Vercel (web) + GitHub Actions secrets (cron).
Runbook: `ops/PHONE_ACCESS.md`.

**ON-DEMAND SYNC shipped (TS, no Mac/cron wait).** Refresh Strava + the fitness model the instant the
athlete asks: `web/src/lib/strava-sync.ts` (`syncStrava`, a recent-window mirror of strava.py — token
refresh, activities, altitude-stream D-, `computeLoad`, upsert) + `web/src/lib/rollup.ts`
(`rollupDailyMetrics`, EWMA mirror of sync.py) → the `syncNow()` server action (`web/src/app/actions.ts`)
→ `web/src/components/sync-refresh.tsx` (a desktop floating button + mobile **pull-to-refresh**, mounted
ONCE in `Nav`). Parity with Python verified (395/395 activities, CTL exact), so on-demand numbers match
the nightly cron. **Garmin recovery is NOT refreshed here** (no API; python-garminconnect only) — it
stays on the morning cron, which is fine since sleep/HRV/readiness are morning metrics. A real-time
Strava **webhook** was deferred: it's blocked on the multi-user model (one subscription per app, events
routed by `owner_id` → needs `athlete_id`). NEXT: the full multi-user epic.

**ON-DEMAND BRIEFING REGEN shipped (no GitHub/terminal round-trip).** The dashboard coach card now has a
discreet **⋮ menu** (`web/src/components/briefing-menu.tsx`, mounted top-right in `CoachHero`) → "Régénérer
le briefing" → the `generateBriefingNow()` server action: it does a cheap `syncStrava`+`rollupDailyMetrics`
(fresh activities) then regenerates today's briefing **inline** via `web/src/lib/coach-briefing.ts`
(`generateBriefing`) — a **MIRROR of `coach/src/coach.ts`** (same SYSTEM prompt + BRIEFING_SCHEMA + the
`coach_briefings`/`planned_sessions` writes; keep in sync, like load.ts↔load.py). It reuses the web's
existing `assembleCoachContext` (mirror of context.ts) + Anthropic integration (the chat already calls it,
`ANTHROPIC_API_KEY` is on Vercel). Two deliberate differences vs the cron: the briefing now speaks in the
athlete's **chosen coach persona/voice** (`buildPersonaInstructions` from coach-settings.ts — previously
only the chat used it) and emits **no push** (the athlete is looking at the screen). Cost guard:
`enforceBriefingRateLimit` (2/min, 20/day on `coach_briefings`). Kept DISTINCT from the LLM-free
pull-to-refresh/floating "Synchroniser" button (that stays the cheap data-only refresh). The **morning
cron now matches**: `coach/src/coach.ts` injects the same persona via **`coach/src/persona.ts`** (a focused
MIRROR of `web/src/lib/coach-settings.ts` — prompt-relevant slice only: voice/name/dims + buildPersonaInstructions;
no UI/avatars). Verified: web build green, coach `tsc` clean, live read-only check (context assembles, chosen
persona read = bouquetin/Gaston and injected). **`why` is now ONE sentence** (schema + prompt, both coach.ts
and coach-briefing.ts): the dashboard shows it collapsed under the readiness bubble, with an **"Afficher plus"**
toggle (`web/src/components/briefing-detail.tsx`) revealing the fuller `reasoning` (state_assessment) + the
week skeleton; the ⚠️ `flag` stays always-visible (it's a warning).

**Design system v1 implemented + build-verified.** Formalised from the logo (blue→orange gradient = the two
load channels). `web/src/app/globals.css` now carries the `@theme` token layer (Alpine + Summit ramps,
semantic `aerobic`/`neuro`/`ready`/`caution`/`rest` aliases that shift in dark mode, `page`/`ink` surfaces,
`strava`/`garmin` partner colours, `--gradient-massif` + `bg-massif` utility) — the old Next boilerplate (which
forced `Arial` over Geist) is gone. Consolidated 3 blues → **Alpine** and fixed the neuromuscular channel
which was wrongly drawn in amber (= the `caution` state) → now **Summit** orange. Charts/gauges read colours
from `web/src/lib/theme.ts`. Canonical reference + do/don't: `docs/DESIGN_SYSTEM.md` (binding); a project agent
`.claude/agents/frontend.md` is bound to it. Rendered charte: an artifact under claude.ai/code/artifact.

**DATA-VIZ v2 shipped (interactive charts + 2 new pages).** Three additions, all on the design system
(colours via `theme.ts`, sports = glyph+name never coloured, `tabular-nums`, bordered-not-shadowed):
1. **Interactive dashboard charts** (`web/src/components/charts-section.tsx`, a `"use client"` island that
   replaced the static charts from `charts.tsx` — `charts.tsx` now only exports `Gauge`). Click/tap a
   bar/point (or ←/→, Échap) → a per-day **detail panel** (`day-detail-panel.tsx`) lists the activities
   that make up that day's score (glyph + FR name + Strava title + aéro/neuro split + Strava deep-link).
   The two **Forme** charts (CTL/ATL + TSB) are **fused into one card** with the detail panel, and share
   a single selected date (synced crosshair) AND a synced horizontal scroll (`ScrollGroup`); the channel
   chart is a separate card with the same synced cursor. Charts are bounded to a rolling **2-month window**
   (`DASHBOARD_WINDOW_MONTHS` in `data.ts`) — deeper history lives in `/analyse`.
2. **`/activites`** (`web/src/app/activites/`, server component + `activity-filters.tsx` client island):
   browse ALL activities with URL-driven filters (sport chips, date range, load range, RPE-pending) +
   **keyword search** over the Strava name AND description, a summary strip, and pagination.
3. **`/analyse`** (`web/src/app/analyse/`, + `period-picker.tsx`): **A-vs-B period comparison** (presets
   7/28/90 j · semaine · mois · dates libres) — KPI table with Δ (B vs A: load + aéro/neuro, volumes,
   TSB/CTL/ACWR + recovery averages), per-sport paired bars (neutral stone, A vs B by shade), and an
   aligned cumulative-load overlay (A solid / B dashed — period is not a physiology, so neutral + texture).
**Shared foundation** (reused across all three + the dashboard): `web/src/lib/{activities,aggregate,format}.ts`
(`listActivities` filter/search, pure aggregation/grouping/diff, formatters) + `web/src/components/activity-row.tsx`
(`ActivityCard`/`ActivityRow`/`ActivityTableHead`); `data.ts` exposes `enrichActivities` + `ACTIVITY_COLS`.
Nav gained **Activités** + **Analyse** desktop tabs (mobile bottom island stays 2 tabs; reached via
contextual links on the dashboard). **Keyword search needs no migration**: it ORs over `sport_specific->>strava_name`
and `raw_payload->>description` (JSONB). `strava.py` now fetches activity detail for ALL recent activities
(was climbing-only) so descriptions land in `raw_payload` — **full description coverage requires a re-sync**
(`python -m massif_ingest.sync`); until then only climbing activities (already detailed) are description-searchable.

**HEAT & ALTITUDE integrated (2026-06-23) — as CONTEXT + a narrow power/pace correction, NEVER an HR-load
multiplier.** Backed by a fact-checked lit review in `docs/research/heat-altitude.md` (sources/PMIDs); model
delta = Upgrade 4 in `docs/MODEL_UPGRADES.md`. The rule: HR already rises with heat/altitude, so hrTSS already
counts that strain — multiplying HR-derived load would **double-count**. So instead: (1) **tss/rtss only**
get an altitude-adjusted-power/pace correction (`load.altitude_power_factor` ↔ `load.ts altitudePowerFactor`,
Bassett 1999; `hrtss` is NEVER corrected — a test locks this); (2) **`athlete_thresholds`** (migration `…0009`)
+ `load.resolve_profile` resolve thresholds as-of each activity's date (empty table ⇒ base profile, zero
behaviour change) — the right answer to the non-stationary HR baseline acclimation creates, wired into
`strava.py`/`sync.py` recompute + `strava-sync.ts`; (3) heat/altitude are **coach context** — new
`activities.{avg_temp_c,max_altitude_m,avg_altitude_m,time_high_altitude_s}` (Strava summary + altitude
stream, migration `…0007`) and `daily_metrics.{heat_acclimation_pct,altitude_acclimation_m}` (Garmin MaxMET
`get_max_metrics`, migration `…0008`), surfaced via the `environment` block in the coach context mirrors and a
rewritten **rule 8** in all four coach prompts (read HR/recovery through heat/altitude; never inflate load).
KEEP the usual mirrors in sync (load.py↔load.ts, context.ts↔coach-context.ts, coach.ts↔coach-briefing.ts).
Additive + inert until data flows; reaches history via `--recompute-loads`. pytest 44 green; web+coach tsc clean.

**ON-DEMAND TWO-MODE BRIEFING — CRON + PUSH RETIRED (token economy).** The morning cron was too costly
(adaptive-thinking burned ~14k tokens), fragile (depended on Garmin syncing after wake) and slow (timed out
on mobile). It's gone. The briefing is now generated **only on demand** and reads the **current DB** (no
inline sync → instant, no timeout). It has **two modes**, chosen in the coach-settings modal (Profil/coach
card; `coach_settings.briefing_mode`, default `'free'`): **free** = 100 % ALGORITHMIC, **zero tokens**;
**ai** = same algorithmic plan, then ONE small **cached, no-thinking** LLM call re-voices three text fields
(today's description + state_assessment + why) in the persona. The toggle governs ONLY the briefing — the
**chat stays AI-on-demand in both modes** (the AD+/bivouac-style natural-language planning lives there,
unchanged). Engine = `web/src/lib/briefing-algo.ts` (`buildAlgorithmicBriefing`, PURE over the assembled
context → unit-tested in `briefing-algo.test.ts`, 11 tests): `computeReadiness` (TSB/ACWR/recovery
thresholds), `buildWeekPlan` (event-aware, taper via `declared_events[].forecast`, no_hard_days, 80/20, no
two same-system hard back-to-back, readiness-gated), per-day target loads (`splitByTag`), today's session
with **Z-band bpm from `hr_zones`**, templated why/state/flag/confidence (coach-voice variant pattern). It
returns the SAME object shape, so `buildForwardPlanRows` + the `coach_briefings` write are unchanged and the
dashboard/`/seance` need no changes. `coach-briefing.ts` (`generateBriefing`) builds the algo briefing then
optionally enriches (mode `ai`); `regen.ts`/`generateBriefingNow`/`api/coach/regen` no longer sync inline
(maxDuration 60). **Removed**: `nightly.yml`, `morning.py`, `coach/src/coach.ts`+`push.ts`+`briefing-shared.ts`,
`web/src/lib/push.ts`, `api/push`, `notification-opt-in.tsx`, `public/sw.js`, `nightly.sh`/`morning.sh`/plist.
The coach BRIEFING mirror (coach/↔web/) is retired — briefing logic lives only in web/; `coach/` keeps the
read-only `ask` CLI. Migrations: `…0002` (briefing_mode) + `…0003` (drop push_subscriptions, keeps the Garmin
token in `…0006`). Unused secrets: `VAPID_*` everywhere + `ANTHROPIC_API_KEY`/`COACH_MODEL` in GitHub Actions
(Vercel still needs them for ai-mode + chat). web build + tsc green, coach tsc clean, 11 engine + 59 ingest tests.
