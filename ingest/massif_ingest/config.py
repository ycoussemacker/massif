"""Central configuration, loaded from environment (.env at repo root or ingest/.env)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load .env from ingest/ first, then repo root, without overriding already-set env vars.
_INGEST_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_INGEST_DIR / ".env")
load_dotenv(_INGEST_DIR.parent / ".env")


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return val


@dataclass(frozen=True)
class Settings:
    # Supabase (service role — server-side writes only)
    supabase_url: str
    supabase_service_key: str
    # Strava
    strava_client_id: str | None
    strava_client_secret: str | None
    strava_refresh_token: str | None
    # Garmin
    garmin_email: str | None
    garmin_password: str | None
    garmin_token_dir: str
    # Athlete
    timezone: str

    @classmethod
    def load(cls) -> "Settings":
        return cls(
            supabase_url=_require("NEXT_PUBLIC_SUPABASE_URL"),
            supabase_service_key=_require("SUPABASE_SERVICE_ROLE_KEY"),
            strava_client_id=os.environ.get("STRAVA_CLIENT_ID"),
            strava_client_secret=os.environ.get("STRAVA_CLIENT_SECRET"),
            strava_refresh_token=os.environ.get("STRAVA_REFRESH_TOKEN"),
            garmin_email=os.environ.get("GARMIN_EMAIL"),
            garmin_password=os.environ.get("GARMIN_PASSWORD"),
            garmin_token_dir=os.path.expanduser(
                os.environ.get("GARMIN_TOKEN_DIR", "~/.garminconnect")
            ),
            timezone=os.environ.get("ATHLETE_TZ", "Europe/Paris"),
        )
