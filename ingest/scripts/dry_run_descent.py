"""READ-ONLY dry-run for Descent-P1 (repeated-bout descent factor) — docs/research/descent-neuromuscular-rpe.md.

Reuses the REAL source-of-truth functions (load.descent_familiarity_ratios + load.compute_load + the
sync rollup EWMA), so the numbers match what `python -m massif_ingest.sync --recompute-loads` would write
ONCE the callers are wired. It writes NOTHING — it only reports the magnitude of the change so we can
decide whether to ship it:
  ingest/.venv/bin/python ingest/scripts/dry_run_descent.py

For each activity it recomputes the load twice — without the familiarity factor (today's behaviour) and
with it stamped from the activity's trailing-D- context — then re-runs the daily EWMA on both to show the
effect on the LATEST day's CTL/ATL/TSB (combined + per-channel). No provider pull, no DB write.
"""
from __future__ import annotations

from datetime import date, timedelta

from massif_ingest import db, load, sync

ACT_FIELDS = (
    "id,sport_id,local_date,started_at,duration_s,moving_s,avg_hr,np_power_w,avg_power_w,"
    "avg_pace_s_per_km,vertical_gain_m,vertical_loss_m,carried_load_kg,perceived_rpe,rpe_source,"
    "avg_altitude_m,effective_days,aerobic_load,neuromuscular_load"
)


def _daily_model(per_activity: list[dict], key_aer: str, key_neu: str):
    """Replicate sync.rollup_daily_metrics aggregation (multi-day spread) on an in-memory per-activity
    list and return the latest-day combined + per-channel CTL/ATL/TSB."""
    days: dict[date, dict] = {}
    for a in per_activity:
        start = date.fromisoformat(a["local_date"])
        eff = max(int(a.get("effective_days") or 1), 1)
        aer, neu = a[key_aer] / eff, a[key_neu] / eff
        for i in range(eff):
            d = start + timedelta(days=i)
            b = days.setdefault(d, {"aer": 0.0, "neu": 0.0})
            b["aer"] += aer
            b["neu"] += neu
    lo, hi = min(days), max(days)
    spine = [lo + timedelta(days=i) for i in range((hi - lo).days + 1)]
    total = [days.get(d, {}).get("aer", 0.0) + days.get(d, {}).get("neu", 0.0) for d in spine]
    aerobic = [days.get(d, {}).get("aer", 0.0) for d in spine]
    neuro = [days.get(d, {}).get("neu", 0.0) for d in spine]
    neuro_atl_days = db.load_load_params().get("neuro_atl_days", sync.NEURO_ATL_DAYS)
    ctl, atl = sync._ewma_series(total, 42), sync._ewma_series(total, 7)
    ctl_n, atl_n = sync._ewma_series(neuro, 42), sync._ewma_series(neuro, neuro_atl_days)
    return {
        "date": spine[-1].isoformat(),
        "ctl": ctl[-1], "atl": atl[-1], "tsb": ctl[-1] - atl[-1],
        "ctl_n": ctl_n[-1], "atl_n": atl_n[-1], "tsb_n": ctl_n[-1] - atl_n[-1],
    }


