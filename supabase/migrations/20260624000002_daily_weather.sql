-- Daily weather forecast (Open-Meteo, keyless) for the athlete's location — gives the coach the UPCOMING
-- heat the acclimation should be read against (docs/research/heat-altitude.md follow-up). Forward forecast
-- (today..+7) plus yesterday for continuity, keyed on local_date. CONTEXT for prospective advice (dress/
-- hydrate/pace-vs-HR, expect HR drift on hot days), never a load input. Written by its own column-scoped
-- upsert (massif_ingest.weather), so it never touches the load-rollup or Garmin-recovery columns.
create table daily_weather (
  local_date  date primary key,
  temp_min_c  numeric,
  temp_max_c  numeric,
  feels_max_c numeric,   -- apparent-temperature max (humidity + wind + radiation): a better heat-strain proxy than dry temp
  precip_mm   numeric,
  wind_kmh    numeric,
  source      text not null default 'open-meteo',
  fetched_at  timestamptz not null default now()
);
alter table daily_weather enable row level security;  -- deny-all to anon/auth; service-role bypasses (mirrors the RLS epic)

-- Home location used for the forecast. Falls back to the most recent GPS activity's start point when null,
-- so it works without input; set explicitly (Profil / SQL) to pin a training base different from recent rides.
alter table athlete_profile
  add column if not exists home_lat numeric,
  add column if not exists home_lng numeric;
