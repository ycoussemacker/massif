"""Strava normalization: read sport_type (not legacy type), compute pace, route unmatched to
'unknown', and always partition the load. Pure — no network/DB."""

from massif_ingest import strava

SPORT_MAP = {
    "TrailRun": {"id": 2, "code": "trail_running", "taxonomy_group": "paced_endurance",
                 "load_method_ladder": ["hrtss", "session_rpe", "duration_fallback"],
                 "uses_distance": True, "uses_hr": True, "needs_manual_rpe": False},
    "RockClimbing": {"id": 13, "code": "rock_climbing", "taxonomy_group": "technical_strength",
                     "load_method_ladder": ["grade_volume", "session_rpe", "duration_fallback"],
                     "uses_distance": False, "uses_hr": False, "needs_manual_rpe": True},
    "unknown": {"id": 22, "code": "unknown", "taxonomy_group": "other",
                "load_method_ladder": ["session_rpe", "duration_fallback"],
                "needs_manual_rpe": True},
}


def _summary(**over):
    base = {
        "id": 123, "sport_type": "TrailRun", "type": "Run",  # legacy type would mis-map to running
        "start_date": "2026-06-10T06:00:00Z", "start_date_local": "2026-06-10T08:00:00Z",
        "elapsed_time": 3600, "moving_time": 3300, "distance": 10000.0,
        "total_elevation_gain": 500.0, "average_heartrate": 150.4, "max_heartrate": 175.6,
        "name": "Morning trail",
    }
    base.update(over)
    return base


def test_reads_sport_type_not_legacy_type():
    row, sport = strava._build_activity_row(_summary(), SPORT_MAP, {})
    assert sport["code"] == "trail_running"        # NOT 'running' from legacy type='Run'
    assert row["source"] == "strava"
    assert row["source_activity_id"] == "123"      # stringified
    assert row["sport_id"] == 2
    assert row["local_date"] == "2026-06-10"        # 06:00 UTC -> 08:00 Europe/Paris, same day


def test_pace_hr_and_partition():
    row, _ = strava._build_activity_row(_summary(), SPORT_MAP, {})
    assert row["avg_pace_s_per_km"] == 330.0        # 3300 s / 10 km
    assert row["avg_hr"] == 150 and row["max_hr"] == 176
    # training_load is a generated DB column; the row carries only the two channels.
    assert row["aerobic_load"] >= 0 and row["neuromuscular_load"] >= 0
    assert "training_load" not in row
    assert row["rpe_source"] == "estimated"
    assert row["raw_payload"]["id"] == 123


def test_unmatched_sport_routes_to_unknown_and_pending_rpe():
    row, sport = strava._build_activity_row(
        _summary(sport_type="Kitesurf", type="Kitesurf"), SPORT_MAP, {})
    assert sport["code"] == "unknown"
    assert row["rpe_source"] == "pending"           # unknown needs_manual_rpe


def test_no_distance_means_no_pace():
    row, _ = strava._build_activity_row(
        _summary(sport_type="RockClimbing", type="RockClimbing",
                 distance=0.0, average_heartrate=None, max_heartrate=None),
        SPORT_MAP, {})
    assert row["avg_pace_s_per_km"] is None
    assert row["avg_hr"] is None and row["max_hr"] is None


def test_climbing_discipline_from_text():
    f = strava._climbing_sport_code
    assert f("RockClimbing", "Séance falaise au Saussois", None) == "rock_climbing"
    assert f("RockClimbing", "Bloc à Bleau", None) == "bouldering"
    assert f("RockClimbing", "Voie en salle", None) == "indoor_climbing"
    assert f("RockClimbing", "Grimpe", None) == "indoor_climbing"          # nothing said -> voie salle
    assert f("Bouldering", "", None) == "bouldering"                       # Strava bloc stays bloc
    assert f("RockClimbing", "Session", "grosse journée en falaise") == "rock_climbing"  # from description


def test_user_rpe_drives_session_rpe():
    row, sport = strava._build_activity_row(
        _summary(sport_type="RockClimbing", type="RockClimbing", distance=0.0,
                 average_heartrate=None, max_heartrate=None, elapsed_time=3600),
        SPORT_MAP, {}, user_rpe=7)
    assert sport["code"] == "rock_climbing"
    assert row["perceived_rpe"] == 7
    assert row["rpe_source"] == "user"
    assert row["load_method_used"] == "session_rpe"        # grade_volume None -> session_rpe
    # 1h at IF 0.7 -> 0.49*100 = 49 pts; technical_strength split 0.15 / 0.85
    assert abs(row["aerobic_load"] - 49 * 0.15) < 0.5
    assert row["neuromuscular_load"] > row["aerobic_load"]


