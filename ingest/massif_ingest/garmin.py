"""Garmin Connect ingestion via python-garminconnect: the recovery side Strava can't see.

Pulls sleep stages, overnight HRV, Body Battery, resting HR, stress, training readiness/status.
First run logs in (handling MFA) and caches OAuth tokens in GARMIN_TOKEN_DIR; subsequent runs
reuse and auto-refresh them, so the nightly job runs unattended.

The raw payload shapes vary by device/firmware and are undocumented (no official API), so
`_normalize` digs defensively through several known key-paths and falls back to None — it should
be re-checked against the first real pull. It writes ONLY recovery columns + local_date, never the
load/model columns: daily_metrics is split between this writer and the load rollup, keyed on
local_date, and the two must never clobber each other.
"""

from __future__ import annotations

import json
import os
from datetime import date, timedelta

from . import db, zones
from .config import Settings

# Garmin HRV status strings -> daily_metrics.hrv_status CHECK values.
_HRV_STATUS = {"BALANCED": "balanced", "LOW": "low", "UNBALANCED": "unbalanced", "POOR": "poor"}


def _token_file(s: Settings) -> str:
    """The garminconnect token cache file inside the token dir (garminconnect names it this)."""
    return os.path.join(s.garmin_token_dir, "garmin_tokens.json")


def hydrate_token(s: Settings) -> bool:
    """Cloud/no-Mac runs: if there's no local token file but Supabase holds the Garmin token blob,
    write it to the token dir so login() can reuse it — skipping the MFA-gated first login that a
    stateless runner can't answer. No-op when a local token already exists (the Mac's path)."""
    path = _token_file(s)
    if os.path.exists(path):
        return False
    blob = (db.load_integration_token("garmin") or {}).get("data")
    if not blob:
        return False
    os.makedirs(s.garmin_token_dir, exist_ok=True)
    with open(path, "w") as f:
        json.dump(blob, f)
    return True


def persist_token(s: Settings) -> bool:
    """Mirror the (possibly just-refreshed) local token blob back to Supabase so the NEXT run on any
    machine starts from the current refresh token. garminconnect rotates + dumps the token to disk on
    refresh (client._refresh_session), so reading the file after login captures the rotation. Safe to
    call from the Mac too — it just keeps the cloud copy warm and ready for the no-Mac cutover."""
    path = _token_file(s)
    if not os.path.exists(path):
        return False
    try:
        with open(path) as f:
            blob = json.load(f)
    except Exception:
        return False
    db.save_integration_token("garmin", {"data": blob})
    return True


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
    """Pull the raw Garmin recovery payloads for one ISO date (YYYY-MM-DD).

    Every provider call goes through _safe: python-garminconnect raises (connection / 429 / 5xx)
    on transient errors, and `or {}` only handles a returned None — not an exception. A single
    failing endpoint must not abort the whole day."""
    return {
        "sleep": _safe(client, "get_sleep_data", date_str) or {},
        "hrv": _safe(client, "get_hrv_data", date_str) or {},
        "battery": _safe(client, "get_body_battery", date_str, date_str) or [],
        "rhr": _safe(client, "get_rhr_day", date_str) or {},
        "stress": _safe(client, "get_stress_data", date_str) or {},
        "readiness": _safe(client, "get_training_readiness", date_str),
        # MaxMET payload carries Garmin/Firstbeat heat & altitude acclimation (CONTEXT for the coach, not
        # a load input — see docs/research/heat-altitude.md). One more endpoint; _safe isolates failures.
        "maxmet": _safe(client, "get_max_metrics", date_str),
    }


def fetch_hr_zones(client):
    """Best-effort pull of the athlete's configured HR training zones from Garmin (athlete-level, not
    per-day). Tries the library method if this garminconnect version exposes one, else the raw
    biometric-service endpoint via connectapi. Returns the raw payload (list/dict) or None — the API is
    undocumented + device-variable, so the payload is parsed defensively in zones.normalize_garmin_zones."""
    raw = _safe(client, "get_heart_rate_zones")  # newer python-garminconnect may expose this
    if raw:
        return raw
    fn = getattr(client, "connectapi", None)  # raw-endpoint escape hatch (garth-backed)
    if fn is None:
        return None
    try:
        return fn("/biometric-service/heartRateZones")
    except Exception:
        return None


