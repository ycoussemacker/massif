"""Supabase access for the ingestion job (service-role client)."""

from __future__ import annotations

import re
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


def load_athlete_profile() -> dict:
    """Return the single athlete_profile row (thresholds/weight for load math), or {} if unset."""
    rows = client().table("athlete_profile").select("*").limit(1).execute().data
    return rows[0] if rows else {}


def upsert_hr_zones(zones: dict) -> None:
    """Write the athlete's HR training zones (bpm) onto the single athlete_profile row. Column-scoped to
    hr_zones (+ updated_at) so it never touches thresholds/prefs. Targets the existing row by id; if the
    profile row doesn't exist yet, inserts one carrying just the zones."""
    sb = client()
    existing = sb.table("athlete_profile").select("id").limit(1).execute().data
    if existing:
        sb.table("athlete_profile").update({"hr_zones": zones}).eq("id", existing[0]["id"]).execute()
    else:
        sb.table("athlete_profile").insert({"hr_zones": zones}).execute()


def load_load_params() -> dict:
    """athlete_load_params as {param: value} for load.compute_load / the rollup. Empty when nothing has
    been calibrated yet → the model uses its population defaults (no behaviour change)."""
    try:
        rows = client().table("athlete_load_params").select("param,value").execute().data
    except Exception:
        return {}  # table absent (pre-migration) or transient error → defaults
    return {r["param"]: float(r["value"]) for r in rows if r.get("value") is not None}


def load_threshold_history() -> list[dict]:
    """athlete_thresholds rows (effective-dated thresholds) sorted by effective_date asc, for
    load.resolve_profile. Empty when none recorded → the base athlete_profile is used (no behaviour
    change). Tolerant of the table being absent pre-migration (returns [])."""
    try:
        return (
            client().table("athlete_thresholds").select("*")
            .order("effective_date", desc=False).execute().data
        )
    except Exception:
        return []


def latest_activity_coords() -> tuple[float, float] | None:
    """(lat, lng) of the most recent GPS activity's Strava start_latlng, or None — the fallback location
    for the weather forecast when athlete_profile.home_lat/lng isn't set (indoor activities have []/null)."""
    rows = (client().table("activities").select("raw_payload")
            .order("started_at", desc=True).limit(25).execute().data)
    for r in rows:
        ll = (r.get("raw_payload") or {}).get("start_latlng")
        if isinstance(ll, list) and len(ll) == 2 and all(isinstance(x, (int, float)) for x in ll):
            return float(ll[0]), float(ll[1])
    return None


def upsert_weather(rows: list[dict]) -> None:
    """Upsert daily_weather rows (keyed on local_date), column-scoped to the weather columns only."""
    if rows:
        client().table("daily_weather").upsert(rows, on_conflict="local_date").execute()


def upsert_load_param(param: str, value: float, source: str = "fitted", n_samples: int | None = None) -> None:
    """Insert/update a personalized load coefficient (keyed on param). fitted_at/updated_at: DB defaults."""
    client().table("athlete_load_params").upsert(
        {"param": param, "value": value, "source": source, "n_samples": n_samples},
        on_conflict="param",
    ).execute()


def delete_load_param(param: str) -> None:
    """Remove a personalized coefficient so the model reverts to its population default — used when a
    fit no longer qualifies (e.g. not enough data, or the value no longer beats the default)."""
    client().table("athlete_load_params").delete().eq("param", param).execute()


def load_integration_token(provider: str) -> dict:
    """Return the integration_tokens row for a provider (OAuth tokens written by the web UI), or {}."""
    rows = (
        client().table("integration_tokens").select("*").eq("provider", provider).execute().data
    )
    return rows[0] if rows else {}


def save_integration_token(provider: str, fields: dict) -> None:
    """Upsert a provider's OAuth token fields (keyed on provider). Used to persist Strava's rotated
    refresh token after a refresh so the next run (and the UI's connection panel) stay in sync."""
    row = {"provider": provider, **{k: v for k, v in fields.items() if v is not None}}
    client().table("integration_tokens").upsert(row, on_conflict="provider").execute()


def load_user_rpes(source: str) -> dict[str, int]:
    """{source_activity_id: perceived_rpe} for activities the user RPE'd, so re-syncs don't clobber
    the user's load back to duration_fallback (the manual RPE is re-applied → session_rpe)."""
    rows = (
        client()
        .table("activities")
        .select("source_activity_id,perceived_rpe")
        .eq("source", source)
        .eq("rpe_source", "user")
        .execute()
        .data
    )
    return {r["source_activity_id"]: r["perceived_rpe"]
            for r in rows if r.get("source_activity_id") and r.get("perceived_rpe") is not None}


