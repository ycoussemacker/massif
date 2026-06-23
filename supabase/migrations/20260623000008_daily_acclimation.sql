-- Garmin/Firstbeat Heat & Altitude Performance Acclimation on the daily recovery row (rec 1).
-- Pulled from Garmin's MaxMET payload (get_max_metrics → heatAltitudeAcclimation). Per Garmin's manuals
-- these are NOT training-load values: heat acclimation tracks when temperature is above 22 °C and altitude
-- acclimation when above 800 m, and they CORRECT Garmin's own VO2max/Training-Status estimate so a hot or
-- high session doesn't spuriously drop it. We store them as the same kind of signal: CONTEXT the coach uses
-- to interpret an elevated HR / depressed HRV (low acclimation + a hot/high session ⇒ expect higher HR and
-- RPE), never as a load input. Written by the Garmin recovery upsert (column-scoped, keyed on local_date),
-- so they sit alongside sleep/HRV/Body Battery and never touch the load-rollup columns.
alter table daily_metrics
  add column if not exists heat_acclimation_pct    smallint   -- 0..100, Garmin heatAcclimationPercentage
    check (heat_acclimation_pct is null or heat_acclimation_pct between 0 and 100),
  add column if not exists altitude_acclimation_m  int;       -- current altitude acclimation (m), Garmin altitudeAcclimation

comment on column daily_metrics.heat_acclimation_pct is 'Garmin/Firstbeat heat acclimation (0-100%). Context for interpreting HR/recovery; tracks training above ~22 °C. Not a load input.';
comment on column daily_metrics.altitude_acclimation_m is 'Garmin/Firstbeat altitude acclimation (m). Context for interpreting HR/recovery; tracks exposure above ~800 m. Not a load input.';
