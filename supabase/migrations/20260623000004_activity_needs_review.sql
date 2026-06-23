-- Outlier guard (data hygiene, multi-user-ready): flag — never silently cap — activities whose load
-- rests on a suspect input, so they can be reviewed (e.g. an RPE entered to refine) instead of skewing
-- the model. Set by load.needs_review(): an HR-sensor glitch (avg_hr > max_hr), an implausible intensity
-- factor, or a single-day outing scored on elapsed time that was mostly spent stopped (forgotten pause /
-- lift laps / long belays → load overstated). Scoring is unchanged; this is purely an audit/UI signal.

alter table activities
  add column needs_review boolean not null default false;

comment on column activities.needs_review is
  'Load rests on a suspect input (HR>max, implausible IF, or single-day mostly-stopped). Audit/UI flag only — scoring is not altered.';
