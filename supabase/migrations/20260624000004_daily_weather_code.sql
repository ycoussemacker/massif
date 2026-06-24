-- WMO weather-interpretation code (Open-Meteo daily `weather_code`, the day's max) — drives the calendar
-- icon and the "orage"/"neige" detection that temperature/precip/wind alone can't give. Nullable: the UI
-- derives a fallback icon from precip/wind/temp when it's absent, so the feature works before a re-sync
-- backfills it. Written by the same column-scoped daily_weather upsert (massif_ingest.weather).
alter table daily_weather add column if not exists weather_code smallint;

comment on column daily_weather.weather_code is 'WMO weather interpretation code (Open-Meteo daily max). Drives the weather icon + storm/snow detection. NULL → UI derives an icon from precip/wind/temp.';
