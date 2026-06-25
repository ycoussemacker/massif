-- Differential RPE (Phase 2) — research docs/research/descent-neuromuscular-rpe.md part B / §11 Q5.
-- A single global session-RPE can't separate a cardio-driven day from a forearm/leg-driven one — yet that
-- aerobic-vs-neuromuscular split is the core of the model. Optional CR10 sub-scores let the athlete report
-- it directly: rpe_cardio (souffle → aerobic), rpe_legs (jambes → neuromuscular), rpe_grip (avant-bras/prise
-- → neuromuscular). When >=2 are present the channel split is derived from perception (load.py
-- _differential_split ↔ load.ts differentialSplit); the global perceived_rpe still sets the magnitude and the
-- objective descent term stays a floor. 0..10 (0 = that system unloaded; vs perceived_rpe's 1..10). Nullable
-- and additive → INERT for all existing rows (NULL) until the athlete enters them, so no history re-score is
-- forced by this migration. The single existing rpe_source / rpe_recorded_at applies to all three.
alter table activities
  add column if not exists rpe_cardio smallint check (rpe_cardio is null or rpe_cardio between 0 and 10),
  add column if not exists rpe_legs   smallint check (rpe_legs   is null or rpe_legs   between 0 and 10),
  add column if not exists rpe_grip   smallint check (rpe_grip   is null or rpe_grip   between 0 and 10);

comment on column activities.rpe_cardio is 'Differential CR10 RPE — cardio/souffle (→ aerobic channel). NULL when not given. Consumed only by the session_rpe scoring path.';
comment on column activities.rpe_legs  is 'Differential CR10 RPE — legs/jambes (→ neuromuscular channel). NULL when not given.';
comment on column activities.rpe_grip  is 'Differential CR10 RPE — forearms/grip (→ neuromuscular channel, climbing). NULL when not given.';
