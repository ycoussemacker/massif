"""Garmin Connect ingestion via python-garminconnect: the recovery side Strava can't see.

Pulls sleep stages, overnight HRV, Body Battery, resting HR, stress, training readiness/status.
First run logs in (handling MFA) and caches OAuth tokens in GARMIN_TOKEN_DIR; subsequent runs
reuse and auto-refresh them, so the nightly job runs unattended.
"""

from __future__ import annotations

from .config import Settings


def login(s: Settings):
    """Return an authenticated Garmin client, reusing cached tokens when possible."""
    from garminconnect import Garmin

    try:
        client = Garmin()
        client.login(s.garmin_token_dir)  # reuse cached tokens
        return client
    except Exception:
        if not (s.garmin_email and s.garmin_password):
            raise RuntimeError("Garmin credentials missing and no cached token — see .env.example")
        client = Garmin(
            email=s.garmin_email,
            password=s.garmin_password,
            prompt_mfa=lambda: input("Garmin MFA code: "),
        )
        client.login(s.garmin_token_dir)  # writes/refreshes tokens
        return client


def fetch_day(client, date_str: str) -> dict:
    """Pull the recovery metrics for one ISO date (YYYY-MM-DD) into a daily_metrics partial row."""
    sleep = client.get_sleep_data(date_str) or {}
    hrv = client.get_hrv_data(date_str) or {}
    battery = client.get_body_battery(date_str, date_str) or []
    rhr = client.get_rhr_day(date_str) or {}
    stress = client.get_stress_data(date_str) or {}
    readiness = _safe(client, "get_training_readiness", date_str)

    # TODO (Phase 3): map the raw Garmin payloads to daily_metrics columns. Shapes vary by
    # device/firmware, so normalize defensively (sleep_score, sleep_duration_s, hrv_overnight_ms,
    # resting_hr, body_battery_high/low, stress_avg, training_readiness).
    return {
        "local_date": date_str,
        "_raw": {
            "sleep": sleep,
            "hrv": hrv,
            "battery": battery,
            "rhr": rhr,
            "stress": stress,
            "readiness": readiness,
        },
    }


def _safe(client, method: str, *args):
    fn = getattr(client, method, None)
    if fn is None:
        return None
    try:
        return fn(*args)
    except Exception:
        return None


def sync(days: int = 7) -> int:
    """Pull the last `days` of Garmin recovery metrics and upsert into daily_metrics."""
    # TODO (Phase 3): iterate the last `days`, fetch_day, normalize, db.upsert_daily_metric.
    raise NotImplementedError("Garmin sync wiring lands in Phase 3")
