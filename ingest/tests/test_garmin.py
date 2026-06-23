"""Garmin normalization: dig recovery metrics out of the (variable) raw payloads, stay defensive
when keys are missing, and write ONLY recovery columns + local_date (never load/model columns)."""

from massif_ingest import garmin

RAW = {
    "sleep": {"dailySleepDTO": {
        "sleepTimeSeconds": 27000, "deepSleepSeconds": 5400, "remSleepSeconds": 6000,
        "sleepScores": {"overall": {"value": 82}}}},
    "hrv": {"hrvSummary": {"lastNightAvg": 64, "weeklyAvg": 60, "status": "BALANCED"}},
    "battery": [{"bodyBatteryValuesArray": [
        [1700000000000, "MEASURED", 30],
        [1700003600000, "MEASURED", 75],
        [1700007200000, "MEASURED", 55]]}],
    "rhr": {"allMetrics": {"metricsMap": {"WELLNESS_RESTING_HEART_RATE": [{"value": 48}]}}},
    "stress": {"avgStressLevel": 28},
    "readiness": [{"score": 71}],
    "maxmet": [{"heatAltitudeAcclimation": {"heatAcclimationPercentage": 65, "altitudeAcclimation": 1200}}],
}

RECOVERY_KEYS = {
    "sleep_score", "sleep_duration_s", "sleep_deep_s", "sleep_rem_s",
    "hrv_overnight_ms", "hrv_7d_avg_ms", "hrv_status", "resting_hr",
    "body_battery_high", "body_battery_low", "body_battery_wake",
    "stress_avg", "training_readiness",
    "heat_acclimation_pct", "altitude_acclimation_m",
}
LOAD_KEYS = {"daily_load", "daily_aerobic_load", "daily_neuromuscular_load",
             "ctl", "atl", "tsb", "acwr", "vertical_gain_m", "load_by_group"}


def test_normalize_full_payload():
    m = garmin._normalize("2026-06-10", RAW)
    assert m["local_date"] == "2026-06-10"
    assert m["sleep_score"] == 82
    assert m["sleep_duration_s"] == 27000
    assert m["sleep_deep_s"] == 5400 and m["sleep_rem_s"] == 6000
    assert m["hrv_overnight_ms"] == 64.0 and m["hrv_7d_avg_ms"] == 60.0
    assert m["hrv_status"] == "balanced"
    assert m["resting_hr"] == 48                     # dug out of allMetrics.metricsMap
    assert m["body_battery_high"] == 75              # ts excluded, 0..100 level kept
    assert m["body_battery_low"] == 30
    assert m["body_battery_wake"] == 30              # first reading of the day
    assert m["stress_avg"] == 28
    assert m["training_readiness"] == 71             # from list[0].score
    assert m["heat_acclimation_pct"] == 65           # MaxMET heatAltitudeAcclimation
    assert m["altitude_acclimation_m"] == 1200


def test_acclimation_is_defensive():
    # list payload, bare dict, and every missing-path shape → (None, None), never raises.
    assert garmin._acclimation([{"heatAltitudeAcclimation": {"heatAcclimationPercentage": 40,
                                                             "altitudeAcclimation": 800}}]) == (40, 800)
    assert garmin._acclimation({"heatAltitudeAcclimation": {"heatAcclimationPercentage": 12}}) == (12, None)
    assert garmin._acclimation(None) == (None, None)
    assert garmin._acclimation([]) == (None, None)
    assert garmin._acclimation([{"generic": {"vo2MaxValue": 52}}]) == (None, None)


def test_normalize_empty_is_all_none():
    m = garmin._normalize("2026-06-10", {})
    assert m["local_date"] == "2026-06-10"
    assert all(m[k] is None for k in RECOVERY_KEYS)


def test_normalize_writes_only_recovery_columns():
    m = garmin._normalize("2026-06-10", RAW)
    assert set(m) == RECOVERY_KEYS | {"local_date"}
    assert not (set(m) & LOAD_KEYS)                  # column-scoped: never clobbers the load rollup
