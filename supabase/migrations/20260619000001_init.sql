-- Massif — multi-sport training schema (Phase 1)
-- Design philosophy: ONE comparable global training-load number per activity, split into
-- two channels (aerobic vs neuromuscular/structural) that PARTITION the total, so all sports
-- feed one adaptive system. See docs/ARCHITECTURE.md for the full rationale.
--
-- Single-user app. RLS is intentionally NOT enabled here (local-first). A later migration
-- adds auth + RLS before any public/cloud deploy. Do not expose this DB publicly as-is.
--
-- Deferred to later migrations (documented in ARCHITECTURE.md):
--   * effective-dated thresholds/bodyweight (athlete_thresholds) for reproducible historical load
--   * training_blocks/mesocycle parent for planned_sessions

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at helper (search_path hardened for the Supabase advisor)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- sports — reference/lookup. Maps every raw Strava/Garmin sport string to a
-- normalized sport, its taxonomy group, and an ORDERED load-method ladder.
-- The ingestion job walks the ladder and uses the first method whose inputs are
-- present (e.g. tss if power, else hrtss if HR, … else duration_fallback).
-- Add a new sport with an INSERT, never a migration.
-- ─────────────────────────────────────────────────────────────────────────────
create table sports (
  id                       smallint primary key generated always as identity,
  code                     text not null unique,
  display_name             text not null,
  taxonomy_group           text not null check (taxonomy_group in (
                             'paced_endurance','mountain_vertical','technical_strength',
                             'resistance','aquatic','other')),
  load_method_ladder       text[] not null check (
                             load_method_ladder <@ array['tss','hrtss','rtss','vertical_duration',
                               'grade_volume','tonnage_rpe','session_rpe','duration_fallback']::text[]
                             and array_length(load_method_ladder, 1) >= 1),
  uses_distance            boolean not null default false,
  uses_hr                  boolean not null default false,
  uses_vertical            boolean not null default false,
  needs_manual_rpe         boolean not null default false,  -- hybrid RPE: prompt user post-session
  is_priority              boolean not null default false,
  source_aliases           text[] not null default '{}',    -- raw type strings from Strava/Garmin
  created_at               timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- athlete_profile — single-user physiological constants, goal, prefs, model params.
-- NOTE: holds CURRENT thresholds only. Historical load is made reproducible by
-- snapshotting the thresholds/weight used into activities.sport_specific.computed_with
-- (an effective-dated thresholds table is a documented later migration).
-- ─────────────────────────────────────────────────────────────────────────────
create table athlete_profile (
  id                       smallint primary key generated always as identity,
  max_hr                   int,
  resting_hr               int,
  lthr                     int,        -- lactate-threshold HR
  hrv_baseline_ms          numeric,
  weight_kg                numeric,
  ftp_watts                int,        -- cycling functional threshold power
  threshold_pace_s_per_km  numeric,    -- running threshold pace
  css_pace_s_per_100m      numeric,    -- swim critical-swim-speed pace
  goal_race                text,
  goal_distance            text,
  goal_date                date,
  secondary_goal           text,
  weekly_structure         jsonb,      -- preferred week shape
  constraints              jsonb,      -- no-hard days, injury history, max weekly hours
  sport_thresholds         jsonb,      -- per-sport thresholds (e.g. redpoint grade)
  load_model_params        jsonb not null default jsonb_build_object(
                             'ctl_days', 42,
                             'atl_days', 7,
                             'load_anchor', 'tss_100_per_threshold_hour',
                             'vertical_coeff', 0.10,
                             'trimp_b', 1.92
                           ),
  timezone                 text not null default 'Europe/Paris',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger trg_athlete_profile_updated before update on athlete_profile
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- activities — the spine. One row per session, any sport. The two load channels
-- PARTITION the global load: training_load is GENERATED as their sum, so the
-- central invariant (a hard climbing day's neuromuscular load is part of the same
-- global fatigue total as a run's aerobic load) can never drift.
-- ─────────────────────────────────────────────────────────────────────────────
create table activities (
  id                       uuid primary key default gen_random_uuid(),
  source                   text not null check (source in ('strava','garmin','manual')),
  source_activity_id       text,
  sport_id                 smallint not null references sports(id),
  started_at               timestamptz not null,
  local_date               date not null,            -- frozen at import (athlete tz) for daily rollups
  -- durations
  duration_s               int not null check (duration_s >= 0),
  moving_s                 int check (moving_s is null or moving_s >= 0),
  -- universal optional metrics (NULL when not applicable to the sport)
  distance_m               numeric check (distance_m is null or distance_m >= 0),
  vertical_gain_m          numeric check (vertical_gain_m is null or vertical_gain_m >= 0),
  vertical_loss_m          numeric check (vertical_loss_m is null or vertical_loss_m >= 0),
  carried_load_kg          numeric check (carried_load_kg is null or carried_load_kg >= 0),
  avg_hr                   int,
  max_hr                   int,
  hr_drift_pct             numeric,                  -- aerobic decoupling (Pa:HR)
  avg_power_w              numeric,
  np_power_w               numeric,                  -- normalized power
  avg_pace_s_per_km        numeric,
  calories                 int,
  -- subjective
  perceived_rpe            smallint check (perceived_rpe between 1 and 10),
  rpe_source               text check (rpe_source in ('user','estimated','pending')),
  -- comparable global output (TSS-style anchor: 100 = 1h at threshold)
  aerobic_load             numeric check (aerobic_load is null or aerobic_load >= 0),
  neuromuscular_load       numeric check (neuromuscular_load is null or neuromuscular_load >= 0),
  training_load            numeric generated always as (aerobic_load + neuromuscular_load) stored,
  load_method_used         text,                     -- which ladder method produced the load
  intensity_factor         numeric,
  -- sport-specific + raw (computed_with snapshots the thresholds/weight used)
  sport_specific           jsonb not null default '{}'::jsonb,
  raw_payload              jsonb,
  has_streams              boolean not null default false,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index activities_source_uniq on activities (source, source_activity_id)
  where source_activity_id is not null;             -- dedupe real imports; manual (NULL id) never collide
create index activities_local_date_idx on activities (local_date);
create index activities_sport_id_idx   on activities (sport_id);
create index activities_started_at_idx on activities (started_at desc);
create trigger trg_activities_updated before update on activities
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- activity_streams — high-res time series, kept out of the spine. Lazy: only for
-- GPS/HR sports. Stored as compressed jsonb arrays (read by the Python metric job,
-- which is responsible for aligning streams by index/time).
-- ─────────────────────────────────────────────────────────────────────────────
create table activity_streams (
  activity_id              uuid not null references activities(id) on delete cascade,
  stream_type              text not null check (stream_type in (
                             'time','hr','pace','velocity','distance','altitude',
                             'grade','power','cadence','latlng','temp')),
  sample_rate_s            smallint,
  data                     jsonb not null,           -- array of samples
  primary key (activity_id, stream_type)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- climbing_sets — per-route/problem detail for grade-weighted load
-- ─────────────────────────────────────────────────────────────────────────────
create table climbing_sets (
  id                       uuid primary key default gen_random_uuid(),
  activity_id              uuid not null references activities(id) on delete cascade,
  discipline               text check (discipline in ('boulder','sport','trad','top_rope','gym')),
  grade                    text,                     -- as logged, e.g. '7a', 'V5'
  grade_system             text check (grade_system in ('font','v_scale','french','yds')),
  grade_numeric            numeric,                  -- normalized to one scale (Python-computed)
  attempts                 smallint,
  sent                     boolean,
  send_style               text check (send_style in ('onsight','flash','redpoint')),
  wall_time_s              int,
  created_at               timestamptz not null default now()
);
create index climbing_sets_activity_idx on climbing_sets (activity_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- strength_sets — per-set detail for tonnage / per-muscle load
-- ─────────────────────────────────────────────────────────────────────────────
create table strength_sets (
  id                       uuid primary key default gen_random_uuid(),
  activity_id              uuid not null references activities(id) on delete cascade,
  exercise                 text,
  muscle_groups            text[],
  set_index                smallint,
  reps                     smallint,
  load_kg                  numeric,
  rpe                      numeric,
  rir                      smallint,                 -- reps in reserve
  created_at               timestamptz not null default now()
);
create index strength_sets_activity_idx on strength_sets (activity_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- daily_metrics — the row the morning coach reads first. Recovery (Garmin) fused
-- with the day's combined load and the rolling fitness/fatigue model (all sports).
-- The Python rollup is the SOLE writer and must upsert a (zero-load) row for EVERY
-- calendar day so the CTL/ATL/TSB EWMAs have a contiguous series with no gaps.
-- ─────────────────────────────────────────────────────────────────────────────
create table daily_metrics (
  local_date               date primary key,
  -- recovery (Garmin)
  sleep_score              smallint,
  sleep_duration_s         int,
  sleep_deep_s             int,
  sleep_rem_s              int,
  hrv_overnight_ms         numeric,
  hrv_7d_avg_ms            numeric,
  hrv_status               text check (hrv_status in ('balanced','low','unbalanced','poor')),
  resting_hr               int,
  rhr_baseline             int,
  body_battery_high        smallint,
  body_battery_low         smallint,
  body_battery_wake        smallint,
  stress_avg               smallint,
  training_readiness       smallint,
  -- load rollups (sum across ALL sports for the day)
  daily_load               numeric not null default 0,
  daily_aerobic_load       numeric not null default 0,
  daily_neuromuscular_load numeric not null default 0,
  vertical_gain_m          numeric not null default 0,
  vertical_loss_m          numeric not null default 0,
  load_by_group            jsonb not null default '{}'::jsonb,  -- keys pinned to sports.taxonomy_group
  -- fitness model: EWMAs over the combined daily_load series
  ctl                      numeric,    -- chronic load / fitness  (≈42d)
  atl                      numeric,    -- acute load / fatigue     (≈7d)
  tsb                      numeric,    -- training stress balance (ctl - atl) / form
  ctl_aerobic              numeric,
  atl_aerobic              numeric,
  ctl_neuromuscular        numeric,
  atl_neuromuscular        numeric,
  acwr                     numeric,    -- acute:chronic workload ratio (global)
  monotony                 numeric,
  strain                   numeric,
  readiness_score          numeric,    -- derived blend of recovery + tsb
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger trg_daily_metrics_updated before update on daily_metrics
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- planned_sessions — the plan the coach reshapes. Sport-aware, with per-channel
-- targets and intra-day ordering. system_tag = which physiological budget the
-- session spends (not the sport name).
-- ─────────────────────────────────────────────────────────────────────────────
create table planned_sessions (
  id                       uuid primary key default gen_random_uuid(),
  planned_date             date not null,
  order_in_day             smallint not null default 1,   -- AM run + PM strength on one day
  sport_id                 smallint references sports(id),
  title                    text not null,
  description              text,
  target_load              numeric,
  target_aerobic_load      numeric,
  target_neuromuscular_load numeric,
  target_duration_s        int,
  target_distance_m        numeric,
  target_vertical_m        numeric,
  target_grade             text,
  intensity_zone           text,
  system_tag               text check (system_tag in (
                             'easy','hard_aerobic','hard_neuromuscular','hard_structural',
                             'recovery','rest')),
  is_key                   boolean not null default false,
  block_phase              text,       -- base / build / peak / taper / recovery
  week_index               int,
  status                   text not null default 'planned' check (status in (
                             'planned','modified','completed','skipped')),
  modified_by              text check (modified_by in ('coach','user')),
  modified_reason          text,
  linked_activity_id       uuid references activities(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index planned_sessions_date_idx on planned_sessions (planned_date);
create unique index planned_sessions_linked_activity_uniq on planned_sessions (linked_activity_id)
  where linked_activity_id is not null;             -- one activity fulfils at most one planned session
create trigger trg_planned_sessions_updated before update on planned_sessions
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- coach_briefings — audit log of every agentic morning run (reproducible reasoning)
-- ─────────────────────────────────────────────────────────────────────────────
create table coach_briefings (
  id                       uuid primary key default gen_random_uuid(),
  briefing_date            date not null,
  model                    text,
  readiness                text check (readiness in ('green','amber','red')),
  today_session            text,
  why                      text,
  changed                  text,
  week_skeleton            jsonb,
  flag                     text,
  reasoning                text,
  input_snapshot           jsonb,      -- what the agent read
  actions                  jsonb,      -- which planned_sessions it changed and how
  confidence               numeric,
  raw_response             text,
  created_at               timestamptz not null default now()
);
create index coach_briefings_date_idx on coach_briefings (briefing_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- integration_tokens — provider OAuth tokens (Garmin currently uses a local token
-- dir on the Mac; 'garmin'/'manual' allowed so they can move here without a migration)
-- ─────────────────────────────────────────────────────────────────────────────
create table integration_tokens (
  provider                 text primary key check (provider in ('strava','garmin','manual')),
  access_token             text,
  refresh_token            text,
  expires_at               timestamptz,
  scope                    text,
  athlete_id               text,
  updated_at               timestamptz not null default now()
);
create trigger trg_integration_tokens_updated before update on integration_tokens
  for each row execute function set_updated_at();
