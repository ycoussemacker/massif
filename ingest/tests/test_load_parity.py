"""Rejeu du jeu de cas d'or par PYTHON — le côté « source de vérité » du test de parité.

Ce fichier ne prouve pas la parité à lui seul : Python a produit ces valeurs, il les retrouve donc par
construction. Ce qu'il garde, c'est la RÉGRESSION — si un jour `load.py` change sans qu'on régénère le
fichier d'or, la suite rougit et le diff dit exactement quelles activités bougent.

La preuve de parité est portée par le jumeau : `web/src/lib/load.parity.test.ts`, qui rejoue LE MÊME
fichier contre `load.ts`. Les deux tournent en CI sur chaque push.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from massif_ingest import load

GOLDEN = json.loads(
    (pathlib.Path(__file__).resolve().parents[2] / "tests" / "golden" / "load-parity.json").read_text()
)
TOL = GOLDEN["tolerance"]


def close(a, b, what: str) -> None:
    if a is None or b is None:
        assert a == b, f"{what} : {a!r} vs {b!r}"
        return
    assert math.isclose(a, b, rel_tol=0, abs_tol=TOL), f"{what} : {a!r} vs {b!r} (écart {abs(a - b)})"


def test_golden_file_covers_every_ladder_method():
    """Un fichier d'or qui n'exercerait qu'une branche donnerait une fausse assurance."""
    used = {c["expected"]["load_method_used"] for c in GOLDEN["compute_load"]}
    for method in ("hrtss", "tss", "rtss", "vertical_duration", "session_rpe", "duration_fallback"):
        assert method in used, f"aucun cas n'atteint la méthode {method}"
    assert len(GOLDEN["compute_load"]) >= 100


@pytest.mark.parametrize("case", GOLDEN["compute_load"], ids=lambda c: c["id"])
def test_compute_load_matches_golden(case):
    res = load.compute_load(case["activity"], case["sport"], case["profile"], case["params"])
    exp = case["expected"]
    close(res.aerobic_load, exp["aerobic_load"], f"{case['id']} aerobic")
    close(res.neuromuscular_load, exp["neuromuscular_load"], f"{case['id']} neuro")
    close(res.intensity_factor, exp["intensity_factor"], f"{case['id']} IF")
    assert res.load_method_used == exp["load_method_used"], case["id"]
    assert res.effective_days == exp["effective_days"], case["id"]
    assert res.needs_review == exp["needs_review"], case["id"]


@pytest.mark.parametrize("c", GOLDEN["helpers"]["descent_factor"])
def test_descent_factor(c):
    close(load.descent_factor(c["ratio"]), c["expected"], "descent_factor")


@pytest.mark.parametrize("c", GOLDEN["helpers"]["descent_recovery_factor"])
def test_descent_recovery_factor(c):
    close(load.descent_recovery_factor(c["ratio"]), c["expected"], "descent_recovery_factor")


@pytest.mark.parametrize("c", GOLDEN["helpers"]["altitude_power_factor"])
def test_altitude_power_factor(c):
    close(load.altitude_power_factor(c["altitude_m"], c["acclimatized"]), c["expected"], "altitude_power_factor")


@pytest.mark.parametrize("c", GOLDEN["helpers"]["ewma_variable_tau"])
def test_ewma_variable_tau(c):
    got = load.ewma_variable_tau(c["values"], c["tau_days"])
    assert len(got) == len(c["expected"])
    for i, (g, e) in enumerate(zip(got, c["expected"])):
        close(g, e, f"ewma[{i}]")


@pytest.mark.parametrize("c", GOLDEN["helpers"]["descent_familiarity_ratios"])
def test_descent_familiarity_ratios(c):
    got = load.descent_familiarity_ratios(c["daily_descent"])
    assert sorted(got) == sorted(c["expected"])
    for k, e in c["expected"].items():
        close(got[k], e, f"ratio[{k}]")


@pytest.mark.parametrize("c", GOLDEN["helpers"]["resolve_profile"])
def test_resolve_profile(c):
    assert load.resolve_profile(c["profile"], c["history"], c["on_date"]) == c["expected"]
