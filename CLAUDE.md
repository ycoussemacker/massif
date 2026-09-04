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
  Always BOUND history reads by date range (the dashboard bounds to `DASHBOARD_WINDOW_DAYS` = 21 d;
  `/analyse` reads ONE bounded query PER PERIOD) or page via `.range()`.
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
   (`DASHBOARD_WINDOW_DAYS` = 21 in `data.ts`) — deeper history lives in `/analyse`.
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

**DESCENT TRAINABILITY (Upgrade 7) + RPE CR10 — shipped 2026-06-25** (research + sources:
`docs/research/descent-neuromuscular-rpe.md`; coach-facing `docs/MODELE_ENTRAINEMENT.md` §2.3/§11 Q2+Q5;
log `docs/MODEL_UPGRADES.md`). The eccentric-descent cost is **trainable** (repeated-bout effect), so:
(1) `DESCENT_LOAD_PER_1000M 70 → **55**` (the TRAINED-descender value, ≈0.78× the naive 70 per the
downhill-running lit.) — a standing −5.6 % neuromuscular discount; (2) a **dynamic repeated-bout factor**
(`descent_factor`/`descent_familiarity_ratios` in load.py ↔ load.ts, bounded ±25 %, saturating, anchored at
the athlete's MEDIAN trailing-28d D−) climbs the cost back toward ~70 after a layoff and dips in a heavy
block. A real-data **dry-run** (`ingest/scripts/dry_run_descent.py`) showed the dynamic factor is **net ≈ 0**
for this athlete (his big descents fall at de-adapted season-starts → correctly penalised) — it's a per-day
RISK-TIMING signal, while the −20-30 % trained discount is ABSOLUTE → lives in the base. **Reliability ALERT**:
the factor is **gated** to ≥ `MIN_SAMPLES=12` descent-active dates (else inert, no false precision);
`descent_model_confidence` (off/low/ok) is surfaced in the coach context. Wired in ALL scoring paths for
parity (sync.recompute, strava.sync, strava-sync.ts, setRpe); re-scored 399 activities via `--recompute-loads`.
**No migration** (factor baked into `neuromuscular_load`). **Phase 2 also shipped**: the neuromuscular acute
τ is now **non-stationary** (`descent_recovery_factor` + `ewma_variable_tau` ↔ TS; rollup `sync.py` ↔
`rollup.ts`) — adapted → shorter τ (~11.5 d, faster recovery), de-adapted → longer (~16.5 d); neuro CTL keeps
42 d, so it moves `tsb_neuromuscular` (the readiness lever). Re-rolled (no migration); `tsb_neuro` −4.76→−4.54.
Also shipped: **RPE Phase 1** — the picker is the validated **Foster CR10** (anchors + global-session
wording + 20-30 min nudge) and stamps `rpe_recorded_at` (migration `…0004`).

**RPE PHASE 2 — user-RPE-wins-ladder fix + differential RPE (Upgrade 8, shipped 2026-06-25).** Two coupled
moves (research/sources `docs/research/descent-neuromuscular-rpe.md` part B; coach-facing §2.2/§11 Q5; log
`MODEL_UPGRADES.md` Upgrade 8). (1) **Bug fix:** a USER-entered RPE now WINS the ladder — for
alpinism/via_ferrata/grande_voie `vertical_duration` was winning `compute_load` and **ignoring the athlete's
RPE** on recompute/sync (a grande_voie rated 10 scored 38; an alpi rated 3 scored 182). Now when
`rpe_source=='user'` + `perceived_rpe` + `session_rpe` in ladder, session_rpe moves to the front
(`load.py` ↔ `load.ts`). (2) **Differential RPE:** optional CR10 sub-scores `rpe_cardio` (→ aérobie),
`rpe_legs`/`rpe_grip` (→ neuro); when **≥2** present the aero/neuro SPLIT is perception-derived
(`_differential_split`/`differentialSplit`: `neuro_rpe=min(10,√(legs²+grip²))`, `aero_frac=cardio²/(cardio²+neuro_rpe²)`)
instead of fixed `CHANNEL_SPLIT`/`IMPACT_FRAC`; the **objective descent term stays a FLOOR** for
aerobic-engine sports (a same-session RPE under-reports delayed DOMS), and the split needs a cardio score on
aerobic-engine sports (else a blank cardio would zero the engine). Global `perceived_rpe` stays the magnitude.
**Inert by default** (existing rows have NULL sub-scores → byte-identical). Wired across all 5 scoring paths
(`fetch_activities_for_recompute`, `load_user_differential_rpes`, `strava.sync`, `strava-sync.ts`, `setRpe`) +
coach context (`rpe_diff`); UI = `rpe.tsx` "préciser par système" panel (cardio=Alpine, legs/grip=Summit).
Migration `…0005_rpe_differential_channels` adds the 3 nullable `smallint 0..10` columns. ⚠️ **The 3 columns
are SELECTed unconditionally — push `…0004` + `…0005` (`supabase db push`) BEFORE this code runs/deploys**
(else PostgREST 42703 breaks recompute/sync/coach-context), then apply the ladder-fix re-score with
`--recompute-loads`. Adversarial multi-agent verify clean; pytest 71 green; web tsc clean.

**USER-EDITS SURVIVE + PROPAGATE (shipped 2026-07-05).** Five coupled fixes from real use. (1) **Every
activity recompute now propagates to the graphs**: `setRpe`, `reassignActivitySport` and the new
`updateActivityData` all run `rollupDailyMetrics` inline then revalidate all surfaces
(`revalidateActivitySurfaces`) — before, daily_metrics/CTL/ATL froze until the next sync (observed live:
stale by 20+ pts). (2) **Any load-relevant field is editable**: `activities.user_overrides` (jsonb,
migration `…20260705000001`, ALREADY PUSHED to cloud) stores field→value corrections + `sport_code`;
`web/src/lib/activity-edit.ts` = shared core (EDITABLE_FIELDS bounds, `applyFieldOverrides`,
`recomputeActivityLoad` — full model context: ladder + dated thresholds + load params + descent
familiarity, parity with the Python recompute); UI = `activity-edit-modal.tsx` (séance page "Données"
row + the ⚠ flag sheet). (3) **Syncs NEVER clobber user edits**: both syncs re-apply `user_overrides`
AFTER rebuilding the provider row and BEFORE compute_load (sport override resolved BY CODE, pace
re-derived when distance/moving corrected) — `strava-sync.ts` ↔ `strava.py` `_apply_field_overrides`/
`OVERRIDABLE_FIELDS` + `db.load_user_overrides` (KEEP IN SYNC, like the RPE maps). (4) **RPE is a real
modal** (`rpe.tsx`): mobile bottom-sheet / desktop centered (the old anchored popover clipped in lists),
body-scroll lock (also disarms pull-to-refresh), 44px targets, `router.refresh()` on save. (5) **Busy
dimming**: `regen-provider.tsx` now exposes busy scopes (`regen`/`sync`/`garmin`; producers = SyncRefresh,
StravaAutoRefresh, GarminRefresh, regenerate) and `<Dim on=…>` (`busy.tsx`) veils the affected dashboard
sections (coach card, week pills, charts, recovery, activities) with grey+backdrop-blur — a VEIL, not a
`filter` on content (a filter would break `fixed` child modals). `ACTIVITY_COLS`/`Activity` gained
`max_hr, avg_power_w, np_power_w, avg_altitude_m, user_overrides`. E2E verified on real data (D− edit →
recompute → rollup → revert, byte-consistent). pytest 74, engine tests 22, web build + lint 0 errors.

**PERIODIZATION v1 (Upgrade 9, shipped 2026-07-06) — phases + CTL ramp + deloads (Q15/Q17).** The 7-day
plan was memory-less (always steered back to the "typical" week = maintenance). Now `briefing-algo.ts`
derives the current PHASE from the PRIMARY dated goal (`phaseFromDaysTo`, pure + tested): **taper** ≤14 d
(existing exponential) · **peak** S−3..S−5 (×0.85, intensity kept) · **build** S−6..S−13 (**2:1**
mesocycles) · **base** beyond (**3:1**, 1 generated hard/wk). Mesocycles are END-ANCHORED: the last week
of each block is a **deload** (×0.65, one quality kept). In charge weeks a **CTL ramp** targets +4 pts/wk
(sourced band +3-5) by inflating GENERATED easy days only (bounded ×1.35; quality sessions + anchors
never rescaled; daily readiness gates stay above phase). **Inert without a dated goal** (phase "none" →
byte-identical, test-locked). Surfaced: `PhaseChip` under the dashboard's main goal (+ ⁉ help),
`state_assessment` opens with the phase, chat gets `training_phase` + a system rule (never push positive
TSB outside taper — mild negative TSB is the productive zone). Docs: MODELE §5.2 + Q15/Q17 ✅,
MODEL_UPGRADES Upgrade 9. NOT yet: per-channel neuro ramp (+1-3/wk — daily tsb_neuro/ACWR-neuro thresholds
protect instead), transition phase. Engine tests 25/25.

**CONSTRAINT WINDOWS (Upgrade 10, shipped 2026-07-06) — real life re-frames the phases.** New table
**`training_windows`** (migration `…20260706000001`, APPLIED to cloud): dated period + label + intent
`effect` (`auto`/`deload`/`maintain`/`charge`) + capacity flags (`no_mountains`,`limited_hills`,
`reduced_volume`); `auto` → deload if constrained ≥5 d else maintain (`resolveWindowEffect`). Engine
(briefing-algo.ts, pure, 30/30 tests): (1) **`effectivePhase`** — a deload window starting ≤21 d ABSORBS
the calendar deload («on charge avant, on encaisse pendant»; also suppressed ≤7 d after a deload window);
(2) generated qualities BEFORE a flat-terrain window become `hard_neuromuscular` (front-load the D+);
(3) PER-DAY modulation inside a window (deload ×0.65 / maintain ×0.85, max ONE quality and aerobic-only,
never generated côtes/force on flat → seuil + running, ramp never re-inflates in-window days); anchors +
readiness always above. Surfaced: agenda «+ Contrainte» button + modal (`training-window-modal.tsx`),
grey day bands + editable window in the day sheet, **week-start-only phase marker** (`phaseMarkFr`) in
`calendar-grid.tsx`; dashboard PhaseChip now shows the EFFECTIVE phase («décharge reportée sur …»);
context carries `training_windows` (coach-context.ts ↔ coach/src/context.ts MIRROR + `loadTrainingWindows`
in coach/src/db.ts — keep in sync) + a CHAT_SYSTEM rule (invite the athlete to declare windows mentioned
in chat). CRUD actions: create/update/deleteTrainingWindow (actions.ts). Backlog: propose_window chat tool,
transition phase.

**REGEN PLAN-DIFF (shipped 2026-07-06).** The athlete perceived «le coach ne change jamais une activité» —
VERIFIED false: every regen deletes + recreates ALL coach-owned week rows (`modified_by='coach'`, unlinked,
status planned; user events/pinned NEVER touched) — but the engine is DETERMINISTIC (same data → same plan)
and nothing showed it. Now `generateBriefing` snapshots the prior coach rows, computes `diffPlanRows`
(briefing-shared.ts, pure+tested: retag / volume ≥20 % & ≥8 pts / added / removed lines in FR) and
(1) persists it to `coach_briefings.changed` (was always null; explicit «Plan confirmé à l'identique…»
when the diff is empty), (2) returns `changes` through regen route → the RegenProvider banner says
«Plan ajusté — N changements» or «Plan réévalué — inchangé (mêmes données)», (3) the briefing card's
«Afficher plus» (BriefingDetail) shows the diff under `Dernière régénération :`. Engine tests 31/31.

**PHASE 7 — DURCISSEMENT DE L'AGENT (2026-09-02/03).** Huit lots, huit commits. Vitrine :
`coach/README.md` (frontière, catalogue, garde-fous, trace réelle, évals datées) ; plan et constats
reportés : `docs/AGENT_PLAN.md` ; méthode d'éval : `coach/evals/README.md`.
1. **Troncature muette supprimée.** `query_daily_metrics` rejouait l'incident PostgREST DANS l'agent —
   mesuré : fenêtre 2021→2026 = 1000 lignes s'arrêtant au 2024-05-22, 832 jours manquants, en silence
   (sur une comparaison inter-annuelle c'est la moitié RÉCENTE qui disparaît, ce qui inverse la
   conclusion). Règle appliquée partout via `web/src/lib/agent/limits.ts` (outil : borne + SIGNALE, la
   sonde `limit+1` rend le débordement détectable) et `web/src/lib/db-paged.ts` / `db.select_all_paged`
   (calcul sur l'historique : PAGINE, et LÈVE au-delà du garde-fou). Corrigés aussi : `loadHistory`
   (coach_messages ascendant non borné), `/analyse` (une lecture PAR PÉRIODE ; avant, période B = 0
   jour et six tuiles en « — »), rollup TS+Python et les lectures pleine table d'`activities`.
2. **Périmètre médical** — `agent/guardrails.ts`, source unique injectée dans les TROIS prompts LLM
   (chat, briefing `ai`, CLI `ask` ; il y en a trois, pas quatre — `coach.ts` est parti avec le cron).
   Le garde-fou vient EN DERNIER, après la persona (texte libre de l'athlète étiqueté « PRIORITÉ
   HAUTE »), et revendique la préséance. Deux pièges symétriques, trouvés en revue adverse : une
   première rédaction médicalisait les courbatures de descente (« perte de force », « dure au-delà de
   quelques jours ») et ne parlait pas de fièvre. Verrouillé par `guardrails.test.ts` (11 assertions,
   chacune encodant une faille trouvée).
3. **Invariant d'écriture prouvé** — `agent/invariants.test.ts` : les 10 outils contre un faux client
   qui lève hors `coach_proposals`, ligne insérée vérifiée `pending`, piège réseau (un module qui se
   fabrique son propre client échapperait au garde — c'était le cas d'`estimate_session` via
   `listActivities`, désormais à client injectable), et les violations survivent à un `try/catch`.
4. **Évals** — `coach/evals/`, 26 cas / 3 familles, fixture GÉNÉRÉE (le dépôt est public : pas de
   données de santé committées, et n'importe qui peut les lancer). Deux modes : rejeu (modèle rejoué,
   OUTILS réels, gratuit) et live. Campagne réelle : hors périmètre 100 % (42/42, 3 passes), données
   manquantes 100 %, nominal 6/7 (variance ; seuil agrégé), 1,5 itération, 0,024 $/tour. Le harnais a
   trouvé un vrai bug produit : le texte écrit par le modèle DANS LE MÊME TOUR qu'un appel d'outil
   était jeté (réponses commençant en plein milieu d'une phrase).
5. **CI** — `tests.yml` (push, gratuit : pytest 74 + 68 tests node + évals rejouées) et `evals.yml`
   (hebdo + dispatch : évals réelles, rapport en artefact). Le dépôt n'avait AUCUN workflow de test.
6. **Zod + traces + coût** — `agent/schemas.ts` est la seule définition (le JSON Schema du modèle en
   est DÉRIVÉ) ; entrée invalide = réponse corrigeable au modèle, sortie validée = bug journalisé (a
   attrapé `confidence: number` déclaré string). Migration `…20260902000001_coach_agent_traces`
   (⚠️ `supabase db push` À FAIRE — sans elle le code tourne, il journalise juste un avertissement).
   `pnpm -C coach traces` sort l'agrégat ; tarifs de cache pris en compte (lecture 0,1×, écriture 1,25×).
7. **Route API + dashboard** — `POST /api/coach/ask` et un champ sous la carte coach. La séquence d'un
   tour vit dans `web/src/lib/coach-turn.ts`, partagée par la route ET les Server Actions.
GOTCHAS : `MASSIF_TODAY` fige l'horloge (évals/tests uniquement) · `pnpm -C web test` existe (tsx) et
`web/pnpm-workspace.yaml` a besoin d'`allowBuilds: esbuild` · le plafond d'itérations est passé de 8 à
6 (convergence mesurée à 1,6) · secret `ANTHROPIC_API_KEY` à ajouter dans les GitHub Actions pour les
évals hebdomadaires.

**PARITÉ load.py ↔ load.ts VERROUILLÉE (2026-09-04).** Le trou le plus attaquable du dépôt : le modèle
de charge est écrit deux fois (601 lignes Python, source de vérité ; 516 lignes TS, exécutées par la
synchro à la demande et chaque correction depuis l'app), **une seule était testée**, et la parité
reposait sur UNE vérification manuelle (« 395/395 activités ») invalidée depuis par cinq commits, plus
des commentaires « KEEP IN SYNC ». Un commentaire n'est pas un test.
`tests/golden/load-parity.json` — 141 cas `compute_load` (les 6 méthodes de l'échelle : hrtss 27,
vertical_duration 28, session_rpe 12, rtss 6, tss 5, duration_fallback 63) + les fonctions pures
partagées (descent_factor, descent_recovery_factor, altitude_power_factor, ewma_variable_tau,
descent_familiarity_ratios, resolve_profile), valeurs calculées par PYTHON. Rejoué à 1e-9 par
`ingest/tests/test_load_parity.py` (garde la régression Python) ET `web/src/lib/load.parity.test.ts`
(garde LA PARITÉ), les deux dans la CI de chaque push. pytest 74 → 265, node 68 → 76.
⚠️ **RÈGLE : toute évolution du modèle régénère le fichier d'or** (`ingest/.venv/bin/python
ingest/scripts/gen_load_golden.py`) et le committe AVEC le changement — son diff est la revue de ce que
le changement déplace. Oublier n'est pas silencieux : pytest rougit.
**Deux divergences RÉELLES trouvées au premier run**, toutes deux dans l'arrondi et invisibles à l'œil :
(1) `Math.round` arrondit la moitié vers le haut, `round()` de Python vers le PAIR (105,125 → 105,13
contre 105,12) ; (2) `Math.round(x*100)/100` multiplie AVANT d'arrondir, ce qui introduit une erreur
(50,495 est 50,49499… en binaire, mais ×100 rend 5049,500000000001 → TS montait, Python descendait).
`load.ts` a désormais `roundPy`, qui arrondit sur le développement décimal EXACT, au pair. Écart de
0,01 point par activité concernée — minuscule, mais c'était deux chemins d'écriture d'une même donnée
qui ne s'accordaient pas.
