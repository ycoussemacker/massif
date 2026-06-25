"""Heart-rate training zones (bpm) — the athlete's REAL zones, so the coach's "Z2" matches the watch.

Two sources, in priority order (see garmin.py + sync.py):
  1. Garmin (preferred): the zones the athlete actually configured on their watch — `normalize_garmin_zones`
     parses Garmin's heart-rate-zones payload (zone "floors" → bpm bands).
  2. Computed fallback: `compute_default_hr_zones` derives a standard 5-zone %HRR (Karvonen) split from the
     athlete's max_hr / resting_hr when Garmin yields nothing — so a definition always exists. This is an
     APPROXIMATION; the true watch match comes from Garmin.

Both return the SAME normalized blob stored in athlete_profile.hr_zones (migration …_hr_zones):
    { "source": "garmin"|"computed", "model": "garmin"|"%HRR"|"%maxHR", "updated_at": "YYYY-MM-DD",
      "zones": [ {"n":1,"name":"Z1","low_bpm":95,"high_bpm":114}, … 5 zones ] }

Zones are GUIDANCE/coach-context, never a load input — the load model keeps using max_hr/lthr scalars
(load.py). Pure + I/O-free (the I/O lives in garmin.py / db.py) so it's unit-tested with fixtures.
"""

from __future__ import annotations

from datetime import date

# Standard 5-zone %HRR (Karvonen) lower bounds — Z1 starts at 50 % of heart-rate reserve, Z5 tops at FCmax.
# A widely-used scheme and one of Garmin's selectable methods; the fallback only fires when the watch's
# own zones can't be read, so an exact match isn't promised — it's a sane default.
_HRR_FLOORS = [0.50, 0.60, 0.70, 0.80, 0.90]  # Z1..Z5 lower fractions of (max_hr - resting_hr)
_ZONE_NAMES = ["Z1", "Z2", "Z3", "Z4", "Z5"]


def _zone_list(floors_bpm: list[float], top_bpm: float) -> list[dict]:
    """Build the 5 zone dicts from 5 ascending lower-bound bpm + the top (FCmax). Each zone spans
    [its floor, the next floor) and Z5 spans [Z5 floor, top]."""
    bounds = [round(f) for f in floors_bpm] + [round(top_bpm)]
    return [
        {"n": i + 1, "name": _ZONE_NAMES[i], "low_bpm": bounds[i], "high_bpm": bounds[i + 1]}
        for i in range(5)
    ]


def compute_default_hr_zones(profile: dict, today: str | None = None) -> dict | None:
    """Derive 5 HR zones from the athlete's thresholds when the watch's zones aren't available.

    Prefers %HRR (Karvonen, needs max_hr + resting_hr); falls back to %max_hr when resting_hr is unset.
    Returns None when max_hr is missing (nothing to anchor on) — caller then leaves hr_zones unset.
    """
    max_hr = profile.get("max_hr")
    rhr = profile.get("resting_hr")
    if not isinstance(max_hr, (int, float)) or max_hr <= 0:
        return None
    stamp = today or date.today().isoformat()
    if isinstance(rhr, (int, float)) and 0 < rhr < max_hr:
        hrr = max_hr - rhr
        floors = [rhr + f * hrr for f in _HRR_FLOORS]
        return {"source": "computed", "model": "%HRR", "updated_at": stamp,
                "zones": _zone_list(floors, max_hr)}
    # No usable resting HR → % of max HR (same 50/60/70/80/90 boundaries).
    floors = [f * max_hr for f in _HRR_FLOORS]
    return {"source": "computed", "model": "%maxHR", "updated_at": stamp,
            "zones": _zone_list(floors, max_hr)}


def _floors_from_config(cfg: dict) -> tuple[list[float], float] | None:
    """Pull (5 ascending zone-floor bpm, FCmax bpm) from one Garmin zone-config dict, or None.

    Garmin's heart-rate-zones payload gives each zone a FLOOR (zone1Floor..zone5Floor) plus the max HR it
    was computed against (maxHeartRateUsed). Zone i runs [zoneIFloor, zone(i+1)Floor); Z5 runs to FCmax.
    Defensive: any missing/implausible floor → None (caller falls back to the computed zones)."""
    floors: list[float] = []
    for i in range(1, 6):
        v = cfg.get(f"zone{i}Floor")
        if not isinstance(v, (int, float)) or v <= 0:
            return None
        floors.append(float(v))
    if floors != sorted(floors):  # must be strictly ascending to form valid bands
        return None
    top = cfg.get("maxHeartRateUsed") or cfg.get("maxHeartRate")
    if not isinstance(top, (int, float)) or top <= floors[-1]:
        return None
    return floors, float(top)


def normalize_garmin_zones(raw, today: str | None = None) -> dict | None:
    """Parse Garmin's heart-rate-zones payload into the stored hr_zones blob, or None if unreadable.

    The payload is a list of per-sport configs (RUNNING / CYCLING / DEFAULT…) or a single config dict.
    We prefer the RUNNING config (this athlete's concern is running zones), else DEFAULT, else the first
    readable one. Undocumented + device-variable, so it digs defensively like garmin._normalize."""
    configs: list[dict]
    if isinstance(raw, list):
        configs = [c for c in raw if isinstance(c, dict)]
    elif isinstance(raw, dict):
        configs = [raw]
    else:
        return None
    if not configs:
        return None

    def sport_of(c: dict) -> str:
        return str(c.get("sport") or c.get("sportType") or "").upper()

    ordered = (
        [c for c in configs if sport_of(c) == "RUNNING"]
        + [c for c in configs if sport_of(c) in ("DEFAULT", "")]
        + configs
    )
    for cfg in ordered:
        parsed = _floors_from_config(cfg)
        if parsed:
            floors, top = parsed
            return {"source": "garmin", "model": "garmin",
                    "updated_at": today or date.today().isoformat(),
                    "zones": _zone_list(floors, top)}
    return None
