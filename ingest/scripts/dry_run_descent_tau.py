"""READ-ONLY dry-run for Descent-P2 (exposure-dependent neuromuscular recovery τ).

Recomputes the neuro acute EWMA over the full daily spine with the NON-STATIONARY τ (descent familiarity
shortens it when adapted, lengthens it when de-adapted) and compares the latest `tsb_neuromuscular` to the
stored value (which still uses the constant τ — Phase 1 only). Writes NOTHING.
  ingest/.venv/bin/python ingest/scripts/dry_run_descent_tau.py
"""
from __future__ import annotations

from massif_ingest import db, load, sync


def _fetch_all_daily() -> list[dict]:
    """All daily_metrics rows (paginated past the 1000-row PostgREST cap), ascending by date."""
    out: list[dict] = []
    page = 0
    while True:
        lo, hi = page * 1000, page * 1000 + 999
        rows = (db.client().table("daily_metrics")
                .select("local_date,daily_neuromuscular_load,vertical_loss_m,ctl_neuromuscular,"
                        "atl_neuromuscular,tsb_neuromuscular")
                .order("local_date", desc=False).range(lo, hi).execute().data)
        out.extend(rows)
        if len(rows) < 1000:
            break
        page += 1
    return out


def main() -> None:
    rows = _fetch_all_daily()
    print(f"daily_metrics rows: {len(rows)}  (span {rows[0]['local_date']} → {rows[-1]['local_date']})")

    neuro = [float(r.get("daily_neuromuscular_load") or 0.0) for r in rows]
    daily_descent = {r["local_date"]: float(r.get("vertical_loss_m") or 0.0) for r in rows}
    neuro_atl_days = db.load_load_params().get("neuro_atl_days", sync.NEURO_ATL_DAYS)

    fam = load.descent_familiarity_ratios(daily_descent)
    neuro_tau = [neuro_atl_days * load.descent_recovery_factor(fam.get(r["local_date"])) for r in rows]

    ctl_n = sync._ewma_series(neuro, 42)              # neuro CTL — unchanged by P2 (fixed 42 d chronic)
    atl_const = sync._ewma_series(neuro, neuro_atl_days)
    atl_var = load.ewma_variable_tau(neuro, neuro_tau)

    taus = sorted(neuro_tau)
    print(f"\nneuro τ over spine: min {taus[0]:.1f} d · median {taus[len(taus)//2]:.1f} d · max {taus[-1]:.1f} d "
          f"(base {neuro_atl_days})")

    # Where does the variable τ move tsb_neuro most? (recent days matter for the verdict.)
    print("\nlast 10 days — tsb_neuro constant-τ → variable-τ:")
    for i in range(len(rows) - 10, len(rows)):
        r = rows[i]
        tsb_c = ctl_n[i] - atl_const[i]
        tsb_v = ctl_n[i] - atl_var[i]
        print(f"  {r['local_date']}  τ {neuro_tau[i]:.1f}  tsb_neuro {tsb_c:+6.2f} → {tsb_v:+6.2f}  ({tsb_v-tsb_c:+.2f})")

    i = len(rows) - 1
    print(f"\nlatest day {rows[i]['local_date']}:")
    print(f"  stored      tsb_neuro {rows[i].get('tsb_neuromuscular')}")
    print(f"  constant τ  tsb_neuro {ctl_n[i]-atl_const[i]:+.2f}   (atl_n {atl_const[i]:.2f})")
    print(f"  variable τ  tsb_neuro {ctl_n[i]-atl_var[i]:+.2f}   (atl_n {atl_var[i]:.2f})   ← Phase 2")
    print("\n(read-only — nothing written. Run `sync --skip-pull` to apply the rollup with Phase 2.)")


if __name__ == "__main__":
    main()
