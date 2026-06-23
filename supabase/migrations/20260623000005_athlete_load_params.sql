-- Adaptive calibration (prio 3c) — personalized overrides for the load model's population-default
-- coefficients. Key-value so new coefficients can be calibrated without a schema change. The model
-- reads `value` when a row exists for a coefficient and falls back to the load.py / sync.py population
-- constant otherwise — so behaviour is IDENTICAL until a fit produces a row. Auto-populated by the
-- calibration step as the athlete's data accumulates ("works without any input, refines with data").
--
-- Known param keys (others ignored by the model, so adding a key here is harmless):
--   default_if                  → load.DEFAULT_IF (no-HR effort estimate)
--   descent_load_per_1000m      → load.DESCENT_LOAD_PER_1000M (eccentric descent, neuromuscular)
--   ascent_aerobic_per_1000m    → load.ASCENT_AEROBIC_PER_1000M (no-HR mountain ascent)
--   neuro_atl_days              → sync.NEURO_ATL_DAYS (neuromuscular recovery τ)

create table athlete_load_params (
  param      text primary key,
  value      numeric not null,
  source     text not null default 'fitted' check (source in ('fitted', 'manual')),
  n_samples  int,                                   -- ground-truth points the fit used (null for manual)
  fitted_at  timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_load_params_updated before update on athlete_load_params
  for each row execute function set_updated_at();

alter table athlete_load_params enable row level security;  -- deny-all to anon/auth; service-role bypasses (mirrors the RLS epic)
