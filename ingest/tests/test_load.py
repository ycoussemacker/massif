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


def test_params_personalize_coefficients_with_fallback():
    # No params → population defaults (unchanged behaviour).
    sport = {"taxonomy_group": "paced_endurance",
             "load_method_ladder": ["hrtss", "session_rpe", "duration_fallback"]}
    base = load.compute_load({"duration_s": 3600}, sport, {})            # duration_fallback @ DEFAULT_IF
    tuned = load.compute_load({"duration_s": 3600}, sport, {}, {"default_if": 0.7})
    assert tuned.aerobic_load > base.aerobic_load                        # personalized higher IF → more load
    # A personalized descent coefficient scales only the neuromuscular channel.
    mtn = {"taxonomy_group": "mountain_vertical",
           "load_method_ladder": ["hrtss", "session_rpe", "duration_fallback"]}
    prof = {"resting_hr": 48, "max_hr": 188, "lthr": 178, "weight_kg": 64}
    act = {"duration_s": 9000, "avg_hr": 130, "vertical_loss_m": 2000}
    d1 = load.compute_load(act, mtn, prof)
    d2 = load.compute_load(act, mtn, prof, {"descent_load_per_1000m": 140})
    assert d2.neuromuscular_load > d1.neuromuscular_load                 # doubled descent coeff → more neuro
    assert d2.aerobic_load == d1.aerobic_load                           # aerobic channel untouched


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


# ── mostly-stopped single-day correction (alpinism / grande voie logged as a hike) ────────────────

# 8 h elapsed, only 3 h moving (belays / approach / pauses): a single calendar day (no overnight gap).
STOPPED = {"started_at": "2026-05-22T06:00:00+00:00", "duration_s": 8 * 3600, "moving_s": 3 * 3600}
ALPINE = {"taxonomy_group": "mountain_vertical",
          "load_method_ladder": ["vertical_duration", "session_rpe", "duration_fallback"]}


def test_mostly_stopped_singleday_scores_duration_methods_on_moving_time():
    # The fix: the no-HR aerobic estimate scores on MOVING time (3 h), not elapsed (8 h), so the belay
    # hours don't inflate the load. base = 3 h @ IF 0.55 = 90.75 ; + 800 m ascent = 80 → aerobic 170.75.
    r = load.compute_load({**STOPPED, "vertical_gain_m": 800}, ALPINE, {})
    assert r.load_method_used == "vertical_duration"
    assert r.needs_review is True
    assert round(r.aerobic_load, 2) == round(3 * 0.55 ** 2 * 100 + 80, 2)


def test_mostly_stopped_hrtss_still_uses_elapsed_no_double_correct():
    # HR/power/pace methods KEEP elapsed: the average HR already reflects the stops, so shortening the
    # duration too would double-correct. The stopped activity scores like the same one with moving==elapsed.
    prof = {"resting_hr": 48, "max_hr": 188, "lthr": 178}
    sport = {"taxonomy_group": "paced_endurance", "load_method_ladder": ["hrtss", "duration_fallback"]}
    r = load.compute_load({**STOPPED, "avg_hr": 140}, sport, prof)
    full = load.compute_load({**STOPPED, "moving_s": 8 * 3600, "avg_hr": 140}, sport, prof)
    assert r.load_method_used == "hrtss"
    assert round(r.aerobic_load, 2) == round(full.aerobic_load, 2)   # scored on elapsed, not moving


def test_user_rpe_clears_the_mostly_stopped_flag():
    prof = {"max_hr": 188}
    a = {"duration_s": 8 * 3600, "moving_s": 3 * 3600}
    assert load.needs_review(a, prof, 0.5, 1) is True                       # flagged by default
    assert load.needs_review({**a, "rpe_source": "user"}, prof, 0.5, 1) is False   # a user RPE clears it
    assert load.needs_review({**a, "rpe_source": "estimated"}, prof, 0.5, 1) is True  # only a USER RPE does


# ── Grande voie (multi-pitch): the dedicated `mountain_technical` group ────────────────────────────

