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


def test_neuromuscular_acute_decays_slower_than_aerobic():
    # Prio-2 invariant: the neuromuscular channel's acute (fatigue) load uses a SLOWER tau than the
    # aerobic 7d, so structural fatigue lingers. One spike, then rest: neuro ATL stays higher for longer.
    assert sync.NEURO_ATL_DAYS > 7
    spike = [300.0] + [0.0] * 21
    aerobic_atl = sync._ewma_series(spike, tau_days=7)
    neuro_atl = sync._ewma_series(spike, tau_days=sync.NEURO_ATL_DAYS)
    # The slower τ gives a smaller initial spike but retains far more of it: a CROSSOVER (neuro starts
    # below aerobic, ends above it two weeks later) is the clean signature of slower-clearing fatigue.
    assert neuro_atl[0] < aerobic_atl[0]
    assert neuro_atl[14] > aerobic_atl[14]
    # fraction of its own peak still present at 2 weeks is much higher for the neuromuscular channel
    assert neuro_atl[14] / neuro_atl[0] > aerobic_atl[14] / aerobic_atl[0]
