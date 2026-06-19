"""Cross-sport training-load computation — the heart of Massif.

Every activity gets ONE comparable load (TSS-style anchor: 100 points = 1h at threshold),
split into two channels that PARTITION the total:
  - aerobic_load        : cardiovascular cost (HRV/RHR-visible, recovers fast)
  - neuromuscular_load  : CNS + structural/tissue cost (HRV-blind, recovers slowly, injury vector)

The DB derives training_load = aerobic_load + neuromuscular_load (generated column), so this
module writes only the two channels.

`compute_load` walks the sport's ordered `load_method_ladder` and uses the first method whose
inputs are present, guaranteeing a non-NULL load for every activity.

NOTE: the coefficients/ratios below are population starting points. For a single athlete they
should be personalized from the user's own RPE-vs-Garmin history over the first few weeks
(see docs/ARCHITECTURE.md → "personalization"). Treat early output as provisional.
"""

from __future__ import annotations

from dataclasses import dataclass

# Default aerobic : neuromuscular split per taxonomy group (must sum to 1.0).
# A zone-2 run is mostly aerobic; limit bouldering is mostly neuromuscular; a big alpine
# day is high in both. These are refined per-session by intensity in TODO below.
CHANNEL_SPLIT: dict[str, tuple[float, float]] = {
    "paced_endurance":    (0.85, 0.15),
    "mountain_vertical":  (0.60, 0.40),  # long aerobic + heavy eccentric descent / pack load
    "technical_strength": (0.15, 0.85),  # climbing: fingers/forearms/CNS
    "resistance":         (0.10, 0.90),
    "aquatic":            (0.90, 0.10),
    "other":              (0.70, 0.30),
}

# Default intensity factor when nothing better is known (used by duration_fallback / sRPE base).
DEFAULT_IF = 0.55  # ~ easy aerobic effort


@dataclass
class LoadResult:
    aerobic_load: float
    neuromuscular_load: float
    load_method_used: str
    intensity_factor: float | None

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


# ── per-method computations: each returns (load_points, IF) or None if inputs are missing ──

def _method_tss(a: dict, p: dict) -> tuple[float, float] | None:
    np_w, ftp = a.get("np_power_w") or a.get("avg_power_w"), p.get("ftp_watts")
    if not (np_w and ftp):
        return None
    intensity = np_w / ftp
    return _tss_from_if(a["duration_s"], intensity), intensity


def _method_hrtss(a: dict, p: dict) -> tuple[float, float] | None:
    avg_hr, rhr, max_hr, lthr = a.get("avg_hr"), p.get("resting_hr"), p.get("max_hr"), p.get("lthr")
    if not (avg_hr and rhr and max_hr and lthr):
        return None
    avg_frac = _hr_fraction(avg_hr, rhr, max_hr)
    thr_frac = _hr_fraction(lthr, rhr, max_hr)
    intensity = avg_frac / thr_frac if thr_frac > 0 else DEFAULT_IF
    return _tss_from_if(a["duration_s"], intensity), intensity


def _method_rtss(a: dict, p: dict) -> tuple[float, float] | None:
    # pace-based TSS: IF = threshold_pace / actual_pace (faster = higher IF)
    avg_pace, thr_pace = a.get("avg_pace_s_per_km"), p.get("threshold_pace_s_per_km")
    if not (avg_pace and thr_pace):
        return None
    intensity = thr_pace / avg_pace
    return _tss_from_if(a["duration_s"], intensity), intensity


def _method_vertical_duration(a: dict, p: dict) -> tuple[float, float] | None:
    # Long low-intensity mountain load: duration aerobic base + vertical work scaled by carried mass.
    dur = a.get("duration_s")
    if not dur:
        return None
    vgain = a.get("vertical_gain_m") or 0.0
    weight = p.get("weight_kg") or 70.0
    mass_factor = 1.0 + (a.get("carried_load_kg") or 0.0) / weight
    base = _tss_from_if(dur, DEFAULT_IF)
    vertical_points = (vgain / 100.0) * 10.0 * mass_factor  # ~100 pts per 1000 m climbed
    # Blend with HR-based estimate if HR is available; take the larger (design rule).
    hr = _method_hrtss(a, p)
    total = base + vertical_points
    if hr:
        total = max(total, hr[0])
    return total, DEFAULT_IF


def _method_session_rpe(a: dict, p: dict) -> tuple[float, float] | None:
    rpe = a.get("perceived_rpe")
    if not rpe:
        return None
    intensity = rpe / 10.0
    return _tss_from_if(a["duration_s"], intensity), intensity


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
    return _tss_from_if(a["duration_s"], DEFAULT_IF), DEFAULT_IF


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
    """Walk the sport's load_method_ladder; use the first method whose inputs are present."""
    ladder = sport.get("load_method_ladder") or ["duration_fallback"]
    chosen_method, points, intensity = "duration_fallback", 0.0, DEFAULT_IF
    for method in ladder:
        fn = _METHODS.get(method)
        if fn is None:
            continue
        result = fn(activity, profile)
        if result is not None:
            points, intensity = result
            chosen_method = method
            break

    # TODO: refine the split by session intensity (hard intervals shift a paced run toward
    # the neuromuscular channel). For now use the taxonomy-group default.
    a_ratio, n_ratio = CHANNEL_SPLIT.get(sport["taxonomy_group"], CHANNEL_SPLIT["other"])
    return LoadResult(
        aerobic_load=round(points * a_ratio, 2),
        neuromuscular_load=round(points * n_ratio, 2),
        load_method_used=chosen_method,
        intensity_factor=round(intensity, 3) if intensity is not None else None,
    )
