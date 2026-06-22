"""Nightly orchestrator: pull Strava + Garmin, then roll up the combined daily fitness model.

Run order each night (chained from nightly.sh, after which the TS coach runs):
  1. strava.sync()  → activities + streams + per-activity load (Phase 2)
  2. garmin.sync()  → daily_metrics recovery columns (Phase 3)
  3. rollup_daily_metrics() → sum load across ALL sports per day + CTL/ATL/TSB/ACWR (this file)

Upserts are column-scoped: the load rollup writes only load/model columns and Garmin writes only
recovery columns, so the two never clobber each other on the shared daily_metrics row.
"""

from __future__ import annotations

import argparse
import math
from datetime import date, timedelta

from . import db, load


def _ewma_series(values: list[float], tau_days: float) -> list[float]:
    """Banister-style exponential moving average (CTL/ATL). alpha = 1 - e^(-1/tau)."""
    alpha = 1.0 - math.exp(-1.0 / tau_days)
    out: list[float] = []
    prev = 0.0
    for v in values:
        prev = prev + alpha * (v - prev)
        out.append(prev)
    return out


def recompute_activity_loads() -> int:
    """Re-apply load.compute_load to every stored activity using its persisted fields — how a load-MODEL
    change reaches historical data WITHOUT re-pulling from the providers (D-, HR, RPE, etc. are already
    in the DB). Writes only the load columns; the daily rollup below then refreshes CTL/ATL/TSB/ACWR.
    Re-run after editing load.py. (A provider pull recomputes load too, but only for its recent window.)"""
    sport_by_id = {s["id"]: s for s in db.client().table("sports").select("*").execute().data}
    profile = db.load_athlete_profile()
    updated = 0
    for a in db.fetch_activities_for_recompute():
        sport = sport_by_id.get(a["sport_id"])
        if not sport:
            continue
        r = load.compute_load(a, sport, profile)
        db.update_activity_load(a["id"], {
            "aerobic_load": r.aerobic_load,
            "neuromuscular_load": r.neuromuscular_load,
            "load_method_used": r.load_method_used,
            "intensity_factor": r.intensity_factor,
        })
        updated += 1
    return updated


def rollup_daily_metrics(ctl_days: int = 42, atl_days: int = 7) -> int:
    """Recompute the daily load series + fitness model from activities, upsert daily_metrics.

    Builds a CONTIGUOUS daily spine (zero-load rest days included) so the EWMAs have no gaps.
    Returns the number of days written.
    """
    sport_by_id = {s["id"]: s for s in db.client().table("sports").select("*").execute().data}
    acts = (
        db.client()
        .table("activities")
        .select("local_date,aerobic_load,neuromuscular_load,vertical_gain_m,"
                "vertical_loss_m,sport_id")
        .execute()
        .data
    )
    if not acts:
        return 0

    # Aggregate per day.
    days: dict[date, dict] = {}
    for a in acts:
        d = date.fromisoformat(a["local_date"])
        bucket = days.setdefault(d, {"aer": 0.0, "neu": 0.0, "vup": 0.0, "vdn": 0.0, "by_group": {}})
        aer = float(a.get("aerobic_load") or 0)
        neu = float(a.get("neuromuscular_load") or 0)
        bucket["aer"] += aer
        bucket["neu"] += neu
        bucket["vup"] += float(a.get("vertical_gain_m") or 0)
        bucket["vdn"] += float(a.get("vertical_loss_m") or 0)
        group = sport_by_id.get(a["sport_id"], {}).get("taxonomy_group", "other")
        bucket["by_group"][group] = bucket["by_group"].get(group, 0.0) + aer + neu

    # Contiguous date spine.
    start, end = min(days), max(days)
    spine = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    total = [days.get(d, {}).get("aer", 0.0) + days.get(d, {}).get("neu", 0.0) for d in spine]
    aerobic = [days.get(d, {}).get("aer", 0.0) for d in spine]
    neuro = [days.get(d, {}).get("neu", 0.0) for d in spine]

    ctl, atl = _ewma_series(total, ctl_days), _ewma_series(total, atl_days)
    ctl_a, atl_a = _ewma_series(aerobic, ctl_days), _ewma_series(aerobic, atl_days)
    ctl_n, atl_n = _ewma_series(neuro, ctl_days), _ewma_series(neuro, atl_days)

    written = 0
    for i, d in enumerate(spine):
        b = days.get(d, {})
        db.upsert_daily_metric({
            "local_date": d.isoformat(),
            "daily_load": round(total[i], 2),
            "daily_aerobic_load": round(aerobic[i], 2),
            "daily_neuromuscular_load": round(neuro[i], 2),
            "vertical_gain_m": round(b.get("vup", 0.0), 1),
            "vertical_loss_m": round(b.get("vdn", 0.0), 1),
            "load_by_group": {k: round(v, 2) for k, v in b.get("by_group", {}).items()},
            "ctl": round(ctl[i], 2),
            "atl": round(atl[i], 2),
            "tsb": round(ctl[i] - atl[i], 2),
            "ctl_aerobic": round(ctl_a[i], 2),
            "atl_aerobic": round(atl_a[i], 2),
            "ctl_neuromuscular": round(ctl_n[i], 2),
            "atl_neuromuscular": round(atl_n[i], 2),
            "acwr": round(atl[i] / ctl[i], 2) if ctl[i] > 0 else None,
        })
        written += 1
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Massif nightly ingestion + rollup")
    parser.add_argument("--strava-days", type=int, default=30)
    parser.add_argument("--garmin-days", type=int, default=7)
    parser.add_argument("--skip-pull", action="store_true", help="only recompute the rollup")
    parser.add_argument("--recompute-loads", action="store_true",
                        help="re-apply the load model to all stored activities (after a load.py change), "
                             "then roll up — implies --skip-pull")
    parser.add_argument("--export-garmin-token", action="store_true",
                        help="mirror the local Garmin token (~/.garminconnect) to Supabase so the "
                             "cloud/no-Mac nightly can reuse it (do this once after a local MFA login), "
                             "then exit")
    args = parser.parse_args()

    if args.export_garmin_token:
        from . import garmin
        from .config import Settings
        ok = garmin.persist_token(Settings.load())
        print("garmin token: exported to Supabase" if ok
              else "garmin token: NO local token file found — run a Garmin login first")
        return

    if args.recompute_loads:
        print(f"recompute: {recompute_activity_loads()} activities re-scored")

    if not args.skip_pull and not args.recompute_loads:
        from . import garmin, strava

        # One provider failing (bad creds, API 4xx/5xx, network blip) must not abort the other
        # pull OR the rollup below — the nightly job stays resilient and always recomputes.
        try:
            n = strava.sync(after_days=args.strava_days)
            print(f"strava: {n} activities")
        except Exception as e:
            print(f"strava: skipped ({type(e).__name__}: {e})")
        try:
            n = garmin.sync(days=args.garmin_days)
            print(f"garmin: {n} days")
        except Exception as e:
            print(f"garmin: skipped ({type(e).__name__}: {e})")

    print(f"rollup: {rollup_daily_metrics()} daily_metrics rows")


if __name__ == "__main__":
    main()
