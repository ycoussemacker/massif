-- RPE capture quality (research: docs/research/descent-neuromuscular-rpe.md, part B / §11 Q5).
-- Phase 1 — record WHEN a manual RPE was entered, so we can (a) nudge the validated 20–30 min
-- post-session window and (b) later down-weight very-late entries in calibration. Additive + nullable
-- → inert until the RPE picker starts writing it. The scale stays the validated Foster CR10 (anchored
-- in the UI); the picker offers 1–10 (a logged session is by definition ≥ 1).
alter table activities
  add column if not exists rpe_recorded_at timestamptz;

comment on column activities.rpe_recorded_at is
  'When the athlete entered perceived_rpe (manual CR10). NULL for estimated/legacy RPEs. Used to honour the validated 20–30 min post-session timing and to weight late entries.';