def test_grande_voie_is_additive_with_higher_impact_not_structural():
    # mountain_technical is an AEROBIC-ENGINE group (additive), unlike technical_strength (15/85 split):
    # aerobic stays the full points, and the eccentric descent is still added on the neuromuscular channel.
    gv = {"taxonomy_group": "mountain_technical",
          "load_method_ladder": ["vertical_duration", "session_rpe", "duration_fallback"]}
    # Not mostly stopped (no moving_s) → scored on elapsed 2 h: base 60.5 + 1000 m ascent 100 → aerobic 160.5.
    r = load.compute_load({"duration_s": 7200, "vertical_gain_m": 1000, "vertical_loss_m": 1000}, gv, {"weight_kg": 64})
    assert r.load_method_used == "vertical_duration"
    assert round(r.aerobic_load, 1) == 160.5
    # neuro = impact 0.40 × aerobic + descent (1000/1000 × 55 × 1.0; trained base, no familiarity stamped)
    #       = 64.2 + 55 = 119.2.
    assert round(r.neuromuscular_load, 1) == round(160.5 * 0.40 + load.DESCENT_LOAD_PER_1000M, 1)
    assert r.aerobic_load + r.neuromuscular_load == r.training_load


# ── heat & altitude (docs/research/heat-altitude.md) ──────────────────────────────────────────────

def test_altitude_power_factor_gates_and_is_bounded():
    assert load.altitude_power_factor(None) == 1.0
    assert load.altitude_power_factor(500) == 1.0          # below the 800 m floor → no correction
    assert load.altitude_power_factor(800) == 1.0
    f2000 = load.altitude_power_factor(2000)
    assert f2000 > 1.0                                     # thin air costs more for the same power/pace
    assert 1.0 < load.altitude_power_factor(2000, acclimatized=True) < f2000  # acclimation shrinks it
    cap = 1.0 / (1.0 - load.ALT_CORRECTION_CAP)
    assert load.altitude_power_factor(9000) <= cap + 1e-9  # capped — extreme altitude doesn't blow up


def test_altitude_raises_power_and_pace_load_but_never_hr():
    # tss (power) and rtss (pace) are environment-blind → altitude lifts their load. hrtss is NEVER
    # corrected: an elevated HR already reflects the hypoxic strain, so correcting it would double-count.
    tss = {"taxonomy_group": "paced_endurance", "load_method_ladder": ["tss", "duration_fallback"]}
    base = {"duration_s": 3600, "np_power_w": 200, "avg_power_w": 200}
    low = load.compute_load(base, tss, {"ftp_watts": 250})
    high = load.compute_load({**base, "avg_altitude_m": 2500}, tss, {"ftp_watts": 250})
    assert high.load_method_used == "tss" and high.aerobic_load > low.aerobic_load

    rtss = {"taxonomy_group": "paced_endurance", "load_method_ladder": ["rtss", "duration_fallback"]}
    rbase = {"duration_s": 3600, "avg_pace_s_per_km": 330}
    rlow = load.compute_load(rbase, rtss, {"threshold_pace_s_per_km": 300})
    rhigh = load.compute_load({**rbase, "avg_altitude_m": 2500}, rtss, {"threshold_pace_s_per_km": 300})
    assert rhigh.aerobic_load > rlow.aerobic_load

    hr = {"taxonomy_group": "paced_endurance", "load_method_ladder": ["hrtss", "duration_fallback"]}
    prof = {"resting_hr": 48, "max_hr": 188, "lthr": 178}
    hlow = load.compute_load({"duration_s": 3600, "avg_hr": 150}, hr, prof)
    hhigh = load.compute_load({"duration_s": 3600, "avg_hr": 150, "avg_altitude_m": 2500}, hr, prof)
    assert hhigh.aerobic_load == hlow.aerobic_load        # HR load identical at altitude (no double-count)


