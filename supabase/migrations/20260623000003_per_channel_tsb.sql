-- Per-channel form (TSB) with a physiology-aware acute time constant.
--
-- The combined TSB (ctl - atl) treats all fatigue as if it clears on the aerobic ~7-day timescale.
-- But the neuromuscular channel (eccentric descent, impact, carried mass) loads structures — muscle,
-- tendon — that recover over WEEKS, invisible to HRV/Body Battery. The rollup now computes the
-- neuromuscular acute load on a slower τ (NEURO_ATL_DAYS = 14 d vs 7 d aerobic), and we persist a
-- per-channel TSB so the dashboard + coach can read aerobic freshness (fast, HRV-visible) separately
-- from neuromuscular freshness (slow, structural). Combined ctl/atl/tsb are unchanged.

alter table daily_metrics
  add column tsb_aerobic       numeric,  -- ctl_aerobic - atl_aerobic (acute τ 7 d)
  add column tsb_neuromuscular numeric;  -- ctl_neuromuscular - atl_neuromuscular (acute τ 14 d, lingers)

comment on column daily_metrics.tsb_neuromuscular is
  'Neuromuscular form = ctl_neuromuscular - atl_neuromuscular, the latter on a slower (~14d) acute τ: structural/tendon fatigue lingers far longer than the HRV-visible aerobic fatigue.';