def main() -> None:
    sport_by_id = {s["id"]: s for s in db.client().table("sports").select("*").execute().data}
    profile = db.load_athlete_profile()
    params = db.load_load_params()
    threshold_history = db.load_threshold_history()

    acts = db.client().table("activities").select(ACT_FIELDS).execute().data
    print(f"activities: {len(acts)}")

    # daily D- series (sum of vertical_loss_m per local_date) — drives the familiarity ratios.
    daily_descent: dict[str, float] = {}
    for a in acts:
        daily_descent[a["local_date"]] = daily_descent.get(a["local_date"], 0.0) + float(a.get("vertical_loss_m") or 0.0)

    def recompute(ratios: dict[str, float]):
        factors = {d: load.descent_factor(r) for d, r in ratios.items()}
        old_rows, new_rows, deltas = [], [], []
        for a in acts:
            sport = sport_by_id.get(a["sport_id"])
            if not sport:
                continue
            eff_profile = load.resolve_profile(profile, threshold_history, a.get("local_date"))
            old = load.compute_load(dict(a), sport, eff_profile, params)
            new = load.compute_load({**a, "descent_familiarity": ratios.get(a["local_date"])}, sport, eff_profile, params)
            base = {"local_date": a["local_date"], "effective_days": a.get("effective_days")}
            old_rows.append({**base, "aer": old.aerobic_load, "neu": old.neuromuscular_load})
            new_rows.append({**base, "aer": new.aerobic_load, "neu": new.neuromuscular_load})
            dn = new.neuromuscular_load - old.neuromuscular_load
            if abs(dn) >= 0.5:
                deltas.append((dn, a, sport, factors.get(a["local_date"], 1.0), old, new))
        return factors, old_rows, new_rows, deltas

    # SWEEP the naive-reference anchor percentile (lower = bigger standing trained discount).
    print("\nanchor sweep (pct → factor spread · total neuro Δ · latest-day TSB_neuro):")
    for pct in (50, 35, 25, 20, 15):
        ratios = load.descent_familiarity_ratios(daily_descent, anchor_pct=pct)
        _, old_rows, new_rows, _ = recompute(ratios)
        fv = sorted(load.descent_factor(r) for r in ratios.values())
        old_neu, new_neu = sum(r["neu"] for r in old_rows), sum(r["neu"] for r in new_rows)
        om, nm = _daily_model(old_rows, "aer", "neu"), _daily_model(new_rows, "aer", "neu")
        print(f"  p{pct:<2d}  factor {fv[0]:.2f}–{fv[-1]:.2f} med {fv[len(fv)//2]:.2f}  "
              f"neuro {old_neu:.0f}→{new_neu:.0f} ({100*(new_neu-old_neu)/old_neu:+.1f}%)  "
              f"TSB_neuro {om['tsb_n']:+.1f}→{nm['tsb_n']:+.1f}")

    # SWEEP the swing (bound width) at the default anchor — does a wider band deliver more discount?
    print("\nswing sweep @ default anchor (swing → factor spread · total neuro Δ · latest TSB_neuro):")
    orig_swing = load.DESCENT_FAMILIARITY_SWING
    ratios0 = load.descent_familiarity_ratios(daily_descent)
    for sw in (0.25, 0.35, 0.45):
        load.DESCENT_FAMILIARITY_SWING = sw
        _, old_rows, new_rows, _ = recompute(ratios0)
        fv = sorted(load.descent_factor(r) for r in ratios0.values())
        old_neu, new_neu = sum(r["neu"] for r in old_rows), sum(r["neu"] for r in new_rows)
        nm = _daily_model(new_rows, "aer", "neu")
        print(f"  swing {sw:.2f}  factor {fv[0]:.2f}–{fv[-1]:.2f}  "
              f"neuro {old_neu:.0f}→{new_neu:.0f} ({100*(new_neu-old_neu)/old_neu:+.1f}%)  TSB_neuro {nm['tsb_n']:+.1f}")
    load.DESCENT_FAMILIARITY_SWING = orig_swing

    # The ABSOLUTE "trained discount" lever: lower the BASE coefficient (lit.: trained ≈ 0.70-0.78 × naive)
    # and keep the dynamic factor (median-anchored) to recover the naive cost when de-adapted. The base
    # change is what actually delivers a standing -X% — the dynamic factor alone can't (see sweeps above).
    print("\nbase re-baseline @ median anchor (base 70=naive → trained value · total neuro Δ · latest TSB_neuro):")
    ratios50 = load.descent_familiarity_ratios(daily_descent, anchor_pct=50)
    for base in (70, 60, 55, 49):
        factors = {d: load.descent_factor(r) for d, r in ratios50.items()}
        old_rows, new_rows = [], []
        for a in acts:
            sport = sport_by_id.get(a["sport_id"])
            if not sport:
                continue
            ep = load.resolve_profile(profile, threshold_history, a.get("local_date"))
            old = load.compute_load(dict(a), sport, ep, params)
            new = load.compute_load({**a, "descent_familiarity": ratios50.get(a["local_date"])}, sport, ep,
                                    {**(params or {}), "descent_load_per_1000m": base})
            b = {"local_date": a["local_date"], "effective_days": a.get("effective_days")}
            old_rows.append({**b, "aer": old.aerobic_load, "neu": old.neuromuscular_load})
            new_rows.append({**b, "aer": new.aerobic_load, "neu": new.neuromuscular_load})
        old_neu, new_neu = sum(r["neu"] for r in old_rows), sum(r["neu"] for r in new_rows)
        nm = _daily_model(new_rows, "aer", "neu")
        tag = "(unchanged base)" if base == 70 else f"(≈{base/70:.2f}× naive)"
        print(f"  base {base} {tag:18s}  neuro {old_neu:.0f}→{new_neu:.0f} ({100*(new_neu-old_neu)/old_neu:+.1f}%)  "
              f"TSB_neuro {nm['tsb_n']:+.1f}")

    # detail at the current default (DESCENT_FAMILIARITY_ANCHOR_PCT).
    ratios = load.descent_familiarity_ratios(daily_descent)
    factors, old_rows, new_rows, deltas = recompute(ratios)
    print(f"\n── detail @ default anchor p{int(load.DESCENT_FAMILIARITY_ANCHOR_PCT)} ──")

    fac_vals = sorted(factors.values())
    if fac_vals:
        n = len(fac_vals)
        med = fac_vals[n // 2] if n % 2 else (fac_vals[n // 2 - 1] + fac_vals[n // 2]) / 2
        moved = sum(1 for f in fac_vals if abs(f - 1.0) > 0.02)
        print(f"factor over {n} descent-active dates: min {min(fac_vals):.3f} · median {med:.3f} · "
              f"max {max(fac_vals):.3f} · {moved} dates ({100 * moved / n:.0f}%) move >2%")

    old_neu = sum(r["neu"] for r in old_rows)
    new_neu = sum(r["neu"] for r in new_rows)
    print(f"total neuromuscular load (all history): {old_neu:.0f} → {new_neu:.0f} pts "
          f"({100 * (new_neu - old_neu) / old_neu:+.1f}%)")

    print("\ntop activities by |Δ neuro| (Δneuro pts · factor · sport · date · D-):")
    for dn, a, sport, f, old, new in sorted(deltas, key=lambda x: -abs(x[0]))[:12]:
        print(f"  {dn:+7.1f}  ×{f:.2f}  {sport.get('code','?'):16s} {a['local_date']}  "
              f"D- {int(a.get('vertical_loss_m') or 0):5d} m  neuro {old.neuromuscular_load:.0f}→{new.neuromuscular_load:.0f}")

    old_m, new_m = _daily_model(old_rows, "aer", "neu"), _daily_model(new_rows, "aer", "neu")
    print(f"\nlatest day {new_m['date']} — fitness model old → new:")
    print(f"  CTL   {old_m['ctl']:7.2f} → {new_m['ctl']:7.2f}   ({new_m['ctl']-old_m['ctl']:+.2f})")
    print(f"  ATL   {old_m['atl']:7.2f} → {new_m['atl']:7.2f}   ({new_m['atl']-old_m['atl']:+.2f})")
    print(f"  TSB   {old_m['tsb']:7.2f} → {new_m['tsb']:7.2f}   ({new_m['tsb']-old_m['tsb']:+.2f})")
    print(f"  CTL_neuro {old_m['ctl_n']:7.2f} → {new_m['ctl_n']:7.2f}   ({new_m['ctl_n']-old_m['ctl_n']:+.2f})")
    print(f"  ATL_neuro {old_m['atl_n']:7.2f} → {new_m['atl_n']:7.2f}   ({new_m['atl_n']-old_m['atl_n']:+.2f})")
    print(f"  TSB_neuro {old_m['tsb_n']:7.2f} → {new_m['tsb_n']:7.2f}   ({new_m['tsb_n']-old_m['tsb_n']:+.2f})")
    print("\n(read-only — nothing written. Wire callers + `--recompute-loads` to apply.)")


if __name__ == "__main__":
    main()