def test_resolve_profile_effective_dating():
    base = {"max_hr": 188, "lthr": 178, "resting_hr": 48, "weight_kg": 64}
    # No history / no date → the base profile unchanged (same object) — identical behaviour until rows exist.
    assert load.resolve_profile(base, [], "2026-06-01") is base
    assert load.resolve_profile(base, None, "2026-06-01") is base
    hist = [
        {"effective_date": "2024-01-01", "lthr": 170, "weight_kg": 66},
        {"effective_date": "2026-01-01", "lthr": 178, "weight_kg": None},  # null field is NOT overlaid
    ]
    assert load.resolve_profile(base, hist, "2023-06-01") is base          # predates all rows → base
    p24 = load.resolve_profile(base, hist, "2024-06-01")
    assert p24["lthr"] == 170 and p24["weight_kg"] == 66 and p24["max_hr"] == 188
    p26 = load.resolve_profile(base, hist, "2026-06-01")
    assert p26["lthr"] == 178 and p26["weight_kg"] == 64                    # null weight → base 64
    assert base["lthr"] == 178                                             # base dict not mutated

# ── descent trainability (repeated-bout effect) — docs/research/descent-neuromuscular-rpe.md, part A ──

def test_descent_factor_is_bounded_and_saturating():
    # Typical exposure (ratio 1.0) or unknown → neutral 1.0 (inert default).
    assert load.descent_factor(1.0) == 1.0
    assert load.descent_factor(None) == 1.0
    assert load.descent_factor(0) == 1.0
    # Bounds: factor stays within [1-SWING, 1+SWING] even at extreme ratios.
    lo, hi = 1 - load.DESCENT_FAMILIARITY_SWING, 1 + load.DESCENT_FAMILIARITY_SWING
    assert load.descent_factor(1e6) > lo and load.descent_factor(1e6) < 1.0   # very exposed → < 1, never below lo
    assert load.descent_factor(1e-6) < hi and load.descent_factor(1e-6) > 1.0  # de-adapted → > 1, never above hi
    for r in (0.01, 0.5, 1.0, 3.0, 50.0):
        assert lo <= load.descent_factor(r) <= hi
    # Monotonic: more recent exposure → smaller factor (less damage).
    assert load.descent_factor(0.5) > load.descent_factor(1.0) > load.descent_factor(2.0)


def test_descent_familiarity_ratios_anchor_and_direction():
    # Empty / no descent history → {} (callers fall back to factor 1.0).
    assert load.descent_familiarity_ratios({}) == {}
    assert load.descent_familiarity_ratios({"2026-01-01": 0.0}) == {}
    # Below the min-sample gate (too little descent history) → {} (factor stays inert, no false precision).
    few = {f"2026-03-{d:02d}": 1000.0 for d in range(1, load.DESCENT_FAMILIARITY_MIN_SAMPLES)}
    assert load.descent_familiarity_ratios(few) == {}
    # A steady block then a post-layoff descent: the layoff date sees less trailing D- → lower ratio than a
    # date inside the heavy block. Enough active dates to clear the gate.
    daily = {f"2026-03-{d:02d}": 1000.0 for d in range(1, 21)}        # 20 consecutive 1000 m-D- days
    daily["2026-05-15"] = 1000.0                                       # a descent after a ~3-week layoff
    ratios = load.descent_familiarity_ratios(daily)
    assert ratios["2026-05-15"] < ratios["2026-03-20"]                 # post-layoff is less familiar
    assert load.descent_factor(ratios["2026-05-15"]) > load.descent_factor(ratios["2026-03-20"])  # → more cost


def test_descent_familiarity_modulates_only_the_neuro_channel():
    profile = {"resting_hr": 48, "max_hr": 188, "lthr": 178, "weight_kg": 64}
    sport = {"taxonomy_group": "mountain_vertical",
             "load_method_ladder": ["hrtss", "session_rpe", "duration_fallback"]}
    act = {"duration_s": 9000, "avg_hr": 130, "vertical_loss_m": 2000}
    base = load.compute_load(act, sport, profile)                     # no familiarity stamped → factor 1.0
    adapted = load.compute_load({**act, "descent_familiarity": 3.0}, sport, profile)  # well-exposed → < 1
    naive = load.compute_load({**act, "descent_familiarity": 0.2}, sport, profile)    # de-adapted → > 1
    assert adapted.neuromuscular_load < base.neuromuscular_load < naive.neuromuscular_load
    assert adapted.aerobic_load == base.aerobic_load == naive.aerobic_load            # aerobic untouched

