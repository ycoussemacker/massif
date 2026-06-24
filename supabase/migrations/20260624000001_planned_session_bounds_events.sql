-- 7-day planning rework (docs/.../on-va-revoir...): the coach is recentred on planning the next 7 days
-- AROUND activities the athlete declares ("I plan to do X this week"). Two additive concerns on
-- planned_sessions, both inert until written (so the app behaves IDENTICALLY until the new code lands):
--
-- 1) Per-channel target BOUNDS. The coach already writes target_aerobic_load / target_neuromuscular_load
--    (the midpoints) for its 1-2 detailed sessions; these add the "too little / too much" bands per channel.
--    They drive the LLM-free post-activity verdict (web/src/lib/day-progress.ts): below *_min = under-did
--    that channel, above *_max = over-did it. Bands are per-session + asymmetric (an easy day tolerates
--    going low but not high; a key-event eve the reverse) — richer than the old symmetric ±50 % on the total.
--
-- 2) Athlete-declared EVENTS. is_event=true marks a planned_sessions row the ATHLETE declared (vs a coach
--    session): the coach plans AROUND it and must NEVER clobber it (the materialization delete is scoped to
--    modified_by='coach'). predicted_* records the deterministic cost ESTIMATE for the event itself
--    (web/src/lib/estimate.ts, from the athlete's own similar past efforts) — kept DISTINCT from target_*
--    (what the coach PRESCRIBES): on an event row predicted_* is set and target_* null; on a coach session
--    the reverse. prediction_basis is a short human string ("moy. de 4 sorties trail 30-40km, 2000-2500 D+").
alter table planned_sessions
  add column if not exists target_aerobic_min           numeric,
  add column if not exists target_aerobic_max           numeric,
  add column if not exists target_neuromuscular_min     numeric,
  add column if not exists target_neuromuscular_max     numeric,
  add column if not exists is_event                     boolean not null default false,
  add column if not exists predicted_aerobic_load       numeric,
  add column if not exists predicted_neuromuscular_load numeric,
  add column if not exists prediction_basis             text;

comment on column planned_sessions.is_event is
  'true = athlete-declared event the coach plans AROUND and never overwrites (delete on materialization is scoped to modified_by=coach).';
comment on column planned_sessions.target_aerobic_min is
  'Below this the athlete under-did the aerobic channel; above target_aerobic_max they over-did it. Drives the post-activity verdict.';
comment on column planned_sessions.predicted_aerobic_load is
  'Deterministic estimate of what the EVENT itself will cost (aerobic channel), from the athlete''s similar past efforts. Distinct from target_aerobic_load (coach prescription).';

-- planned_sessions already has RLS enabled (…0001_enable_rls); ALTER TABLE inherits it. No policy change.
