"""Cross-sport training-load computation — the heart of Massif.

Every activity gets ONE comparable load, split into two channels that PARTITION the total — but the
channels are computed INDEPENDENTLY and summed, never one number sliced by a fixed ratio:

  - aerobic_load        : the cardiometabolic engine cost (power/HR/pace; or, with no HR, a
                          duration + ascent estimate). HRV / RHR / Body Battery see it; recovers fast.
                          Anchor: 100 points ≈ 1 h at threshold on THIS channel.
  - neuromuscular_load  : the structural / CNS cost, built from stressors the wearables are blind to —
                          the eccentric DESCENT (D-), plus a small impact fraction of the aerobic
                          effort. HRV-blind, recovers slowly (tendons: weeks), an injury vector.

The DB derives training_load = aerobic_load + neuromuscular_load (generated column), so this module
writes only the two channels.

WHY ADDITIVE (not "one method → fixed split"): a long descent loads the quads/tendons eccentrically
while the heart stays calm. Under a HR-only method that cost is invisible; under a fixed taxonomy
split it is merely a fraction of the (HR-blind) total. Computing the descent term separately and
ADDING it is what lets a 3000 m-descent trail correctly outscore a smaller hike even when both ran
at a moderate HR. Pure strength/technical sports have no aerobic engine, so for them the session
effort itself is split (mostly neuromuscular) — see STRUCTURAL_EFFORT_GROUPS.

`compute_load` walks the sport's ordered `load_method_ladder` to pick the aerobic-engine method
(first whose inputs are present), guaranteeing a non-NULL load for every activity.

NOTE: the coefficients/ratios below are population starting points. For a single athlete they
should be personalized from the user's own RPE-vs-Garmin history over the first few weeks
(see docs/ARCHITECTURE.md → "personalization"). Treat early output as provisional. Two known
calibration gaps to revisit with real data:
  - ASCENT_AEROBIC_PER_1000M (no-HR mountain estimate) credits a fixed cost per 1000 m of D+
    regardless of how easy the climb was, so a HR-less hike can read higher than the same hike via
    hrtss. Most outings have HR (→ hrtss), so this only affects HR-less mountain days.
  - For needs_manual_rpe mountain sports (alpinism / via_ferrata), the descent term is added on top
    of an RPE-derived aerobic number; the RPE may already partly reflect the descent, so its marginal
    attribution there is a calibration item, not a clean independent signal (unlike the HR/power path).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

# Sports with no real aerobic engine: the session effort (sRPE / grade / tonnage) is itself mostly
# muscular, so it is split aerobic : neuromuscular by taxonomy (must sum to 1.0) rather than treated
# as a cardiac cost. Everything else is an "aerobic-engine" sport (additive channels, see below).
STRUCTURAL_EFFORT_GROUPS = {"technical_strength", "resistance"}
CHANNEL_SPLIT: dict[str, tuple[float, float]] = {
    "technical_strength": (0.15, 0.85),  # climbing: fingers/forearms/CNS
    "resistance":         (0.10, 0.90),  # heavy strength
    "other":              (0.70, 0.30),  # conservative fallback for an unclassified effort sport
}

# Aerobic-engine sports — the HRV-blind structural cost of the locomotion itself, as a fraction of
# the aerobic load (running impact, uphill muscular work, posture). The big eccentric cost of
# descending is handled separately by DESCENT_LOAD_PER_1000M, so these stay modest.
IMPACT_FRAC: dict[str, float] = {
    "paced_endurance":   0.15,
    "mountain_vertical": 0.20,
    "aquatic":           0.10,
    "other":             0.25,
}

# Default intensity factor when nothing better is known (used by duration_fallback / sRPE base).
DEFAULT_IF = 0.55  # ~ easy aerobic effort
# Eccentric structural cost per 1000 m of DESCENT (D-), scaled by carried mass — the neuromuscular
# stressor wearables can't see. Population start; calibrate from the athlete's RPE/soreness history.
DESCENT_LOAD_PER_1000M = 70.0
# Aerobic cost per 1000 m of ASCENT (D+) credited ONLY when there is no usable HR (the no-HR mountain
# estimate). With HR present, hrtss already captures the climb, so this is not added (no double count).
ASCENT_AEROBIC_PER_1000M = 100.0

# ── Multi-day expedition handling (data hygiene) ────────────────────────────────────────────────
# Strava lets you publish a multi-day outing (a GR20, a trek) as ONE activity: elapsed_time then spans
# the whole trip (nights included) and the row lands entirely on its START date. Two distortions follow:
# the load is computed over the elapsed window (sleep counted as effort), and a trip's worth of load
# spikes a single day — wrecking the EWMAs (ATL explodes, then CTL stays falsely high for ~2 months →
# phantom +TSB). We detect such activities and (a) compute their load from MOVING time, not elapsed, and
# (b) spread it across the calendar days they truly span (done in the rollup, via `effective_days`).
# A normal session that merely crosses midnight (a night race) has elapsed≈moving → NOT flagged. The
# tell of a real expedition is a large non-moving GAP (≥ one overnight) on top of a multi-day span.
MULTIDAY_GAP_S = 6 * 3600  # min elapsed−moving gap (an overnight) to treat a multi-day span as a trip


def activity_span_days(started_at: str | None, duration_s: int | None, moving_s: int | None) -> int:
    """Calendar days a multi-day EXPEDITION truly spans (≥2); else 1 (the normal single-day case).

    A trip qualifies only if its elapsed window crosses calendar-day boundaries AND it contains a large
    non-moving gap (≥ MULTIDAY_GAP_S) — so a night race that just crosses midnight (elapsed≈moving)
    stays a 1-day activity. Returns 1 on missing/unparsable inputs (degrade to current behaviour)."""
    if not started_at or not duration_s:
        return 1
    try:
        start = datetime.fromisoformat(started_at)
    except (TypeError, ValueError):
        return 1
    end = start + timedelta(seconds=duration_s)
    span = (end.date() - start.date()).days + 1
    gap = duration_s - (moving_s or duration_s)
    return span if span > 1 and gap >= MULTIDAY_GAP_S else 1


def _active_duration(a: dict) -> int:
    """Seconds of real effort to score. For a multi-day expedition this is MOVING time (elapsed would
    count the nights); for every normal activity it stays elapsed `duration_s` (unchanged behaviour)."""
    dur = a.get("duration_s") or 0
    if activity_span_days(a.get("started_at"), dur, a.get("moving_s")) > 1:
        return a.get("moving_s") or dur
    return dur


@dataclass
class LoadResult:
    aerobic_load: float
    neuromuscular_load: float
    load_method_used: str
    intensity_factor: float | None
    effective_days: int = 1  # >1 ⇒ multi-day expedition; the rollup spreads the load across this many days

    @property
    def training_load(self) -> float:
        return self.aerobic_load + self.neuromuscular_load


def _tss_from_if(duration_s: int, intensity_factor: float) -> float:
    """TSS-style: 100 points == 1h at threshold (IF=1.0)."""
    hours = max(duration_s, 0) / 3600.0
    return hours * (intensity_factor ** 2) * 100.0


def _hr_fraction(hr: float, rhr: float, max_hr: float) -> float:
    denom = max_hr - rhr
    return (hr - rhr) / denom if denom > 0 else 0.0


def _mass_factor(activity: dict, profile: dict) -> float:
    """Carried-mass amplifier (1.0 = bodyweight only). A 14 kg pack on a 64 kg athlete → 1.22."""
    weight = profile.get("weight_kg") or 70.0
    return 1.0 + (activity.get("carried_load_kg") or 0.0) / weight


def _descent_load(activity: dict, profile: dict) -> float:
    """Eccentric/structural cost of descending (D-) — the HRV-blind neuromuscular stressor, computed
    independently of the aerobic engine and ADDED to the neuromuscular channel. Descending brakes the
    body weight eccentrically (quads/tendons) while the heart stays calm, so this must not be
    discounted just because HR — and hence the aerobic load — was low. Linear in D-, scaled by mass.
    `vertical_loss_m` may be absent (no altitude stream / non-GPS sport) → 0, degrading gracefully."""
    vloss = activity.get("vertical_loss_m") or 0.0
    return (vloss / 1000.0) * DESCENT_LOAD_PER_1000M * _mass_factor(activity, profile)


# ── per-method computations: each returns (load_points, IF) or None if inputs are missing ──

def _method_tss(a: dict, p: dict) -> tuple[float, float] | None:
    np_w, ftp = a.get("np_power_w") or a.get("avg_power_w"), p.get("ftp_watts")
    if not (np_w and ftp):
        return None
    intensity = np_w / ftp
    return _tss_from_if(_active_duration(a), intensity), intensity


def _method_hrtss(a: dict, p: dict) -> tuple[float, float] | None:
    avg_hr, rhr, max_hr, lthr = a.get("avg_hr"), p.get("resting_hr"), p.get("max_hr"), p.get("lthr")
    if not (avg_hr and rhr and max_hr and lthr):
        return None
    avg_frac = _hr_fraction(avg_hr, rhr, max_hr)
    thr_frac = _hr_fraction(lthr, rhr, max_hr)
    intensity = avg_frac / thr_frac if thr_frac > 0 else DEFAULT_IF
    return _tss_from_if(_active_duration(a), intensity), intensity


def _method_rtss(a: dict, p: dict) -> tuple[float, float] | None:
    # pace-based TSS: IF = threshold_pace / actual_pace (faster = higher IF)
    avg_pace, thr_pace = a.get("avg_pace_s_per_km"), p.get("threshold_pace_s_per_km")
    if not (avg_pace and thr_pace):
        return None
    intensity = thr_pace / avg_pace
    return _tss_from_if(_active_duration(a), intensity), intensity


def _method_vertical_duration(a: dict, p: dict) -> tuple[float, float] | None:
    # No-HR mountain AEROBIC estimate: duration base + the climb's aerobic cost (ascent × mass). When
    # HR is usable, hrtss is more faithful (it already reflects the climb), so compute_load skips this
    # method in favour of hrtss — but ONLY when the ladder actually offers hrtss, so ladders without an
    # hrtss step (alpinism / via_ferrata) still get this ascent supplement instead of stranding on
    # duration_fallback. The eccentric DESCENT cost is added separately in compute_load, regardless of
    # which aerobic method wins.
    if not a.get("duration_s"):
        return None
    vgain = a.get("vertical_gain_m") or 0.0
    base = _tss_from_if(_active_duration(a), DEFAULT_IF)
    ascent_points = (vgain / 1000.0) * ASCENT_AEROBIC_PER_1000M * _mass_factor(a, p)
    return base + ascent_points, DEFAULT_IF


def _method_session_rpe(a: dict, p: dict) -> tuple[float, float] | None:
    rpe = a.get("perceived_rpe")
    if not rpe:
        return None
    intensity = rpe / 10.0
    return _tss_from_if(_active_duration(a), intensity), intensity


def _method_grade_volume(a: dict, p: dict) -> tuple[float, float] | None:
    # TODO (Phase 2/3): grade-weighted climbing load from climbing_sets
    # (sum grade_numeric_weight x attempts x neuromuscular_coeff, scaled by wall-time density).
    # Until climbing detail is wired, return None so the ladder falls through to session_rpe.
    return None


def _method_tonnage_rpe(a: dict, p: dict) -> tuple[float, float] | None:
    # TODO (Phase 2/3): tonnage (sets x reps x kg) x avg RPE from strength_sets.
    return None


def _method_duration_fallback(a: dict, p: dict) -> tuple[float, float] | None:
    if not a.get("duration_s"):
        return None
    return _tss_from_if(_active_duration(a), DEFAULT_IF), DEFAULT_IF


_METHODS = {
    "tss": _method_tss,
    "hrtss": _method_hrtss,
    "rtss": _method_rtss,
    "vertical_duration": _method_vertical_duration,
    "grade_volume": _method_grade_volume,
    "tonnage_rpe": _method_tonnage_rpe,
    "session_rpe": _method_session_rpe,
    "duration_fallback": _method_duration_fallback,
}


def compute_load(activity: dict, sport: dict, profile: dict) -> LoadResult:
    """Pick the aerobic-engine method (first ladder method whose inputs exist), then build the two
    channels INDEPENDENTLY (see module docstring) and let the DB sum them.

    Aerobic-engine sports: the chosen method IS the aerobic load; the neuromuscular channel is the
    eccentric descent (D-) plus a small impact fraction of that aerobic effort, added on top.
    Strength/technical sports (STRUCTURAL_EFFORT_GROUPS): no aerobic engine, so the session effort is
    split aerobic : neuromuscular by taxonomy (mostly neuromuscular)."""
    ladder = sport.get("load_method_ladder") or ["duration_fallback"]
    chosen_method, points, intensity = "duration_fallback", 0.0, DEFAULT_IF
    for method in ladder:
        fn = _METHODS.get(method)
        if fn is None:
            continue
        # Prefer HR over the no-HR vertical estimate when this ladder offers hrtss — so a valid HR
        # reading is used (and the climb isn't double-counted), yet ladders without an hrtss step
        # (alpinism / via_ferrata) still get vertical_duration's ascent supplement rather than falling
        # through to duration_fallback. (Bug guard: HR must never LOWER a vertical day's load.)
        if method == "vertical_duration" and "hrtss" in ladder and _method_hrtss(activity, profile):
            continue
        result = fn(activity, profile)
        if result is not None:
            points, intensity = result
            chosen_method = method
            break

    group = sport["taxonomy_group"]
    if group in STRUCTURAL_EFFORT_GROUPS:
        a_ratio, n_ratio = CHANNEL_SPLIT.get(group, CHANNEL_SPLIT["other"])
        aerobic, neuromuscular = points * a_ratio, points * n_ratio
    else:
        # `points` is the cardiometabolic cost → the aerobic channel in full. The neuromuscular
        # channel is built additively from stressors the aerobic number can't see.
        impact = points * IMPACT_FRAC.get(group, IMPACT_FRAC["other"])
        aerobic = points
        neuromuscular = impact + _descent_load(activity, profile)

    return LoadResult(
        aerobic_load=round(aerobic, 2),
        neuromuscular_load=round(neuromuscular, 2),
        load_method_used=chosen_method,
        intensity_factor=round(intensity, 3) if intensity is not None else None,
        effective_days=activity_span_days(
            activity.get("started_at"), activity.get("duration_s"), activity.get("moving_s")),
    )
