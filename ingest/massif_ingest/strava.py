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
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests

from . import db, load
from .config import Settings

API = "https://www.strava.com/api/v3"
TOKEN_URL = "https://www.strava.com/oauth/token"

# Strava activity stream keys that map to a stream_type the DB accepts (see the
# activity_streams.stream_type CHECK constraint). 'velocity' is the Strava speed stream.
_DB_STREAM_TYPES = {"time", "hr", "pace", "velocity", "distance", "altitude", "grade", "power", "cadence"}

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


def _select_refresh_token(token_row: dict, s: Settings) -> str | None:
    """Pick the Strava refresh token. The integration_tokens row (written by the web UI's
    "Connecter Strava" OAuth flow) takes precedence over the legacy STRAVA_REFRESH_TOKEN in .env."""
    return (token_row or {}).get("refresh_token") or s.strava_refresh_token


def _epoch_to_iso(epoch: int | None) -> str | None:
    if not epoch:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _start_epoch(act: dict) -> int:
    """Unix epoch of a summary activity's start (UTC). Used to decide whether it's recent enough to
    warrant the per-activity stream/detail fetches during a deep historical backfill."""
    try:
        dt = datetime.fromisoformat(act["start_date"])
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return 0


def get_access_token(s: Settings) -> str:
    """Exchange the refresh token for a short-lived access token.

    Reads the refresh token from integration_tokens (web OAuth) first, falling back to .env. Strava
    rotates refresh tokens, so the rotated set is persisted back to integration_tokens — that also
    migrates a .env-only token into the DB the first time, after which the UI is the source of truth.
    """
    if not (s.strava_client_id and s.strava_client_secret):
        raise RuntimeError("Strava client credentials missing (STRAVA_CLIENT_ID/SECRET) — see .env.example")

    token_row = db.load_integration_token("strava")
    refresh_token = _select_refresh_token(token_row, s)
    if not refresh_token:
        raise RuntimeError(
            "No Strava refresh token — connect Strava from the Profil page (web UI) "
            "or set STRAVA_REFRESH_TOKEN in .env"
        )

    resp = requests.post(
        TOKEN_URL,
        data={
            "client_id": s.strava_client_id,
            "client_secret": s.strava_client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
        timeout=30,
    )
    resp.raise_for_status()
    tok = resp.json()

    # Persist the (possibly rotated) token set so the next run and the UI's connection panel stay current.
    db.save_integration_token("strava", {
        "access_token": tok.get("access_token"),
        "refresh_token": tok.get("refresh_token") or refresh_token,
        "expires_at": _epoch_to_iso(tok.get("expires_at")),
        "scope": token_row.get("scope"),
        "athlete_id": token_row.get("athlete_id"),
    })
    return tok["access_token"]


def _get(token: str, path: str, params: dict, *, max_retries: int = 4) -> requests.Response:
    """GET against the Strava API, backing off on 429 (100 req / 15 min, 1000 / day)."""
    headers = {"Authorization": f"Bearer {token}"}
    resp = None
    for attempt in range(max_retries):
        resp = requests.get(f"{API}{path}", headers=headers, params=params, timeout=30)
        # Return on success/other status, or give up on the final attempt — never sleep then.
        if resp.status_code != 429 or attempt == max_retries - 1:
            return resp  # caller's raise_for_status surfaces a final 429
        # Respect a numeric Retry-After; else exponential backoff capped at the 15-min window.
        try:
            wait = int(resp.headers["Retry-After"])
        except (KeyError, ValueError):
            wait = min(60 * (2**attempt), 900)
        time.sleep(wait)
    return resp


def fetch_activities(token: str, after_epoch: int, per_page: int = 100) -> list[dict]:
    """Pull summary activities created after `after_epoch` (paginated)."""
    out: list[dict] = []
    page = 1
    while True:
        resp = _get(token, "/athlete/activities",
                    {"after": after_epoch, "per_page": per_page, "page": page})
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        out.extend(batch)
        page += 1
    return out


def fetch_streams(token: str, activity_id: int) -> dict[str, list]:
    """Pull per-second streams for one activity (only for sports that have them)."""
    resp = _get(token, f"/activities/{activity_id}/streams",
                {"keys": ",".join(STREAM_KEYS), "key_by_type": "true"})
    if resp.status_code == 404:
        return {}
    resp.raise_for_status()
    raw = resp.json()
    return {STREAM_KEYS[k]: v["data"] for k, v in raw.items() if k in STREAM_KEYS}


def fetch_activity_detail(token: str, activity_id: int) -> dict:
    """Pull the full activity (the summary lacks `description`). Used to classify climbing discipline."""
    resp = _get(token, f"/activities/{activity_id}", {"include_all_efforts": "false"})
    if resp.status_code == 404:
        return {}
    resp.raise_for_status()
    return resp.json()


def _climbing_sport_code(sport_type: str, name: str | None, description: str | None) -> str:
    """Split grande voie / bloc / voie en salle / falaise from the Strava title + description (the athlete
    notes it there). 'grande voie' (multi-pitch) is checked first — it contains 'voie' but is its own
    sport. Defaults to indoor route ('voie en salle') when nothing is mentioned; Strava 'Bouldering' stays
    bloc. Maps to existing sports: grande_voie / bouldering / indoor_climbing / rock_climbing."""
    text = f"{name or ''} {description or ''}".lower()
    if any(k in text for k in ("grande voie", "grandes voies", "multipitch", "multi-pitch", "multi pitch")):
        return "grande_voie"
    if "bloc" in text or "boulder" in text:
        return "bouldering"
    if any(k in text for k in ("falaise", "crag", "extérieur", "exterieur", "outdoor", "dehors", "rocher")):
        return "rock_climbing"
    if any(k in text for k in ("voie", "salle", "indoor", "gym", "mur")):
        return "indoor_climbing"
    return "bouldering" if sport_type == "Bouldering" else "indoor_climbing"


def _local_date(started_at: str, tz: str) -> str:
    """Calendar date of the activity in the ATHLETE's timezone — the daily rollup buckets by this,
    so it must follow the documented athlete-tz contract, not Strava's activity-local clock."""
    dt = datetime.fromisoformat(started_at)  # Strava start_date is UTC ISO8601 ('Z' ok on 3.11+)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.astimezone(ZoneInfo(tz)).date().isoformat()


def vertical_loss_from_altitude(altitude: list, deadband_m: float = 2.0) -> float:
    """Descent (D-) in metres from an altitude stream, with hysteresis to reject GPS/baro jitter:
    bank a drop only once it exceeds `deadband_m` below the local high-water mark, then rebaseline.
    Provisional — Phase 4 refines with proper smoothing. Strava summaries don't expose descent."""
    loss = 0.0
    peak = None
    for alt in altitude:
        if not isinstance(alt, (int, float)):
            continue
        if peak is None or alt > peak:
            peak = alt
        elif peak - alt >= deadband_m:
            loss += peak - alt
            peak = alt
    return round(loss, 1)


def altitude_stats(
    altitude: list, duration_s: int | None = None,
    threshold_m: float = load.ALT_HYPOXIA_THRESHOLD_M,
) -> tuple[float | None, float | None, int | None]:
    """(max_m, avg_m, time_high_s) from an altitude stream — the heat/altitude CONTEXT signals (rec 1) and
    the avg used by the tss/rtss altitude correction (rec 3). time_high is the exposure dose above
    `threshold_m`, approximated as (fraction of samples above it) × duration (Strava streams are ~1 Hz but
    not guaranteed evenly sampled). All None when the stream is empty/absent → columns left unset."""
    vals = [a for a in altitude if isinstance(a, (int, float))]
    if not vals:
        return None, None, None
    mx = round(max(vals), 1)
    avg = round(sum(vals) / len(vals), 1)
    high_frac = sum(1 for a in vals if a >= threshold_m) / len(vals)
    time_high = round(high_frac * duration_s) if duration_s else None
    return mx, avg, time_high


def _build_activity_row(
    act: dict, sport_map: dict[str, dict], profile: dict, tz: str = "Europe/Paris",
    user_rpe: int | None = None, descent_m: float | None = None, params: dict | None = None,
    threshold_history: list[dict] | None = None,
    alt_stats: tuple[float | None, float | None, int | None] | None = None,
    fam_ratios: dict[str, float] | None = None,
    differential_rpe: dict | None = None,
) -> tuple[dict, dict]:
    """Pure (no I/O): turn a Strava summary activity into an `activities` row + its sport row.

    Reads `sport_type`, NOT the legacy `type` (which collapses road/gravel/MTB to 'Ride' and
    road/trail to 'Run'). Unmatched sport strings route to the 'unknown' sport (flagged, not lost).
    `threshold_history` (athlete_thresholds) resolves the thresholds as-of the activity's date; `alt_stats`
    = (max_m, avg_m, time_high_s) from the altitude stream — heat/altitude context + the avg the tss/rtss
    altitude correction reads. Both optional → today's behaviour when absent.
    """
    sport_type = act.get("sport_type") or act.get("type") or "Workout"
    sport = sport_map.get(sport_type) or sport_map["unknown"]

    # Climbing: split bloc / voie salle / falaise from the activity text (description fetched in sync).
    if sport.get("taxonomy_group") == "technical_strength":
        sport = sport_map.get(_climbing_sport_code(sport_type, act.get("name"), act.get("description"))) or sport

    moving_s = act.get("moving_time")
    distance_m = act.get("distance")
    avg_pace = None
    if distance_m and moving_s and distance_m > 0:
        avg_pace = round(moving_s / (distance_m / 1000.0), 2)

    started_at = act["start_date"]  # UTC ISO8601
    local_date = _local_date(started_at, tz)

    avg_hr, max_hr = act.get("average_heartrate"), act.get("max_heartrate")
    row: dict = {
        "source": "strava",
        "source_activity_id": str(act["id"]),
        "sport_id": sport["id"],
        "started_at": started_at,
        "local_date": local_date,
        "duration_s": int(act.get("elapsed_time") or 0),
        "moving_s": int(moving_s) if moving_s is not None else None,
        "distance_m": distance_m,
        "vertical_gain_m": act.get("total_elevation_gain"),
        "avg_hr": round(avg_hr) if avg_hr else None,
        "max_hr": round(max_hr) if max_hr else None,
        "avg_power_w": act.get("average_watts"),
        "np_power_w": act.get("weighted_average_watts"),
        "avg_pace_s_per_km": avg_pace,
        "calories": act.get("calories"),
        # A user-logged RPE (carried across re-syncs) drives session_rpe; otherwise needs_manual_rpe
        # sports await a one-tap RPE and the rest have load auto-estimated from HR/pace/etc.
        "perceived_rpe": user_rpe,
        "rpe_source": "user" if user_rpe else ("pending" if sport.get("needs_manual_rpe") else "estimated"),
        "sport_specific": {"strava_name": act.get("name"), "strava_sport_type": sport_type},
        "raw_payload": act,
    }

    # D- (descent) is derived from the altitude stream by sync() and passed in BEFORE load is computed
    # (the eccentric-descent term needs it). Only set it when actually derived this run, so a transient
    # missing stream on a re-sync doesn't blank a previously-stored D- (the upsert leaves it untouched).
    if descent_m is not None:
        row["vertical_loss_m"] = descent_m

    # Heat context: Strava's device-reported ambient temperature (only set when present, so a temp-less
    # device / re-sync never blanks a stored value). Altitude stats (from the stream, same gating as D-):
    # avg_altitude_m must land on the row BEFORE compute_load — the tss/rtss altitude correction reads it.
    if act.get("average_temp") is not None:
        row["avg_temp_c"] = act.get("average_temp")
    if alt_stats is not None:
        max_alt, avg_alt, time_high = alt_stats
        if max_alt is not None:
            row["max_altitude_m"] = max_alt
        if avg_alt is not None:
            row["avg_altitude_m"] = avg_alt
        if time_high is not None:
            row["time_high_altitude_s"] = time_high

    # Descent-familiarity (repeated-bout): the ratio for this date (None below the gate). It is passed to
    # compute_load but NOT written on `row` — it's an in-memory factor, NOT a DB column (the factor is baked
    # into neuromuscular_load), so persisting it would 422 the upsert. recompute_activity_loads re-derives
    # it across full history (the source of truth).
    fam = fam_ratios.get(local_date) if fam_ratios is not None else None

    # Differential RPE sub-scores (Phase 2) re-applied from the DB so a re-sync preserves the athlete's
    # perception-derived channel split (compute_load reads them when session_rpe wins). Strava never
    # supplies these; they only exist if the athlete entered them in the web app. (These ARE real columns.)
    if differential_rpe:
        for k in ("rpe_cardio", "rpe_legs", "rpe_grip"):
            if differential_rpe.get(k) is not None:
                row[k] = differential_rpe[k]

    # Resolve thresholds as-of this activity's date (rec 2): empty history → the base profile unchanged.
    eff_profile = load.resolve_profile(profile, threshold_history, local_date)
    result = load.compute_load({**row, "descent_familiarity": fam}, sport, eff_profile, params)
    row["aerobic_load"] = result.aerobic_load
    row["neuromuscular_load"] = result.neuromuscular_load
    row["load_method_used"] = result.load_method_used
    row["intensity_factor"] = result.intensity_factor
    row["effective_days"] = result.effective_days
    row["needs_review"] = result.needs_review
    return row, sport


def _normalize_streams(streams: dict[str, list]) -> dict[str, list]:
    """Keep only non-empty streams whose type the DB accepts (activity_streams CHECK)."""
    return {k: v for k, v in streams.items() if k in _DB_STREAM_TYPES and v}


def sync(after_days: int = 30, stream_days: int | None = None) -> int:
    """Pull Strava activities created in the last `after_days`, normalize, compute load, upsert.

    `stream_days` bounds the EXPENSIVE per-activity calls (streams + climbing detail) to activities
    within that many days; older ones load from the summary alone. This makes a deep historical
    backfill (after_days=3650) rate-limit-safe — recent activities keep full D-/stream accuracy
    (they drive ATL/TSB), while the long tail just feeds the CTL warm-up where D- precision matters
    far less. None = fetch streams for every eligible activity (the original behaviour). Returns count.
    """
    s = Settings.load()
    token = get_access_token(s)
    now_epoch = int(time.time())
    after_epoch = now_epoch - after_days * 86400
    stream_cutoff = now_epoch - stream_days * 86400 if stream_days is not None else None

    summaries = fetch_activities(token, after_epoch)
    sport_map = db.load_sport_map()
    profile = db.load_athlete_profile()
    params = db.load_load_params()  # personalized load coefficients (empty → population defaults)
    threshold_history = db.load_threshold_history()  # effective-dated thresholds (empty → base profile)
    user_rpes = db.load_user_rpes("strava")  # re-apply RPEs the user logged in the web app
    user_diff_rpes = db.load_user_differential_rpes("strava")  # + their differential sub-scores (Phase 2)

    # Descent-familiarity ratios from the stored daily D- series (sum of vertical_loss_m per local_date).
    # The recent pull stamps each row from this; --recompute-loads later re-derives it across all history
    # (the source of truth). NB: relies on the <1000-activity PostgREST page; paginate if it ever grows.
    desc_rows = db.client().table("activities").select("local_date,vertical_loss_m").execute().data
    daily_descent: dict[str, float] = {}
    for dr in desc_rows:
        daily_descent[dr["local_date"]] = daily_descent.get(dr["local_date"], 0.0) + float(dr.get("vertical_loss_m") or 0.0)
    fam_ratios = load.descent_familiarity_ratios(daily_descent)

    count = 0
    for act in summaries:
        # Auto-create a sport for any unmatched sport_type (cached for the rest of the run) so no
        # activity is jammed into the generic 'unknown' bucket. 'Workout' is already aliased -> unknown.
        sport_type = act.get("sport_type") or act.get("type") or "Workout"
        if sport_type not in sport_map:
            sport_map[sport_type] = db.get_or_create_sport(sport_type)
        base_sport = sport_map[sport_type]

        # Skip the per-activity API calls (streams + detail) for old activities during a deep backfill.
        recent = stream_cutoff is None or _start_epoch(act) >= stream_cutoff

        # Fetch the full activity for its `description` (the summary omits it). Used for the dashboard's
        # keyword search over descriptions AND to classify climbing discipline (bloc / voie salle /
        # falaise). Done for every recent activity; the `recent`/stream_days gate keeps a deep historical
        # backfill rate-limit-safe (older activities load from the summary alone, no description).
        if recent:
            detail = fetch_activity_detail(token, act["id"])
            if detail.get("description"):
                act["description"] = detail["description"]

        # Fetch streams BEFORE building the row: Strava summaries lack descent, so D- comes from the
        # altitude stream — and load.compute_load needs it to size the eccentric (neuromuscular) cost.
        streams: dict[str, list] = {}
        descent_m: float | None = None
        alt_stats: tuple[float | None, float | None, int | None] | None = None
        if recent and (base_sport.get("uses_distance") or base_sport.get("uses_hr")):
            streams = _normalize_streams(fetch_streams(token, act["id"]))
            if "altitude" in streams:
                descent_m = vertical_loss_from_altitude(streams["altitude"])
                alt_stats = altitude_stats(streams["altitude"], act.get("elapsed_time"))

        row, sport = _build_activity_row(
            act, sport_map, profile, tz=s.timezone, user_rpe=user_rpes.get(str(act["id"])),
            descent_m=descent_m, params=params, threshold_history=threshold_history, alt_stats=alt_stats,
            fam_ratios=fam_ratios, differential_rpe=user_diff_rpes.get(str(act["id"])),
        )
        row["has_streams"] = bool(streams)

        activity_id = db.upsert_activity(row)
        if streams:
            db.save_streams(activity_id, streams)
        count += 1
    return count
