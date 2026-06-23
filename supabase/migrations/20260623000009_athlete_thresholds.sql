-- Effective-dated thresholds (rec 2 of docs/research/heat-altitude.md; the deferred athlete_thresholds
-- item from ARCHITECTURE.md). The single-row athlete_profile holds the athlete's CURRENT thresholds, so a
-- change to max_hr / lthr / FTP / weight silently re-scores ALL history the next recompute. This table
-- records thresholds as-of a date: load.compute_load resolves the row whose effective_date is the latest
-- <= an activity's local_date (load.resolve_profile), overlaying only its non-null fields onto the base
-- profile. EMPTY table ⇒ the base athlete_profile is used unchanged — behaviour is IDENTICAL until the
-- athlete records a dated change ("works without input, refines with data", like athlete_load_params).
--
-- Why this is the right home for the heat/altitude work: the HR-driven load assumes a roughly stable
-- HR→effort relationship, but heat and altitude acclimation shift FCmax / LTHR / resting HR by several bpm
-- over days-to-weeks (and decay back over ~2-3 weeks). The fix for that non-stationarity is dated thresholds
-- the model can resolve per activity — NOT an environmental multiplier on HR-derived load (that double-counts;
-- see the doc). This makes historical load reproducible and lets the model track a moving HR baseline.
create table athlete_thresholds (
  effective_date          date primary key,    -- thresholds below apply from this date until the next row
  max_hr                  int,
  resting_hr              int,
  lthr                    int,
  ftp_watts               int,
  threshold_pace_s_per_km numeric,
  weight_kg               numeric,
  note                    text,                 -- why it changed (e.g. "post heat-block plasma-volume gain", "new FTP test")
  created_at              timestamptz not null default now()
);

alter table athlete_thresholds enable row level security;  -- deny-all to anon/auth; service-role bypasses (mirrors the RLS epic)
