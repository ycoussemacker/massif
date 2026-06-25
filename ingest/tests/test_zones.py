"""HR-zone derivation: parse Garmin's zone payload (preferred) + compute a %HRR fallback. Pure, no I/O."""

from massif_ingest import zones

# Garmin heart-rate-zones payload: per-sport configs with zone "floors" + the max HR used.
GARMIN_RAW = [
    {"sport": "DEFAULT", "zone1Floor": 92, "zone2Floor": 110, "zone3Floor": 129,
     "zone4Floor": 148, "zone5Floor": 167, "maxHeartRateUsed": 186},
    {"sport": "RUNNING", "zone1Floor": 98, "zone2Floor": 118, "zone3Floor": 138,
     "zone4Floor": 158, "zone5Floor": 173, "maxHeartRateUsed": 188},
]


def test_normalize_garmin_prefers_running():
    z = zones.normalize_garmin_zones(GARMIN_RAW, today="2026-06-25")
    assert z["source"] == "garmin" and z["model"] == "garmin"
    assert z["updated_at"] == "2026-06-25"
    assert [zz["name"] for zz in z["zones"]] == ["Z1", "Z2", "Z3", "Z4", "Z5"]
    # RUNNING config wins over DEFAULT.
    z2 = next(zz for zz in z["zones"] if zz["name"] == "Z2")
    assert z2["low_bpm"] == 118 and z2["high_bpm"] == 138   # [zone2Floor, zone3Floor)
    z5 = z["zones"][-1]
    assert z5["low_bpm"] == 173 and z5["high_bpm"] == 188   # Z5 runs to FCmax


def test_normalize_garmin_single_dict_and_fallback_sport():
    one = {"sport": "CYCLING", "zone1Floor": 90, "zone2Floor": 108, "zone3Floor": 126,
           "zone4Floor": 144, "zone5Floor": 162, "maxHeartRateUsed": 180}
    z = zones.normalize_garmin_zones(one)
    assert z["source"] == "garmin"
    assert z["zones"][0]["low_bpm"] == 90 and z["zones"][0]["high_bpm"] == 108


def test_normalize_garmin_defensive():
    # Unreadable / missing-floor / non-ascending / no-top → None (caller computes the fallback), never raises.
    assert zones.normalize_garmin_zones(None) is None
    assert zones.normalize_garmin_zones([]) is None
    assert zones.normalize_garmin_zones("nope") is None
    assert zones.normalize_garmin_zones([{"sport": "RUNNING"}]) is None  # no floors
    assert zones.normalize_garmin_zones([{"zone1Floor": 150, "zone2Floor": 100, "zone3Floor": 120,
                                          "zone4Floor": 140, "zone5Floor": 160, "maxHeartRateUsed": 180}]) is None
    assert zones.normalize_garmin_zones([{"zone1Floor": 90, "zone2Floor": 108, "zone3Floor": 126,
                                          "zone4Floor": 144, "zone5Floor": 162}]) is None  # no max


def test_compute_default_hrr_karvonen():
    z = zones.compute_default_hr_zones({"max_hr": 188, "resting_hr": 48}, today="2026-06-25")
    assert z["source"] == "computed" and z["model"] == "%HRR"
    hrr = 188 - 48
    # Z2 spans 60–70 % HRR above resting.
    z2 = next(zz for zz in z["zones"] if zz["name"] == "Z2")
    assert z2["low_bpm"] == round(48 + 0.60 * hrr)   # 132
    assert z2["high_bpm"] == round(48 + 0.70 * hrr)  # 146
    assert z["zones"][-1]["high_bpm"] == 188          # Z5 tops at FCmax
    assert z["zones"][0]["low_bpm"] == round(48 + 0.50 * hrr)  # 118


def test_compute_default_max_hr_when_no_resting():
    z = zones.compute_default_hr_zones({"max_hr": 200})
    assert z["model"] == "%maxHR"
    z2 = next(zz for zz in z["zones"] if zz["name"] == "Z2")
    assert z2["low_bpm"] == 120 and z2["high_bpm"] == 140  # 60–70 % of max


def test_compute_default_needs_max_hr():
    assert zones.compute_default_hr_zones({}) is None
    assert zones.compute_default_hr_zones({"resting_hr": 50}) is None
    # Implausible resting (>= max) → falls back to %maxHR rather than producing garbage.
    z = zones.compute_default_hr_zones({"max_hr": 180, "resting_hr": 200})
    assert z["model"] == "%maxHR"
