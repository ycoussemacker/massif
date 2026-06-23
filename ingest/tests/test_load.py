"""Load model: the two channels must always partition the total, and the ladder must pick the
first method whose inputs exist."""

from massif_ingest import load


def test_partition_invariant_and_duration_fallback():
    sport = {"taxonomy_group": "paced_endurance",
             "load_method_ladder": ["hrtss", "session_rpe", "duration_fallback"]}
    # No HR, no profile, no RPE -> ladder falls through to duration_fallback.
    r = load.compute_load({"duration_s": 3600}, sport, {})
    assert r.load_method_used == "duration_fallback"
    assert r.aerobic_load + r.neuromuscular_load == r.training_load   # the invariant
    assert r.aerobic_load > r.neuromuscular_load                      # 0.85 / 0.15 split


def test_hrtss_used_when_profile_present():
    sport = {"taxonomy_group": "paced_endurance",
             "load_method_ladder": ["hrtss", "duration_fallback"]}
    profile = {"resting_hr": 50, "max_hr": 190, "lthr": 165}
    r = load.compute_load({"duration_s": 3600, "avg_hr": 150}, sport, profile)
    assert r.load_method_used == "hrtss"
    assert r.training_load > 0


def test_climbing_is_mostly_neuromuscular():
    sport = {"taxonomy_group": "technical_strength",
             "load_method_ladder": ["grade_volume", "session_rpe", "duration_fallback"]}
    # grade_volume returns None (no climbing_sets yet) -> session_rpe.
    r = load.compute_load({"duration_s": 5400, "perceived_rpe": 7}, sport, {})
    assert r.load_method_used == "session_rpe"
    assert r.neuromuscular_load > r.aerobic_load                      # 0.15 / 0.85 split
    assert r.aerobic_load + r.neuromuscular_load == r.training_load


# ── the arithmetic-dense methods used by the priority mountain/endurance sports ──

VERTICAL = {"taxonomy_group": "mountain_vertical",
            "load_method_ladder": ["vertical_duration", "hrtss", "session_rpe", "duration_fallback"]}


def test_vertical_duration_is_no_hr_aerobic_estimate():
    # No HR: 2h @ DEFAULT_IF 0.55 = 60.5 base + 1000 m ascent = (1000/1000)*100*1.0 = 100 => aerobic 160.5.
    # Neuromuscular = impact only (no D-): 160.5 * 0.20 (mountain_vertical) = 32.1.
    r = load.compute_load({"duration_s": 7200, "vertical_gain_m": 1000}, VERTICAL, {})
    assert r.load_method_used == "vertical_duration"
    assert round(r.aerobic_load, 1) == 160.5
    assert round(r.neuromuscular_load, 1) == round(160.5 * 0.20, 1)
    assert r.aerobic_load + r.neuromuscular_load == r.training_load


def test_mountain_with_hr_prefers_hrtss_over_vertical_duration():
    # vertical_duration defers to hrtss when HR is usable, so the climb isn't double-counted.
    profile = {"resting_hr": 48, "max_hr": 188, "lthr": 178}
    r = load.compute_load({"duration_s": 7200, "vertical_gain_m": 1000, "avg_hr": 130}, VERTICAL, profile)
    assert r.load_method_used == "hrtss"


def test_hr_never_lowers_load_on_hrtss_less_ladder():
    # alpinism / via_ferrata ladders have NO hrtss, so vertical_duration must NOT defer to it — a
    # valid HR reading must never drop the activity to duration_fallback and LOSE the ascent supplement.
    profile = {"resting_hr": 48, "max_hr": 188, "lthr": 178, "weight_kg": 64}
    alpine = {"taxonomy_group": "mountain_vertical",
              "load_method_ladder": ["vertical_duration", "session_rpe", "duration_fallback"]}
    act = {"duration_s": 21600, "vertical_gain_m": 1500, "vertical_loss_m": 1500}
    no_hr = load.compute_load(act, alpine, profile)
    with_hr = load.compute_load({**act, "avg_hr": 130}, alpine, profile)
    assert no_hr.load_method_used == with_hr.load_method_used == "vertical_duration"
    assert with_hr.training_load >= no_hr.training_load   # HR present adds info, never removes it


