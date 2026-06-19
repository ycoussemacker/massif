"""Strava ingestion: refresh the OAuth token, pull activities + streams.

Phase 1 scaffold — the token refresh and activity fetch are implemented; normalization to the
`activities` row shape calls into `load.compute_load`. Streams are fetched only for GPS/HR sports.

One-time setup (done once, manually):
  1. Create an API app at https://www.strava.com/settings/api
  2. Authorize scope `activity:read_all` and exchange the code for a refresh token.
  3. Put STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN in .env.
After that this module auto-refreshes the access token on every run.
"""

from __future__ import annotations

import time

import requests

from .config import Settings

API = "https://www.strava.com/api/v3"
TOKEN_URL = "https://www.strava.com/oauth/token"

# Strava activity stream keys we care about, mapped to our stream_type vocabulary.
STREAM_KEYS = {
    "heartrate": "hr",
    "velocity_smooth": "velocity",
    "altitude": "altitude",
    "watts": "power",
    "cadence": "cadence",
    "distance": "distance",
    "grade_smooth": "grade",
    "time": "time",
}


def get_access_token(s: Settings) -> str:
    """Exchange the long-lived refresh token for a short-lived access token."""
    if not (s.strava_client_id and s.strava_client_secret and s.strava_refresh_token):
        raise RuntimeError("Strava credentials missing — see .env.example")
    resp = requests.post(
        TOKEN_URL,
        data={
            "client_id": s.strava_client_id,
            "client_secret": s.strava_client_secret,
            "grant_type": "refresh_token",
            "refresh_token": s.strava_refresh_token,
        },
        timeout=30,
    )
    resp.raise_for_status()
    # TODO: if the refresh_token rotates, persist the new one to integration_tokens.
    return resp.json()["access_token"]


def fetch_activities(token: str, after_epoch: int, per_page: int = 100) -> list[dict]:
    """Pull summary activities created after `after_epoch` (paginated)."""
    headers = {"Authorization": f"Bearer {token}"}
    out: list[dict] = []
    page = 1
    while True:
        resp = requests.get(
            f"{API}/athlete/activities",
            headers=headers,
            params={"after": after_epoch, "per_page": per_page, "page": page},
            timeout=30,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        out.extend(batch)
        page += 1
    return out


def fetch_streams(token: str, activity_id: int) -> dict[str, list]:
    """Pull per-second streams for one activity (only for sports that have them)."""
    headers = {"Authorization": f"Bearer {token}"}
    keys = ",".join(STREAM_KEYS.keys())
    resp = requests.get(
        f"{API}/activities/{activity_id}/streams",
        headers=headers,
        params={"keys": keys, "key_by_type": "true"},
        timeout=30,
    )
    if resp.status_code == 404:
        return {}
    resp.raise_for_status()
    raw = resp.json()
    return {STREAM_KEYS[k]: v["data"] for k, v in raw.items() if k in STREAM_KEYS}


def sync(after_days: int = 30) -> int:
    """Pull recent Strava activities, normalize, compute load, upsert. Returns count."""
    # TODO (Phase 2): map each summary activity -> sports row (db.load_sport_map),
    # build the activities row, call load.compute_load, db.upsert_activity, and for
    # GPS/HR sports fetch + db.save_streams. Rate-limit aware (100 req / 15 min).
    raise NotImplementedError("Strava sync wiring lands in Phase 2")
