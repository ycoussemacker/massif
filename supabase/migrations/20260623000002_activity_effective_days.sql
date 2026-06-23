-- Data hygiene: multi-day expedition handling.
--
-- Strava can publish a multi-day outing (a GR20, a trek) as ONE activity — elapsed_time then spans the
-- whole trip (nights included) and the row lands entirely on its start date, spiking that single day's
-- load and wrecking the CTL/ATL EWMAs (phantom fatigue then weeks of falsely-high CTL → inflated TSB).
--
-- `effective_days` is the number of calendar days such an expedition truly spans (see load.py
-- `activity_span_days`): 1 for every normal single-day activity (default), >1 only for a genuine
-- multi-day trip. The daily rollup (sync.py / rollup.ts) spreads the activity's load evenly across this
-- many days starting at local_date, and the per-activity load itself is computed from MOVING time (not
-- elapsed) when effective_days>1. effective_days>1 is also the audit flag for an adjusted activity.

alter table activities
  add column effective_days int not null default 1 check (effective_days >= 1);

comment on column activities.effective_days is
  'Calendar days a multi-day expedition spans (1 = normal single-day activity). The daily rollup spreads load across this many days; >1 also flags the activity as load-adjusted.';
