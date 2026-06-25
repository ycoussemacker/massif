"""Backfill missing D- (vertical_loss_m) from the stored D+ (vertical_gain_m) — NO Strava re-fetch.

Old activities have D+ (Strava summary) but no D- (altitude streams were only fetched for the last ~90 d),
so the descent-training chart + model see nothing before ~2026-03-26. For the athlete's foot/ski activities
(loops & out-and-back: run / trail / hike / alpi / ski-touring …) D- ≈ D+, so we use the stored D+ as a
proxy where D- is missing. This is an APPROXIMATION (exact D- needs the altitude stream); excluded for
sports where it doesn't hold: aquatic (GPS-noise D+), cycling (descent isn't eccentric), downhill skiing
(D- >> D+), unknown/other. Only fills NULL/0 D- — never overwrites a real (stream-derived) value.

  preview:  ingest/.venv/bin/python ingest/scripts/backfill_descent_from_gain.py
  PERSIST:  ingest/.venv/bin/python ingest/scripts/backfill_descent_from_gain.py --write
Then re-score:  python -m massif_ingest.sync --recompute-loads
"""
from __future__ import annotations

import sys

from massif_ingest import db

# Foot/ski sports where descending is weight-bearing & eccentric AND D- ≈ D+ (self-powered, loop-ish).
ECCENTRIC_DESCENT_SPORTS = {
    "running", "trail_running", "hiking", "walking", "alpinism", "ski_touring",
    "snowshoeing", "via_ferrata", "grande_voie", "rock_climbing",
}


def main() -> None:
    write = "--write" in sys.argv
    c = db.client()
    sport_code = {s["id"]: s["code"] for s in c.table("sports").select("id,code").execute().data}

    acts: list[dict] = []
    page = 0
    while True:
        r = (c.table("activities").select("id,sport_id,local_date,vertical_gain_m,vertical_loss_m")
             .order("local_date").range(page * 1000, page * 1000 + 999).execute().data)
        acts += r
        if len(r) < 1000:
            break
        page += 1

    targets = [
        a for a in acts
        if (a.get("vertical_loss_m") or 0) <= 0
        and (a.get("vertical_gain_m") or 0) > 0
        and sport_code.get(a["sport_id"]) in ECCENTRIC_DESCENT_SPORTS
    ]
    added = sum(a["vertical_gain_m"] for a in targets)
    print(f"activities total: {len(acts)}")
    print(f"proxy targets (foot/ski, D- missing, D+ present): {len(targets)}")
    if targets:
        print(f"  date range: {targets[0]['local_date']} → {targets[-1]['local_date']}")
        print(f"  D- to fill (= their D+): {round(added)} m total")
    if not write:
        print("\n(preview — re-run with --write to persist, then `sync --recompute-loads`)")
        return

    n = 0
    for a in targets:
        c.table("activities").update({"vertical_loss_m": a["vertical_gain_m"]}).eq("id", a["id"]).execute()
        n += 1
    print(f"\n✓ filled {n} activities (vertical_loss_m = vertical_gain_m). Now run --recompute-loads.")


if __name__ == "__main__":
    main()
