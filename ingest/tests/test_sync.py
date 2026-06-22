"""The CTL/ATL EWMA recurrence powers the whole fitness model the coach reads, so lock it in."""

import math

from massif_ingest import sync


def test_ewma_ramps_from_zero_seed():
    out = sync._ewma_series([100, 0, 0, 0, 0], tau_days=7)
    alpha = 1.0 - math.exp(-1.0 / 7)
    assert abs(out[0] - alpha * 100) < 1e-9   # seeded at 0, first step = alpha * value
    assert out[1] < out[0]                     # decays once the spike passes
    assert out[-1] < out[1]


def test_ewma_converges_to_constant_load():
    flat = sync._ewma_series([50.0] * 300, tau_days=42)
    assert abs(flat[-1] - 50.0) < 0.5          # sustained load -> CTL approaches it


def test_ewma_atl_reacts_faster_than_ctl():
    load = [80.0] * 20
    atl = sync._ewma_series(load, tau_days=7)
    ctl = sync._ewma_series(load, tau_days=42)
    assert atl[-1] > ctl[-1]                    # shorter tau ramps quicker -> positive early fatigue