def test_vertical_duration_pack_weight_increases_load():
    light = load.compute_load({"duration_s": 7200, "vertical_gain_m": 1000}, VERTICAL, {"weight_kg": 70})
    packed = load.compute_load(
        {"duration_s": 7200, "vertical_gain_m": 1000, "carried_load_kg": 14}, VERTICAL, {"weight_kg": 70})
    assert packed.training_load > light.training_load                # mass_factor 1.2 lifts the climb


def test_descent_adds_neuromuscular_load_independently_of_hr():
    # THE FIX: two identical-HR runs; the one with a big descent costs more — purely on the
    # neuromuscular channel — even though the aerobic (HR) cost is unchanged. Old model: invisible.
    profile = {"resting_hr": 48, "max_hr": 188, "lthr": 178, "weight_kg": 64}
    sport = {"taxonomy_group": "paced_endurance",
             "load_method_ladder": ["hrtss", "session_rpe", "duration_fallback"]}
    flat = load.compute_load({"duration_s": 9000, "avg_hr": 135}, sport, profile)
    steep = load.compute_load({"duration_s": 9000, "avg_hr": 135, "vertical_loss_m": 2000}, sport, profile)
    assert flat.load_method_used == steep.load_method_used == "hrtss"
    assert steep.aerobic_load == flat.aerobic_load                   # same HR → same aerobic cost
    assert steep.neuromuscular_load > flat.neuromuscular_load        # descent loads the neuro channel
    assert steep.training_load > flat.training_load


def test_descent_scaled_by_pack_mass():
    profile = {"resting_hr": 48, "max_hr": 188, "lthr": 178, "weight_kg": 64}
    sport = {"taxonomy_group": "mountain_vertical",
             "load_method_ladder": ["hrtss", "session_rpe", "duration_fallback"]}
    light = load.compute_load({"duration_s": 9000, "avg_hr": 130, "vertical_loss_m": 2000}, sport, profile)
    packed = load.compute_load(
        {"duration_s": 9000, "avg_hr": 130, "vertical_loss_m": 2000, "carried_load_kg": 16}, sport, profile)
    assert packed.neuromuscular_load > light.neuromuscular_load


def test_trail_vs_hike_ordering_regression():
    # The reported bug: a 30 km / 3000 m-D- trail must NOT score below a smaller 2000 m-D+ hike.
    # Both have HR (→ hrtss), so the difference now lives in the neuromuscular (descent) channel.
    profile = {"resting_hr": 48, "max_hr": 188, "lthr": 178, "weight_kg": 64}
    trail_sport = {"taxonomy_group": "paced_endurance",
                   "load_method_ladder": ["hrtss", "session_rpe", "duration_fallback"]}
    hike_sport = {"taxonomy_group": "mountain_vertical",
                  "load_method_ladder": ["vertical_duration", "hrtss", "session_rpe", "duration_fallback"]}
    trail = load.compute_load(
        {"duration_s": 30600, "avg_hr": 135, "vertical_gain_m": 3005, "vertical_loss_m": 3039},
        trail_sport, profile)
    hike = load.compute_load(
        {"duration_s": 25020, "avg_hr": 128, "vertical_gain_m": 2020, "vertical_loss_m": 1489},
        hike_sport, profile)
    assert trail.load_method_used == hike.load_method_used == "hrtss"  # HR present for both
    assert trail.training_load > hike.training_load                   # was inverted under the old model
    assert trail.neuromuscular_load > hike.neuromuscular_load         # 3039 m vs 1489 m of descent


def test_tss_aerobic_anchor_plus_impact():
    sport = {"taxonomy_group": "paced_endurance", "load_method_ladder": ["tss", "duration_fallback"]}
    r = load.compute_load({"duration_s": 3600, "np_power_w": 250, "avg_power_w": 100},
                          sport, {"ftp_watts": 250})
    assert r.load_method_used == "tss"
    assert round(r.aerobic_load, 1) == 100.0                         # 1h at threshold (IF=1.0): the anchor
    assert round(r.neuromuscular_load, 1) == round(100.0 * 0.15, 1)  # paced_endurance impact, no descent


def test_rtss_intensity_from_pace():
    sport = {"taxonomy_group": "paced_endurance", "load_method_ladder": ["rtss", "duration_fallback"]}
    r = load.compute_load({"duration_s": 3600, "avg_pace_s_per_km": 300},
                          sport, {"threshold_pace_s_per_km": 300})
    assert r.load_method_used == "rtss"
    assert round(r.aerobic_load, 1) == 100.0                         # running at threshold pace


