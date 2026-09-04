"""Génère le jeu de cas d'or de parité — `tests/golden/load-parity.json`.

POURQUOI CE FICHIER EXISTE. Le modèle de charge est écrit DEUX FOIS : `ingest/massif_ingest/load.py`
(601 lignes, source de vérité, exécutée par le cron et le re-scoring) et `web/src/lib/load.ts`
(516 lignes, exécutée par la synchro à la demande et par chaque correction depuis l'app). Les deux
doivent rendre le MÊME nombre, sinon la charge d'une activité dépend du chemin par lequel elle a été
calculée — et personne ne s'en aperçoit, puisque les deux valeurs sont plausibles.

Jusqu'ici la parité reposait sur UNE vérification manuelle (« 395/395 activités, CTL exact »), faite
une fois, invalidée depuis par chaque évolution du modèle. Un commentaire « KEEP IN SYNC » n'est pas
un test.

Ici, Python calcule les valeurs attendues (il EST la source de vérité) et les deux suites les
rejouent : pytest pour se garder d'une régression Python, node pour vérifier que le miroir TypeScript
n'a pas dérivé. Tolérance 1e-9 — on compare des flottants IEEE754 issus du même calcul, pas des
approximations.

    ingest/.venv/bin/python ingest/scripts/gen_load_golden.py

À relancer APRÈS toute évolution volontaire du modèle, et à committer avec elle : le diff du fichier
d'or montre alors exactement ce que le changement déplace, activité par activité.
"""
from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from massif_ingest import load  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parents[2] / "tests" / "golden" / "load-parity.json"

PROFILE = {
    "max_hr": 188, "resting_hr": 48, "lthr": 172, "ftp_watts": 265,
    "threshold_pace_s_per_km": 258, "weight_kg": 68,
}

SPORTS = {
    "trail_running": {"taxonomy_group": "endurance", "load_method_ladder": ["hrtss", "rtss", "duration_fallback"]},
    "running": {"taxonomy_group": "endurance", "load_method_ladder": ["rtss", "hrtss", "duration_fallback"]},
    "cycling": {"taxonomy_group": "endurance", "load_method_ladder": ["tss", "hrtss", "duration_fallback"]},
    "hiking": {"taxonomy_group": "endurance", "load_method_ladder": ["hrtss", "vertical_duration", "duration_fallback"]},
    "alpinism": {"taxonomy_group": "endurance", "load_method_ladder": ["vertical_duration", "session_rpe", "duration_fallback"]},
    "bouldering": {"taxonomy_group": "technical_strength", "load_method_ladder": ["grade_volume", "session_rpe", "duration_fallback"]},
    "strength": {"taxonomy_group": "resistance", "load_method_ladder": ["tonnage_rpe", "session_rpe", "duration_fallback"]},
    "surf": {"taxonomy_group": "other", "load_method_ladder": ["session_rpe", "duration_fallback"]},
}


def case(cid: str, why: str, sport: str, activity: dict, params: dict | None = None,
         profile: dict | None = None) -> dict:
    p = profile or PROFILE
    res = load.compute_load(activity, SPORTS[sport], p, params)
    return {
        "id": cid, "why": why, "sport_code": sport,
        "sport": SPORTS[sport], "profile": p, "params": params, "activity": activity,
        "expected": {
            "aerobic_load": res.aerobic_load,
            "neuromuscular_load": res.neuromuscular_load,
            "load_method_used": res.load_method_used,
            "intensity_factor": res.intensity_factor,
            "effective_days": res.effective_days,
            "needs_review": res.needs_review,
        },
    }