# ── descent recovery τ (Phase 2: repeated-bout speeds recovery) ───────────────────────────────────

def test_descent_recovery_factor_direction_and_bounds():
    assert load.descent_recovery_factor(1.0) == 1.0          # typical exposure → base τ
    assert load.descent_recovery_factor(None) == 1.0          # missing → inert
    assert load.descent_recovery_factor(3.0) < 1.0 < load.descent_recovery_factor(0.3)  # adapted shorter, de-adapted longer
    lo, hi = 1 - load.DESCENT_RECOVERY_SWING, 1 + load.DESCENT_RECOVERY_SWING
    for r in (0.01, 0.5, 1.0, 2.0, 100.0):
        assert lo <= load.descent_recovery_factor(r) <= hi


def test_ewma_variable_tau_matches_fixed_when_constant():
    from massif_ingest.sync import _ewma_series
    vals = [10.0, 0.0, 30.0, 5.0, 0.0, 20.0, 0.0]
    fixed = _ewma_series(vals, 14)
    var = load.ewma_variable_tau(vals, [14.0] * len(vals))
    assert all(abs(a - b) < 1e-9 for a, b in zip(fixed, var))   # constant τ ⇒ identical to the fixed EWMA


def test_ewma_variable_tau_shorter_tau_recovers_faster():
    # Sustain load until both ATLs converge to the same level (EWMA of a constant is τ-independent), THEN
    # stop: from the SAME fatigue, a SHORTER τ (adapted) clears faster → less residual fatigue.
    vals = [50.0] * 120 + [0.0] * 20
    fast = load.ewma_variable_tau(vals, [10.0] * len(vals))     # adapted → quick clearance
    slow = load.ewma_variable_tau(vals, [16.0] * len(vals))     # de-adapted → lingers
    assert abs(fast[119] - slow[119]) < 0.3                     # both converged to ~50 before the stop
    assert fast[-1] < slow[-1]                                  # then the shorter τ has recovered more

# ── RPE Phase 2: user-RPE wins the ladder + differential channel split ─────────────────────────────

ALPI = {"taxonomy_group": "mountain_vertical",
        "load_method_ladder": ["vertical_duration", "session_rpe", "duration_fallback"]}
CLIMB = {"taxonomy_group": "technical_strength",
         "load_method_ladder": ["grade_volume", "session_rpe", "duration_fallback"]}
PROF = {"resting_hr": 48, "max_hr": 188, "lthr": 178, "weight_kg": 64}


def test_user_rpe_supersedes_vertical_duration_in_ladder():
    # The bug fix: a USER rpe must win over the objective vertical_duration (else the athlete's effort
    # report is ignored — a grande_voie rated 10 could score ~38). Auto-estimated RPE does NOT win.
    act = {"duration_s": 21600, "vertical_gain_m": 1500, "vertical_loss_m": 1500, "perceived_rpe": 8}
    user = load.compute_load({**act, "rpe_source": "user"}, ALPI, PROF)
    auto = load.compute_load({**act, "rpe_source": "estimated"}, ALPI, PROF)
    assert user.load_method_used == "session_rpe"
    assert auto.load_method_used == "vertical_duration"   # unchanged when not user-entered


def test_differential_split_helper_gate_and_quadrature():
    assert load._differential_split({}) is None
    assert load._differential_split({"rpe_cardio": 5}) is None              # need >= 2 present
    assert load._differential_split({"rpe_cardio": 0, "rpe_legs": 8}) is None  # 0 is not "present"
    assert load._differential_split({"rpe_legs": 8, "rpe_grip": 9}) == 0.0  # no cardio → pure structural
    two = load._differential_split({"rpe_cardio": 5, "rpe_legs": 8, "rpe_grip": 8})  # neuro_rpe = min(10, √128)=10
    one = load._differential_split({"rpe_cardio": 5, "rpe_grip": 8})                  # neuro_rpe = 8
    assert abs(two - 25 / 125) < 1e-9                                       # 25/(25+100)
    assert one > two                                                       # a 2nd loaded system → more neuro