def sync_hr_zones(client) -> bool:
    """Fetch + store the athlete's real HR zones from Garmin (once per run). Best-effort: an unreadable
    or absent payload leaves athlete_profile.hr_zones for sync.py's computed fallback. Returns True iff
    Garmin zones were written. Never raises (callers wrap, but isolate here too)."""
    try:
        blob = zones.normalize_garmin_zones(fetch_hr_zones(client))
    except Exception:
        blob = None
    if not blob:
        return False
    db.upsert_hr_zones(blob)
    return True


def sleep_ready(client, date_str: str | None = None) -> bool:
    """True once Garmin has finalized last night's sleep for `date_str` (default: today, local).

    The morning poller uses this to fire the nightly run right after the athlete wakes and the watch
    syncs — a finalized session has an end timestamp and a non-zero duration, which only appears once
    the night is processed (so the coach briefing sees that morning's recovery, not yesterday's)."""
    d = date_str or date.today().isoformat()
    data = _safe(client, "get_sleep_data", d) or {}
    dto = data.get("dailySleepDTO") if isinstance(data, dict) else None
    if not isinstance(dto, dict):
        return False
    ended = dto.get("sleepEndTimestampLocal") or dto.get("sleepEndTimestampGMT")
    secs = dto.get("sleepTimeSeconds")
    return bool(ended) and isinstance(secs, (int, float)) and secs > 0


# ── pure normalization (no I/O; unit-tested with fixtures) ───────────────────────────────────

def _dig(obj, *paths):
    """First non-None value reachable by any key-path. Ints index lists; strings index dicts."""
    for path in paths:
        cur = obj
        for key in path:
            if isinstance(key, int) and isinstance(cur, (list, tuple)):
                cur = cur[key] if -len(cur) <= key < len(cur) else None
            elif isinstance(cur, dict):
                cur = cur.get(key)
            else:
                cur = None
            if cur is None:
                break
        if cur is not None:
            return cur
    return None


def _int(v):
    return int(round(v)) if isinstance(v, (int, float)) else None


def _num(v):
    return float(v) if isinstance(v, (int, float)) else None


def _hrv_status(v):
    return _HRV_STATUS.get(str(v).upper()) if v else None


def _body_battery(battery):
    """(high, low, wake) from a Body Battery payload. Points look like [ts_ms, status, level];
    the level is the entry in 0..100, wake is the day's first such reading."""
    arr = None
    if isinstance(battery, list) and battery:
        arr = _dig(battery[0], ("bodyBatteryValuesArray",))
    elif isinstance(battery, dict):
        arr = battery.get("bodyBatteryValuesArray")
    if not isinstance(arr, list):
        return None, None, None
    levels = []
    for pt in arr:
        if isinstance(pt, (list, tuple)):
            plausible = [x for x in pt if isinstance(x, (int, float)) and 0 <= x <= 100]
            if plausible:
                levels.append(plausible[-1])  # ts is a large epoch; the 0..100 value is the level
        elif isinstance(pt, (int, float)) and 0 <= pt <= 100:
            levels.append(pt)
    if not levels:
        return None, None, None
    return max(levels), min(levels), levels[0]


def _readiness(readiness):
    if isinstance(readiness, list) and readiness:
        return _dig(readiness[0], ("score",))
    if isinstance(readiness, dict):
        return _dig(readiness, ("score",))
    return None


def _acclimation(maxmet):
    """(heat_acclimation_pct, altitude_acclimation_m) from Garmin's MaxMET payload. The acclimation lives
    under heatAltitudeAcclimation; the payload is a list (one item per requested date) or a bare dict.
    Defensive like the rest of this module — any missing path → (None, None)."""
    obj = maxmet[0] if isinstance(maxmet, list) and maxmet else maxmet
    if not isinstance(obj, dict):
        return None, None
    haa = obj.get("heatAltitudeAcclimation")
    if not isinstance(haa, dict):
        return None, None
    return _int(haa.get("heatAcclimationPercentage")), _int(haa.get("altitudeAcclimation"))