def named_cases() -> list[dict]:
    """Les invariants qu'on tient à nommer : chacun a déjà été un bug, ou en serait un demain."""
    return [
        case("hrtss-plat", "la branche la plus fréquente : FC + durée, sans dénivelé",
             "running", {"duration_s": 3600, "moving_s": 3600, "avg_hr": 152}),
        case("hrtss-descente", "le D− ajoute un coût NEUROMUSCULAIRE par-dessus une charge cardiaque calme",
             "trail_running", {"duration_s": 7200, "moving_s": 7000, "avg_hr": 141,
                               "vertical_gain_m": 900, "vertical_loss_m": 1400}),
        case("hrtss-bat-vertical", "quand l'échelle offre hrtss, vertical_duration est sauté (pas de double compte)",
             "hiking", {"duration_s": 10800, "moving_s": 9600, "avg_hr": 128,
                        "vertical_gain_m": 1200, "vertical_loss_m": 1200}),
        case("vertical-sans-fc", "sans FC, la montée fournit le supplément aérobie",
             "hiking", {"duration_s": 10800, "moving_s": 9600, "vertical_gain_m": 1200, "vertical_loss_m": 1200}),
        case("rpe-user-gagne", "un RPE SAISI passe devant vertical_duration — le bug de l'Upgrade 8",
             "alpinism", {"duration_s": 21600, "moving_s": 18000, "vertical_gain_m": 1500,
                          "vertical_loss_m": 1500, "perceived_rpe": 3, "rpe_source": "user"}),
        case("rpe-auto-ne-gagne-pas", "un RPE ESTIMÉ ne doit PAS déclencher la même bascule",
             "alpinism", {"duration_s": 21600, "moving_s": 18000, "vertical_gain_m": 1500,
                          "vertical_loss_m": 1500, "perceived_rpe": 3, "rpe_source": "estimated"}),
        case("rpe-differentiel", "≥2 sous-scores ⇒ le partage aéro/neuro vient de la PERCEPTION",
             "trail_running", {"duration_s": 5400, "moving_s": 5200, "avg_hr": 149,
                               "vertical_loss_m": 800, "perceived_rpe": 8, "rpe_source": "user",
                               "rpe_cardio": 6, "rpe_legs": 9, "rpe_grip": 2}),
        case("rpe-differentiel-plancher", "le terme de descente OBJECTIF reste un PLANCHER du canal neuro",
             "trail_running", {"duration_s": 9000, "moving_s": 8600, "avg_hr": 138,
                               "vertical_loss_m": 2200, "perceived_rpe": 5, "rpe_source": "user",
                               "rpe_cardio": 7, "rpe_legs": 3}),
        case("bloc-structurel", "sport structurel : pas de moteur aérobie, l'effort est SPLITTÉ par taxonomie",
             "bouldering", {"duration_s": 6000, "moving_s": 6000, "perceived_rpe": 7, "rpe_source": "user"}),
        case("renfo-structurel", "idem, groupe resistance (partage différent)",
             "strength", {"duration_s": 2700, "moving_s": 2700, "perceived_rpe": 8, "rpe_source": "user"}),
        case("puissance-altitude", "tss EST corrigé de l'altitude (l'air rare coûte plus pour les mêmes watts)",
             "cycling", {"duration_s": 5400, "moving_s": 5400, "np_power_w": 210, "avg_altitude_m": 2200}),
        case("puissance-plaine", "au niveau de la mer, la correction vaut 1,0 — sortie inchangée",
             "cycling", {"duration_s": 5400, "moving_s": 5400, "np_power_w": 210, "avg_altitude_m": 120}),
        case("fc-jamais-corrigee", "hrtss n'est JAMAIS corrigé de l'altitude : la FC compte déjà la contrainte",
             "trail_running", {"duration_s": 5400, "moving_s": 5400, "avg_hr": 150, "avg_altitude_m": 2600}),
        case("allure-altitude", "rtss est corrigé, comme la puissance",
             "running", {"duration_s": 3600, "moving_s": 3600, "avg_pace_s_per_km": 300, "avg_altitude_m": 2000}),
        case("masse-portee", "le sac augmente le coût de la montée et l'impact",
             "hiking", {"duration_s": 14400, "moving_s": 12600, "vertical_gain_m": 1600,
                        "vertical_loss_m": 1600, "carried_load_kg": 14}),
        case("expedition-multijours", "une sortie publiée en UNE activité doit s'étaler sur ses jours réels",
             "hiking", {"started_at": "2026-07-01T06:00:00Z", "duration_s": 317 * 3600,
                        "moving_s": 40 * 3600, "vertical_gain_m": 9000, "vertical_loss_m": 9000}),
        case("repli-duree", "aucune donnée exploitable : repli sur la durée seule",
             "surf", {"duration_s": 4800, "moving_s": 4800}),
        case("familiarite-descente", "le facteur de répétition module le coût de descente (±25 %)",
             "trail_running", {"duration_s": 7200, "moving_s": 7000, "avg_hr": 143,
                               "vertical_loss_m": 1600, "descent_familiarity": 0.4}),
        case("familiarite-descente-haute", "l'autre borne : bien adapté ⇒ coût réduit",
             "trail_running", {"duration_s": 7200, "moving_s": 7000, "avg_hr": 143,
                               "vertical_loss_m": 1600, "descent_familiarity": 2.5}),
        case("params-personnalises", "athlete_load_params remplace les coefficients de population",
             "trail_running", {"duration_s": 5400, "moving_s": 5400, "avg_hr": 147, "vertical_loss_m": 1100},
             params={"descent_load_per_1000m": 70.0, "ascent_aerobic_per_1000m": 85.0}),
        case("profil-vide", "profil sans seuils : aucune méthode FC/puissance ne s'arme",
             "running", {"duration_s": 3600, "moving_s": 3600, "avg_hr": 150},
             profile={"weight_kg": 68}),
    ]


