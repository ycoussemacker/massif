-- Heat & altitude CONTEXT on activities (rec 1 + rec 3 of docs/research/heat-altitude.md).
-- These columns are NOT a load multiplier on the HR-driven channels: heat and altitude already raise
-- heart rate for a given effort, so hrTSS ALREADY counts that strain — inflating the load again would
-- double-count (see the doc). They serve two purposes:
--   • avg_temp_c, max_altitude_m, time_high_altitude_s → CONTEXT passed to the coach so it can read a
--     hot/high session as a recovery/HR confounder rather than over-reading a heat-driven HRV dip.
--   • avg_altitude_m → input to the ONLY load correction we apply: altitude-adjusted power/pace for the
--     environment-blind mechanical methods tss (power) and rtss (pace), never hrtss (load.altitude_power_factor,
--     Bassett et al. 1999). All optional; absent → no effect (degrades exactly like vertical_loss_m).
alter table activities
  add column if not exists avg_temp_c          numeric,   -- Strava average_temp (device-reported, °C); heat context
  add column if not exists max_altitude_m      numeric,   -- peak altitude reached (altitude stream); hypoxia context
  add column if not exists avg_altitude_m       numeric,   -- mean altitude (altitude stream); drives the tss/rtss altitude correction
  add column if not exists time_high_altitude_s int        -- seconds above load.ALT_HYPOXIA_THRESHOLD_M (~1500 m); exposure dose
  check (time_high_altitude_s is null or time_high_altitude_s >= 0);

comment on column activities.avg_temp_c is 'Ambient temperature (°C, Strava average_temp). Heat context for the coach; NOT a load input — hrTSS already captures heat strain via HR.';
comment on column activities.avg_altitude_m is 'Mean altitude (m). Input to load.altitude_power_factor (Bassett) which corrects power/pace load ONLY; HR methods are never altitude-corrected (double-count).';
comment on column activities.time_high_altitude_s is 'Seconds spent above ~1500 m (hypoxia exposure dose). Recovery/effort context for the coach.';