def test_differential_split_structural_supersedes_fixed_ratio():
    base = load.compute_load({"duration_s": 7200, "perceived_rpe": 7, "rpe_source": "user"}, CLIMB, {})
    diff = load.compute_load(
        {"duration_s": 7200, "perceived_rpe": 7, "rpe_source": "user", "rpe_cardio": 3, "rpe_grip": 9}, CLIMB, {})
    assert diff.load_method_used == "session_rpe"
    assert abs(diff.training_load - base.training_load) < 0.5               # total magnitude unchanged (= points)
    assert diff.aerobic_load < base.aerobic_load                           # perceived 0.10 aero < fixed 0.15
    assert abs(diff.aerobic_load - diff.training_load * 0.1) < 0.5         # aero_frac = 9/(9+81) = 0.1


def test_differential_aerobic_engine_keeps_descent_floor():
    # Easy cardio + hard legs + big descent: aerobic shrinks (engine was easy), but neuro must not drop
    # below the OBJECTIVE descent+impact floor (a same-session RPE under-reports delayed eccentric DOMS).
    act = {"duration_s": 14400, "vertical_gain_m": 500, "vertical_loss_m": 2500,
           "perceived_rpe": 6, "rpe_source": "user", "rpe_cardio": 3, "rpe_legs": 9}
    r = load.compute_load(act, ALPI, PROF)
    assert r.load_method_used == "session_rpe"
    points = 4.0 * (0.6 ** 2) * 100                                        # 4 h × (6/10)² × 100 = 144
    descent = 2.5 * load.DESCENT_LOAD_PER_1000M                            # 2500 m × 55, mass 1.0, no familiarity
    assert abs(r.aerobic_load - points * 0.1) < 0.5                        # aero_frac 9/(9+81)=0.1
    assert r.neuromuscular_load >= descent - 0.5                          # objective descent floor preserved


def test_differential_inert_without_subscores_regression():
    # Existing rows (no sub-scores) must be byte-identical to the pre-Phase-2 split.
    r = load.compute_load({"duration_s": 7200, "perceived_rpe": 7, "rpe_source": "user"}, CLIMB, {})
    assert abs(r.aerobic_load - r.training_load * 0.15) < 1e-9            # fixed 0.15/0.85 unchanged


def test_differential_aerobic_engine_requires_cardio_else_no_zeroing():
    # Aerobic-engine sport with legs+grip but BLANK cardio must NOT zero the aerobic engine — falls back
    # to the full magnitude (the engine is the defining cost). Structural sports (climbing) are fine with
    # cardio absent (aerobic ≈ 0), so legs+grip there DOES split.
    no_cardio = {"duration_s": 7200, "vertical_gain_m": 800, "vertical_loss_m": 600,
                 "perceived_rpe": 8, "rpe_source": "user", "rpe_legs": 8, "rpe_grip": 8}
    r = load.compute_load(no_cardio, ALPI, PROF)
    points = 2.0 * (0.8 ** 2) * 100                               # 2 h × (8/10)² × 100 = 128
    assert abs(r.aerobic_load - points) < 0.5                     # engine NOT zeroed (fallback to full points)
    # climbing (structural): legs+grip, no cardio → split applies, aerobic ≈ 0
    rc = load.compute_load({"duration_s": 7200, "perceived_rpe": 8, "rpe_source": "user",
                            "rpe_legs": 8, "rpe_grip": 8}, CLIMB, {})
    assert rc.aerobic_load == 0.0                                 # pure structural session → no aerobic
    assert abs(rc.neuromuscular_load - rc.training_load) < 1e-9