def grid_cases() -> list[dict]:
    """Une grille déterministe par-dessus les cas nommés : la couverture des branches ne doit pas
    dépendre de mon imagination. Pas de hasard — l'indice pilote chaque variation."""
    out: list[dict] = []
    sports = list(SPORTS)
    n = 0
    for i, sport in enumerate(sports):
        for j in range(15):
            n += 1
            k = i * 15 + j
            a: dict = {"duration_s": 1800 + (k % 11) * 1500, "moving_s": 1700 + (k % 11) * 1450}
            if k % 3 == 0:
                a["avg_hr"] = 110 + (k % 7) * 11
            if k % 4 == 1:
                a["np_power_w"] = 150 + (k % 6) * 25
            if k % 5 == 2:
                a["avg_pace_s_per_km"] = 240 + (k % 9) * 15
            if k % 2 == 0:
                a["vertical_gain_m"] = (k % 13) * 180
                a["vertical_loss_m"] = (k % 17) * 150
            if k % 6 == 3:
                a["perceived_rpe"] = 1 + (k % 10)
                a["rpe_source"] = "user" if k % 12 < 6 else "estimated"
            if k % 7 == 4:
                a["carried_load_kg"] = (k % 5) * 4
            if k % 8 == 5:
                a["avg_altitude_m"] = 300 + (k % 9) * 350
            if k % 9 == 6 and a.get("perceived_rpe"):
                a["rpe_cardio"] = 1 + (k % 9)
                a["rpe_legs"] = 1 + ((k + 3) % 9)
            if k % 11 == 7:
                a["descent_familiarity"] = round(0.2 + (k % 13) * 0.22, 4)
            out.append(case(f"grille-{n:03d}", f"grille déterministe (sport={sport}, k={k})", sport, a))
    return out


def helper_cases() -> dict:
    """Les fonctions pures partagées : elles portent la forme de la fatigue, pas seulement la charge."""
    ratios = [None, 0.0, 0.25, 0.5, 0.9, 1.0, 1.4, 2.0, 3.5]
    daily = {f"2026-0{(i % 9) + 1}-{(i % 27) + 1:02d}": float((i * 137) % 1800) for i in range(40)}
    daily_thin = {"2026-05-01": 900.0, "2026-05-08": 400.0, "2026-05-15": 1200.0}
    return {
        "descent_factor": [{"ratio": r, "expected": load.descent_factor(r)} for r in ratios],
        "descent_recovery_factor": [{"ratio": r, "expected": load.descent_recovery_factor(r)} for r in ratios],
        "altitude_power_factor": [
            {"altitude_m": alt, "acclimatized": acc,
             "expected": load.altitude_power_factor(alt, acc)}
            for alt in [None, 0, 500, 800, 1200, 1800, 2500, 3400, 4500]
            for acc in [False, True]
        ],
        "ewma_variable_tau": [
            {"values": v, "tau_days": t, "expected": load.ewma_variable_tau(v, t)}
            for v, t in [
                ([], []),
                ([100.0], [7.0]),
                ([50.0, 0.0, 0.0, 120.0, 0.0, 80.0, 0.0], [7.0] * 7),
                ([50.0, 0.0, 0.0, 120.0, 0.0, 80.0, 0.0], [11.5, 12.0, 13.0, 14.0, 15.0, 16.0, 16.5]),
                ([float(i % 9) * 15 for i in range(60)], [14.0 - (i % 5) * 0.5 for i in range(60)]),
            ]
        ],
        "descent_familiarity_ratios": [
            {"daily_descent": d, "expected": load.descent_familiarity_ratios(d)}
            for d in [daily, daily_thin, {}]
        ],
        "descent_model_confidence": [
            {"daily_descent": d, "expected": load.descent_model_confidence(d)}
            for d in [daily, daily_thin, {}]
        ],
        "resolve_profile": [
            {"profile": PROFILE, "history": h, "on_date": d,
             "expected": load.resolve_profile(PROFILE, h, d)}
            for h, d in [
                (None, "2026-06-01"),
                ([], "2026-06-01"),
                ([{"effective_date": "2026-01-01", "lthr": 168, "max_hr": 189}], "2026-06-01"),
                ([{"effective_date": "2026-01-01", "lthr": 168},
                  {"effective_date": "2026-05-01", "lthr": 174}], "2026-06-01"),
                ([{"effective_date": "2026-07-01", "lthr": 176}], "2026-06-01"),
            ]
        ],
    }


def main() -> None:
    cases = named_cases() + grid_cases()
    payload = {
        "_": "Cas d'or de parité load.py ↔ load.ts. Généré par ingest/scripts/gen_load_golden.py — "
             "NE PAS ÉDITER À LA MAIN : régénérer et committer avec le changement de modèle.",
        "tolerance": 1e-9,
        "source_of_truth": "ingest/massif_ingest/load.py",
        "counts": {"compute_load": len(cases)},
        "compute_load": cases,
        "helpers": helper_cases(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=False) + "\n")
    methods: dict[str, int] = {}
    for c in cases:
        m = c["expected"]["load_method_used"]
        methods[m] = methods.get(m, 0) + 1
    print(f"{len(cases)} cas compute_load → {OUT.relative_to(OUT.parents[2])}")
    for m, n in sorted(methods.items(), key=lambda x: -x[1]):
        print(f"  {m:20s} {n}")


if __name__ == "__main__":
    main()
