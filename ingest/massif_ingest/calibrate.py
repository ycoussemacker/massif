"""Adaptive calibration of load coefficients from the athlete's own history (prio 3c).

Each fitter personalizes a population-default coefficient (in load.py / sync.py) ONLY when there is
enough ground-truth data, and only writes — returning the change — when the fitted value actually
moved. So the nightly job can re-fit cheaply every run and trigger a history re-score only on a real
change. Nothing here is required for the app to work: with no fitted params the model uses its
population defaults; results refine as the athlete's data accumulates.

Aerobic calibration (DEFAULT_IF) runs today off HR/power/pace history. Neuromuscular calibration
(DESCENT_LOAD_PER_1000M, NEURO_ATL_DAYS, …) joins here once the optional soreness log accumulates —
its ground truth (structural fatigue) is invisible to wearables, so it can't be fit from Garmin alone.
"""

from __future__ import annotations

import statistics

from . import db, load

MIN_IF_SAMPLES = 30   # HR/power/pace activities needed before personalizing DEFAULT_IF
PARAM_EPSILON = 0.01  # ignore fits that move a coefficient by less than this (avoid pointless re-scores)


def _changed(param: str, value: float, current: dict) -> bool:
    prev = current.get(param)
    return prev is None or abs(prev - value) > PARAM_EPSILON


def calibrate_default_if(current: dict) -> tuple[str, float, int] | None:
    """DEFAULT_IF is the EASY-effort assumption used to score activities with NO intensity source
    (surf, snowboard, casual outings). Those skew EASIER than the athlete's HR/power sessions (mostly
    runs/trails), so fitting it to the session MEDIAN over-states them — verified on real data (median
    0.76 vs an appropriate ~0.55). We therefore estimate it from the LOW end (20th percentile) of the
    athlete's intensity distribution and only ADOPT it when it is BELOW the population default — i.e. we
    only ever LOWER the easy assumption from data, never raise it. Returns (param, value, n) or None.

    For a typically-trained athlete this is a no-op (their easy IF already exceeds 0.55); it personalizes
    only when the athlete's efforts genuinely run easier. The real calibration payoff is the
    neuromuscular channel, which activates once the optional soreness log accumulates (prio 3c-B)."""
    rows = (
        db.client().table("activities")
        .select("intensity_factor")
        .in_("load_method_used", ["hrtss", "tss", "rtss"])
        .execute().data
    )
    ifs = sorted(float(r["intensity_factor"]) for r in rows if r.get("intensity_factor"))
    if len(ifs) < MIN_IF_SAMPLES:
        return None
    p20 = statistics.quantiles(ifs, n=5)[0]  # 20th percentile = the athlete's easy end
    value = round(p20, 3)
    qualifies = value < load.DEFAULT_IF  # never RAISE the easy assumption from (harder) session data
    if qualifies and _changed("default_if", value, current):
        db.upsert_load_param("default_if", value, n_samples=len(ifs))
        return ("default_if", value, len(ifs))
    if not qualifies and "default_if" in current:
        db.delete_load_param("default_if")  # a prior fit no longer qualifies → revert to the default
        return ("default_if", None, len(ifs))
    return None


def calibrate_all() -> dict:
    """Run every available auto-calibration; return the params that CHANGED (empty ⇒ nothing to re-score)."""
    current = db.load_load_params()
    changed: dict = {}
    r = calibrate_default_if(current)
    if r:
        changed[r[0]] = {"value": r[1], "n_samples": r[2]}
    return changed