def test_local_date_uses_athlete_tz_across_midnight():
    # 23:30 UTC on 2026-06-10 is 01:30 on 2026-06-11 in Europe/Paris (UTC+2 in summer).
    row, _ = strava._build_activity_row(
        _summary(start_date="2026-06-10T23:30:00Z"), SPORT_MAP, {}, tz="Europe/Paris")
    assert row["local_date"] == "2026-06-11"


def test_vertical_loss_hysteresis():
    # up to 102, drop to 90 (-12 banked), up to 91, drop to 80 (-11 banked) => 23 m of descent.
    assert strava.vertical_loss_from_altitude([100, 101, 102, 90, 91, 80], deadband_m=2.0) == 23.0
    assert strava.vertical_loss_from_altitude([100, 99.5, 100, 99.6, 100]) == 0.0   # jitter rejected
    assert strava.vertical_loss_from_altitude([]) == 0.0


# ── heat & altitude extraction (docs/research/heat-altitude.md) ───────────────────────────────────

def test_altitude_stats():
    # max + mean of the stream; time_high = (fraction of samples ≥ ~1500 m) × duration.
    mx, avg, th = strava.altitude_stats([600, 900, 1500, 1800, 2400, 2000, 1000], duration_s=3600)
    assert mx == 2400.0
    assert avg == 1457.1                              # 10200 / 7, rounded to 0.1
    assert th == round((4 / 7) * 3600)                # 4 of 7 samples ≥ 1500 m
    assert strava.altitude_stats([], duration_s=3600) == (None, None, None)
    assert strava.altitude_stats([1000, 1100], duration_s=None)[2] is None  # no duration → no dose


_RIDE_MAP = {"Ride": {"id": 1, "code": "cycling", "taxonomy_group": "paced_endurance",
                      "load_method_ladder": ["tss", "duration_fallback"],
                      "uses_distance": True, "uses_hr": True, "needs_manual_rpe": False},
             "unknown": SPORT_MAP["unknown"]}


def test_build_row_sets_env_and_altitude_corrects_power_only():
    act = _summary(sport_type="Ride", type="Ride", average_watts=200, weighted_average_watts=200,
                   average_temp=31, distance=0.0, average_heartrate=None, max_heartrate=None)
    flat, _ = strava._build_activity_row(act, _RIDE_MAP, {"ftp_watts": 250})
    high, _ = strava._build_activity_row(act, _RIDE_MAP, {"ftp_watts": 250},
                                         alt_stats=(2400.0, 1857.1, 600))
    assert flat.get("avg_temp_c") == 31               # ambient temp from the summary, always when present
    assert "avg_altitude_m" not in flat               # altitude fields only set when alt_stats provided
    assert high["max_altitude_m"] == 2400.0 and high["avg_altitude_m"] == 1857.1
    assert high["time_high_altitude_s"] == 600
    assert high["load_method_used"] == "tss"
    assert high["aerobic_load"] > flat["aerobic_load"]  # altitude lifts the power (tss) load — rec 3


def test_build_row_resolves_thresholds_by_date():
    # A lower FTP recorded as-of the activity date raises the tss load vs the current profile — rec 2.
    act = _summary(sport_type="Ride", type="Ride", average_watts=200, weighted_average_watts=200,
                   distance=0.0, average_heartrate=None, max_heartrate=None)
    cur, _ = strava._build_activity_row(act, _RIDE_MAP, {"ftp_watts": 250})
    hist, _ = strava._build_activity_row(act, _RIDE_MAP, {"ftp_watts": 250},
                                         threshold_history=[{"effective_date": "2026-01-01", "ftp_watts": 200}])
    assert hist["aerobic_load"] > cur["aerobic_load"]   # FTP resolved to 200 as-of the date → higher IF


# ── refresh-token source precedence (web OAuth → integration_tokens) over .env ────────────────
from types import SimpleNamespace


def _settings(refresh):
    return SimpleNamespace(strava_refresh_token=refresh)


def test_refresh_token_prefers_db_over_env():
    # integration_tokens (written by the UI's "Connecter Strava") wins over the legacy .env token.
    assert strava._select_refresh_token({"refresh_token": "db_tok"}, _settings("env_tok")) == "db_tok"


def test_refresh_token_falls_back_to_env():
    assert strava._select_refresh_token({}, _settings("env_tok")) == "env_tok"
    assert strava._select_refresh_token({"refresh_token": None}, _settings("env_tok")) == "env_tok"


def test_refresh_token_none_when_unset():
    assert strava._select_refresh_token({}, _settings(None)) is None


def test_epoch_to_iso():
    assert strava._epoch_to_iso(None) is None
    assert strava._epoch_to_iso(0) is None
    iso = strava._epoch_to_iso(1_700_000_000)
    assert iso is not None and iso.startswith("2023-11-14T")
