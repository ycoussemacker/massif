-- Massif — profile fields + multi-goal model (Profil UI phase)
-- Adds the personal-identity fields the profile UI edits, and replaces the single
-- goal_race/goal_distance/goal_date columns with a flexible, ranked, multi-sport `goals` table.
--
-- Goals design (see docs/ARCHITECTURE.md):
--   * multi-sport: sport_id is NULLable (a goal need not target a specific sport)
--   * ranked by importance: priority_rank (smaller = more important; the athlete orders them)
--   * optional deadline: target_date (structured, drives days-to math) OR target_horizon
--     (fuzzy free text, e.g. "cette année", "avant mes 30 ans") — a goal may have neither
--   * fast/light entry: target_detail free text ("100 km / 5000 D+", "7a", "sub-3h")
--
-- Single-user still: no athlete_id / RLS here. Hosting will require accounts + RLS (documented).

-- ─────────────────────────────────────────────────────────────────────────────
-- athlete_profile — identity / personal fields the profile UI edits.
-- (weight_kg, max_hr, lthr, resting_hr, hrv_baseline_ms, weekly_structure, constraints already exist.)
-- ─────────────────────────────────────────────────────────────────────────────
alter table athlete_profile
  add column if not exists name      text,
  add column if not exists birthdate date,
  add column if not exists sex       text check (sex in ('M','F','other')),
  add column if not exists height_cm numeric check (height_cm is null or height_cm > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- goals — flexible, ranked, multi-sport objectives. Replaces athlete_profile.goal_*.
-- ─────────────────────────────────────────────────────────────────────────────
create table goals (
  id             uuid primary key default gen_random_uuid(),
  sport_id       smallint references sports(id),   -- NULL = general goal (no obligatory sport)
  title          text not null,
  kind           text check (kind in ('race','performance','volume','skill','other')),
  priority_rank  int  not null default 100,         -- smaller = more important; athlete-ordered
  target_date    date,                              -- structured deadline (optional)
  target_horizon text,                              -- fuzzy deadline: "cette année", "avant mes 30 ans"
  target_detail  text,                              -- "100 km / 5000 D+", "7a", "sub-3h" (free, quick)
  notes          text,
  status         text not null default 'active' check (status in ('active','achieved','abandoned')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index goals_active_rank_idx on goals (status, priority_rank);
create trigger trg_goals_updated before update on goals
  for each row execute function set_updated_at();   -- helper from 20260619000001_init.sql

-- Backfill the existing single goal (e.g. Roubion-Nice 100K) so nothing is lost.
insert into goals (title, target_detail, target_date, kind, priority_rank, status)
select goal_race, goal_distance, goal_date, 'race', 1, 'active'
from athlete_profile
where goal_race is not null;

-- The legacy goal_race/goal_distance/goal_date/secondary_goal columns are kept for back-compat but
-- are no longer read (the app reads `goals`). A later migration drops them.
