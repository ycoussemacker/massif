"""Open-Meteo daily forecast — the UPCOMING heat the coach should read acclimation against.

No API key (Open-Meteo is free/keyless). Resolves the athlete's location from athlete_profile.home_lat/lng,
falling back to the most recent GPS activity's Strava start_latlng, then fetches today−1..+7 of daily
weather and upserts it into daily_weather (column-scoped, keyed on local_date — never touches load/recovery).

This is CONTEXT for prospective coaching advice (dress/hydrate/pace-vs-HR, expect HR drift on hot days),
NOT a training-load input — heat strain is already reflected in HR (see docs/research/heat-altitude.md).
`apparent_temperature_max` ("feels like": humidity + wind + radiation) is the better heat-strain proxy than
dry temperature, so we keep it as feels_max_c.
"""

from __future__ import annotations

import requests

from . import db

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
_DAILY_VARS = ("temperature_2m_max,temperature_2m_min,apparent_temperature_max,"
               "precipitation_sum,wind_speed_10m_max,weather_code")


def _num(arr: list, i: int):
    """arr[i] as float, or None (missing/non-numeric/out-of-range) — defensive like the rest of ingest."""
    if not isinstance(arr, list) or not (-len(arr) <= i < len(arr)):
        return None
    v = arr[i]
    return float(v) if isinstance(v, (int, float)) else None


def _normalize(payload: dict) -> list[dict]:
    """Open-Meteo `daily` arrays → one daily_weather row per date (pure; unit-tested with a fixture)."""
    daily = payload.get("daily") if isinstance(payload, dict) else None
    if not isinstance(daily, dict):
        return []
    dates = daily.get("time") or []
    tmax, tmin = daily.get("temperature_2m_max") or [], daily.get("temperature_2m_min") or []
    feels = daily.get("apparent_temperature_max") or []
    precip, wind = daily.get("precipitation_sum") or [], daily.get("wind_speed_10m_max") or []
    code = daily.get("weather_code") or []
    rows = []
    for i, d in enumerate(dates):
        wc = _num(code, i)
        rows.append({
            "local_date": d,
            "temp_max_c": _num(tmax, i),
            "temp_min_c": _num(tmin, i),
            "feels_max_c": _num(feels, i),
            "precip_mm": _num(precip, i),
            "wind_kmh": _num(wind, i),
            "weather_code": int(wc) if wc is not None else None,  # WMO code (smallint) → UI icon/storm detection
            "source": "open-meteo",
        })
    return rows


def resolve_location() -> tuple[float, float] | None:
    """(lat, lng): the athlete's home if set on athlete_profile, else the most recent GPS activity's start."""
    prof = db.load_athlete_profile()
    lat, lng = prof.get("home_lat"), prof.get("home_lng")
    if lat is not None and lng is not None:
        return float(lat), float(lng)
    return db.latest_activity_coords()


def fetch_forecast(lat: float, lng: float, past_days: int = 1, forecast_days: int = 10) -> list[dict]:
    resp = requests.get(OPEN_METEO, params={
        "latitude": lat, "longitude": lng, "daily": _DAILY_VARS,
        "timezone": "auto", "past_days": past_days, "forecast_days": forecast_days,
    }, timeout=30)
    resp.raise_for_status()
    return _normalize(resp.json())


def sync() -> int:
    """Fetch the forecast for the resolved location and upsert daily_weather. Returns rows written.
    No location (no home set, no GPS activity) → skip gracefully (the coach simply gets no `weather`)."""
    loc = resolve_location()
    if not loc:
        print("weather: no location (set athlete_profile.home_lat/lng or sync a GPS activity) — skipped")
        return 0
    rows = [r for r in fetch_forecast(*loc) if r.get("temp_max_c") is not None]
    if rows:
        db.upsert_weather(rows)
    return len(rows)
