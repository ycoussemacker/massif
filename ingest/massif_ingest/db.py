"""Supabase access for the ingestion job (service-role client)."""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from .config import Settings


@lru_cache(maxsize=1)
def client() -> Client:
    s = Settings.load()
    return create_client(s.supabase_url, s.supabase_service_key)


def load_sport_map() -> dict[str, dict]:
    """Return {raw_alias: sport_row} for every source_alias, for fast classification."""
    rows = client().table("sports").select("*").execute().data
    mapping: dict[str, dict] = {}
    for row in rows:
        for alias in row.get("source_aliases") or []:
            mapping[alias] = row
        mapping.setdefault(row["code"], row)
    return mapping


def upsert_activity(activity: dict) -> None:
    """Insert/update one activity row, keyed on (source, source_activity_id)."""
    client().table("activities").upsert(
        activity, on_conflict="source,source_activity_id"
    ).execute()


def upsert_daily_metric(metric: dict) -> None:
    client().table("daily_metrics").upsert(metric, on_conflict="local_date").execute()


def save_streams(activity_id: str, streams: dict[str, list]) -> None:
    """streams = {stream_type: [...samples...]}."""
    rows = [
        {"activity_id": activity_id, "stream_type": st, "data": data}
        for st, data in streams.items()
    ]
    if rows:
        client().table("activity_streams").upsert(
            rows, on_conflict="activity_id,stream_type"
        ).execute()
