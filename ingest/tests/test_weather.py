"""Open-Meteo normalization: map the daily arrays to daily_weather rows, stay defensive on garbage."""

from massif_ingest import weather

PAYLOAD = {
    "daily": {
        "time": ["2026-06-23", "2026-06-24", "2026-06-25"],
        "temperature_2m_max": [28.4, 31.0, None],
        "temperature_2m_min": [15.1, 16.2, 14.0],
        "apparent_temperature_max": [30.0, 34.5, 26.0],
        "precipitation_sum": [0.0, 2.3, 0.0],
        "wind_speed_10m_max": [12.0, 18.5, 9.0],
        "weather_code": [0, 95, None],
    }
}


def test_normalize_maps_daily_arrays():
    rows = weather._normalize(PAYLOAD)
    assert len(rows) == 3
    assert rows[0]["local_date"] == "2026-06-23"
    assert rows[1]["temp_max_c"] == 31.0 and rows[1]["feels_max_c"] == 34.5  # apparent temp ("feels like")
    assert rows[1]["precip_mm"] == 2.3 and rows[1]["wind_kmh"] == 18.5
    assert rows[0]["weather_code"] == 0 and rows[1]["weather_code"] == 95   # WMO code, stored as int
    assert rows[2]["weather_code"] is None                                  # missing → None
    assert rows[2]["temp_max_c"] is None                                    # missing value → None, no crash
    assert all(r["source"] == "open-meteo" for r in rows)


def test_normalize_defensive_on_garbage():
    assert weather._normalize({}) == []
    assert weather._normalize({"daily": None}) == []
    assert weather._normalize({"daily": {"time": []}}) == []
