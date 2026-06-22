"""Morning gate for the cloud cron — decide whether to generate today's briefing NOW.

Mirrors the old event-driven morning.sh poller: the cloud workflow fires several times across the
morning; this gate lets the pipeline run only once Garmin has FINALIZED last night's sleep (so the
briefing reflects that morning's recovery, not yesterday's). A final "force" slot generates anyway
if the night never finalized, so a briefing always lands.

Decision (exit code):
  10 = SKIP  (already done for today, or sleep not finalized yet → a later slot will retry)
   0 = PROCEED (run the full pull + rollup + coach)
A non-0/10 exit means an unexpected error (surfaces as a failed job).

Idempotency: once today's briefing exists, every later slot skips — so the `--force` slot is a no-op
when an earlier slot already succeeded.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from . import db, garmin
from .config import Settings

SKIP = 10
PROCEED = 0


def _local_today(s: Settings) -> str:
    """Today's date in the athlete's timezone — matches the date the coach writes briefings under
    (and the date Garmin files last night's sleep under)."""
    return datetime.now(ZoneInfo(s.timezone)).date().isoformat()


def _briefing_exists(today: str) -> bool:
    rows = (
        db.client()
        .table("coach_briefings")
        .select("id")
        .eq("briefing_date", today)
        .limit(1)
        .execute()
        .data
    )
    return bool(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Massif morning gate (cloud cron)")
    parser.add_argument("--force", action="store_true",
                        help="generate even if sleep isn't finalized (final morning slot / manual run)")
    args = parser.parse_args()

    s = Settings.load()
    today = _local_today(s)

    # Already generated today → nothing to do (keeps the force slot + retries idempotent).
    if _briefing_exists(today):
        print(f"gate: briefing for {today} already exists — SKIP")
        sys.exit(SKIP)

    if args.force:
        print(f"gate: forced (final slot / manual) — PROCEED for {today}")
        sys.exit(PROCEED)

    # Gate on Garmin having finalized last night's sleep. Any failure → wait for the next slot
    # (the token comes from Supabase; a transient Garmin hiccup shouldn't generate a stale briefing).
    garmin.hydrate_token(s)
    try:
        client = garmin.login(s)
        garmin.persist_token(s)
        ready = garmin.sleep_ready(client, today)
    except Exception as e:  # noqa: BLE001 — defensive: never fail the job over a transient check
        print(f"gate: Garmin check failed ({type(e).__name__}: {e}) — SKIP, will retry next slot")
        sys.exit(SKIP)

    if ready:
        print(f"gate: sleep finalized for {today} — PROCEED")
        sys.exit(PROCEED)

    print(f"gate: sleep not finalized yet for {today} — SKIP, will retry next slot")
    sys.exit(SKIP)


if __name__ == "__main__":
    main()
