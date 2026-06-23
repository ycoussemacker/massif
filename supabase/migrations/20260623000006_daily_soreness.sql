-- Optional neuromuscular ground-truth (prio 3c-B): a quick morning "legs / muscle soreness 1–5"
-- (1 = fresh, 5 = cooked). Wearables (HRV / Body Battery) are blind to structural fatigue, so this is
-- the missing signal needed to later calibrate the neuromuscular coefficients (DESCENT_LOAD_PER_1000M,
-- NEURO_ATL_DAYS) against how the legs actually feel. Entirely OPTIONAL — the app works without it; the
-- coefficients only personalize once enough soreness data accumulates. Daily grain, keyed on local_date,
-- written by its own column-scoped upsert (never clobbers the load-rollup or Garmin-recovery columns).

alter table daily_metrics
  add column soreness smallint check (soreness between 1 and 5);

comment on column daily_metrics.soreness is
  'Optional morning self-report: leg/muscle soreness 1 (fresh) – 5 (cooked). Neuromuscular ground truth for calibration; not required.';