def load_user_differential_rpes(source: str) -> dict[str, dict]:
    """{source_activity_id: {rpe_cardio, rpe_legs, rpe_grip}} for user-RPE activities that carry differential
    sub-scores, so re-syncs preserve them (the perception-derived channel split is re-applied — Phase 2)."""
    rows = (
        client()
        .table("activities")
        .select("source_activity_id,rpe_cardio,rpe_legs,rpe_grip")
        .eq("source", source)
        .eq("rpe_source", "user")
        .execute()
        .data
    )
    out: dict[str, dict] = {}
    for r in rows:
        sid = r.get("source_activity_id")
        if sid and any(r.get(k) is not None for k in ("rpe_cardio", "rpe_legs", "rpe_grip")):
            out[sid] = {k: r.get(k) for k in ("rpe_cardio", "rpe_legs", "rpe_grip")}
    return out


def slugify_sport(raw_type: str) -> str:
    """Provider sport string -> a sports.code slug. 'Surfing'->'surfing', 'GravelRide'->'gravel_ride'."""
    s = re.sub(r"(?<!^)(?=[A-Z])", "_", raw_type)   # split camel/Pascal case
    s = re.sub(r"[^0-9a-zA-Z]+", "_", s)             # non-alnum -> underscore
    return s.strip("_").lower() or "unknown"


def get_or_create_sport(raw_type: str) -> dict:
    """Resolve an unmatched provider sport string to a sports row, auto-creating one the first time.

    New sports get conservative defaults — taxonomy_group 'other', RPE-based load ladder, and
    needs_manual_rpe=true (so the channel split won't wrongly inflate the aerobic side and the user
    is prompted for an RPE). The raw string is stored as a source_alias so it matches next run. Refine
    taxonomy_group / load_method_ladder later. 'Workout' stays mapped to 'unknown' via the seed.
    """
    code = slugify_sport(raw_type)
    existing = client().table("sports").select("*").eq("code", code).execute().data
    if existing:
        row = existing[0]
        aliases = row.get("source_aliases") or []
        if raw_type not in aliases:  # e.g. Strava 'Surfing' + Garmin 'surfing' -> one sport, two aliases
            row = (
                client()
                .table("sports")
                .update({"source_aliases": aliases + [raw_type]})
                .eq("id", row["id"])
                .execute()
                .data[0]
            )
        return row
    new = {
        "code": code,
        "display_name": raw_type,
        "taxonomy_group": "other",
        "load_method_ladder": ["session_rpe", "duration_fallback"],
        "needs_manual_rpe": True,
        "source_aliases": [raw_type],
    }
    return client().table("sports").insert(new).execute().data[0]


def upsert_activity(activity: dict) -> str:
    """Insert/update one activity row, keyed on (source, source_activity_id). Returns its id."""
    res = (
        client()
        .table("activities")
        .upsert(activity, on_conflict="source,source_activity_id")
        .execute()
    )
    return res.data[0]["id"]


def fetch_activities_for_recompute() -> list[dict]:
    """All activities with the fields load.compute_load reads, for re-applying the load model to
    history after a model change (no provider re-pull). Includes id + sport_id to update/classify."""
    return (
        client()
        .table("activities")
        .select("id,sport_id,local_date,started_at,duration_s,moving_s,avg_hr,np_power_w,avg_power_w,"
                "avg_pace_s_per_km,vertical_gain_m,vertical_loss_m,carried_load_kg,perceived_rpe,"
                "rpe_source,avg_altitude_m,rpe_cardio,rpe_legs,rpe_grip")
        .execute()
        .data
    )


def update_activity_load(activity_id: str, fields: dict) -> None:
    """Update only the load columns of one activity (by id) — used by the history recompute."""
    client().table("activities").update(fields).eq("id", activity_id).execute()


def upsert_daily_metric(metric: dict) -> None:
    client().table("daily_metrics").upsert(metric, on_conflict="local_date").execute()


def upsert_daily_metrics(metrics: list[dict], chunk: int = 500) -> None:
    """Bulk column-scoped upsert of the daily rollup (keyed on local_date), chunked to bound request
    size. Far fewer round-trips than per-day upserts → robust against the cloud REST read-timeouts the
    ~1800-row sequential loop kept hitting. Column-scoped exactly like upsert_daily_metric (only the
    load/model columns are listed, so Garmin recovery columns on existing rows are left untouched)."""
    sb = client()
    for i in range(0, len(metrics), chunk):
        sb.table("daily_metrics").upsert(metrics[i:i + chunk], on_conflict="local_date").execute()


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