def _normalize(date_str: str, raw: dict) -> dict:
    """Map the raw Garmin payload bundle to a daily_metrics recovery partial (recovery cols only)."""
    sleep = raw.get("sleep") if isinstance(raw.get("sleep"), dict) else {}
    hrv = raw.get("hrv") if isinstance(raw.get("hrv"), dict) else {}
    rhr = raw.get("rhr") if isinstance(raw.get("rhr"), dict) else {}
    stress = raw.get("stress") if isinstance(raw.get("stress"), dict) else {}
    dto = sleep.get("dailySleepDTO") if isinstance(sleep.get("dailySleepDTO"), dict) else {}
    hrv_summary = hrv.get("hrvSummary") if isinstance(hrv.get("hrvSummary"), dict) else {}
    bb_high, bb_low, bb_wake = _body_battery(raw.get("battery"))
    heat_acc, alt_acc = _acclimation(raw.get("maxmet"))

    return {
        "local_date": date_str,
        "sleep_score": _int(_dig(dto, ("sleepScores", "overall", "value"))
                            or _dig(sleep, ("sleepScores", "overall", "value"))),
        "sleep_duration_s": _int(dto.get("sleepTimeSeconds") or sleep.get("sleepTimeSeconds")),
        "sleep_deep_s": _int(dto.get("deepSleepSeconds")),
        "sleep_rem_s": _int(dto.get("remSleepSeconds")),
        "hrv_overnight_ms": _num(hrv_summary.get("lastNightAvg")),
        "hrv_7d_avg_ms": _num(hrv_summary.get("weeklyAvg")),
        "hrv_status": _hrv_status(hrv_summary.get("status")),
        "resting_hr": _int(_dig(
            rhr,
            ("restingHeartRate",),
            ("allMetrics", "metricsMap", "WELLNESS_RESTING_HEART_RATE", 0, "value"),
        )),
        "body_battery_high": _int(bb_high),
        "body_battery_low": _int(bb_low),
        "body_battery_wake": _int(bb_wake),
        "stress_avg": _int(stress.get("avgStressLevel")),
        "training_readiness": _int(_readiness(raw.get("readiness"))),
        # Heat/altitude acclimation — CONTEXT for interpreting HR & recovery, not a load input.
        "heat_acclimation_pct": heat_acc,
        "altitude_acclimation_m": alt_acc,
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
    """Pull the last `days` of Garmin recovery metrics and upsert into daily_metrics.

    The trailing window re-pulls recent days every run, so two safeguards protect already-stored
    data: (1) each day is isolated — one bad date is skipped, not fatal; (2) None-valued metrics are
    stripped before the upsert, so a partial/empty re-pull only updates the fields it actually has
    and never NULLs out good recovery already on the row. A day with no recovery at all is skipped.
    """
    s = Settings.load()
    hydrate_token(s)        # cloud: rebuild the token file from Supabase before login
    client = login(s)
    persist_token(s)        # capture any refresh-rotation back to Supabase for the next run
    # Athlete-level HR training zones — pull the watch's REAL zones so the coach's "Z2" matches it.
    # Best-effort + isolated: a failure here must not abort the recovery pull below.
    try:
        if sync_hr_zones(client):
            print("garmin: hr zones updated")
    except Exception as e:
        print(f"garmin: hr zones skipped ({type(e).__name__}: {e})")
    today = date.today()
    count = 0
    for i in range(days):
        date_str = (today - timedelta(days=i)).isoformat()
        try:
            metric = _normalize(date_str, fetch_day(client, date_str))
        except Exception as e:
            print(f"garmin: skipped {date_str} ({type(e).__name__}: {e})")
            continue
        recovery = {k: v for k, v in metric.items() if v is not None}
        if len(recovery) <= 1:  # only local_date survived -> no real data, don't write/clobber
            continue
        db.upsert_daily_metric(recovery)
        count += 1
    return count
