-- Expected altitude (m) of a planned session / declared event, so the coach can ANTICIPATE hypoxia on
-- upcoming mountain days — at altitude HR runs higher for the same effort (that is the environment, not
-- fatigue) and the cost is higher when the athlete is under-acclimated. Weighed against daily_metrics
-- altitude_acclimation_m (docs/research/heat-altitude.md). Optional; null = unknown → no effect.
alter table planned_sessions
  add column if not exists expected_altitude_m int
  check (expected_altitude_m is null or expected_altitude_m >= 0);

comment on column planned_sessions.expected_altitude_m is 'Expected mean/representative altitude (m) of the planned session/event — coach hypoxia context; not a load input.';