# ── multi-day expedition handling (data hygiene) ──────────────────────────────────────────────────

def test_span_days_flags_genuine_multiday_expedition():
    # 13 days elapsed, ~56 h moving (huge overnight gaps) → spans 14 calendar dates, flagged.
    span = load.activity_span_days("2025-08-01T06:00:00+00:00", 13 * 86400, 200000)
    assert span == 14


def test_span_days_ignores_midnight_crossing_session():
    # A 4 h night activity that crosses midnight is NOT multi-day: elapsed≈moving (tiny gap).
    span = load.activity_span_days("2025-11-30T23:00:00+00:00", 4 * 3600, int(3.9 * 3600))
    assert span == 1


def test_span_days_ignores_continuous_ultra_across_days():
    # A 25 h continuous effort spanning 2 calendar days but barely stopped (gap < overnight) stays 1 day.
    span = load.activity_span_days("2025-06-01T06:00:00+00:00", 25 * 3600, int(24.5 * 3600))
    assert span == 1


def test_span_days_degrades_on_missing_inputs():
    assert load.activity_span_days(None, 3600, 3600) == 1
    assert load.activity_span_days("2025-06-01T08:00:00+00:00", None, None) == 1
    assert load.activity_span_days("not-a-date", 13 * 86400, 1000) == 1


VERT_LADDER = {"taxonomy_group": "mountain_vertical",
               "load_method_ladder": ["vertical_duration", "hrtss", "session_rpe", "duration_fallback"]}
HR_PROFILE = {"resting_hr": 48, "max_hr": 188, "lthr": 178}


def test_multiday_load_uses_moving_time_not_elapsed():
    # The GR20 bug: a multi-day activity must be scored on MOVING time (elapsed counts the nights).
    multi = {"started_at": "2025-08-01T06:00:00+00:00", "duration_s": 13 * 86400,
             "moving_s": 200000, "avg_hr": 130}
    r = load.compute_load(multi, VERT_LADDER, HR_PROFILE)
    assert r.effective_days == 14
    # Same activity treated as single-day (no started_at → span 1) scores on elapsed (312 h ≫ 55.6 h moving).
    single = load.compute_load({"duration_s": 13 * 86400, "moving_s": 200000, "avg_hr": 130},
                               VERT_LADDER, HR_PROFILE)
    assert single.effective_days == 1
    assert single.aerobic_load > r.aerobic_load * 4   # elapsed 312 h vs moving 55.6 h


def test_needs_review_flags_suspect_inputs_only():
    prof = {"max_hr": 188}
    # HR sensor glitch: avg_hr above the athlete's max.
    assert load.needs_review({"avg_hr": 199}, prof, 0.7, 1) is True
    # Implausible intensity factor.
    assert load.needs_review({}, prof, 1.6, 1) is True
    # Single-day outing mostly spent stopped (4 h elapsed, 1 h moving) → load overstated.
    assert load.needs_review({"duration_s": 14400, "moving_s": 3600}, prof, 0.5, 1) is True
    # Clean single-day activity (moving ≈ elapsed, plausible IF, HR ok) → not flagged.
    assert load.needs_review({"duration_s": 14400, "moving_s": 14000, "avg_hr": 150}, prof, 0.7, 1) is False
    # A multi-day expedition is already handled by the spread (effective_days>1), not flagged here.
    assert load.needs_review({"duration_s": 14400, "moving_s": 3600}, prof, 0.5, 14) is False


def test_normal_activity_unchanged_uses_elapsed_and_effective_days_one():
    # A normal single-day activity is byte-for-byte unchanged: effective_days=1 and load on elapsed.
    normal = {"started_at": "2025-06-01T08:00:00+00:00", "duration_s": 3600, "moving_s": 3500, "avg_hr": 130}
    r = load.compute_load(normal, VERT_LADDER, HR_PROFILE)
    assert r.effective_days == 1
    legacy = load.compute_load({"duration_s": 3600, "avg_hr": 130}, VERT_LADDER, HR_PROFILE)
    assert r.aerobic_load == legacy.aerobic_load      # single-day ignores moving_s, scores on elapsed
