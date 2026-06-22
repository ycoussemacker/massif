# Ops — scheduling the Massif morning job

The morning run is **event-driven via polling** (Garmin has no usable push API for personal use):

- `morning.sh` (repo root) is the **poller**. launchd runs it every 30 min across the morning window
  (06:30–09:30). Each run: if today's marker exists → exit; else ask Garmin whether **last night's
  sleep is finalized** (`garmin.sleep_ready`, cached token, no MFA). If yes → run the pipeline once;
  if it's ≥ 09:30 → run anyway (fallback); otherwise wait for the next slot. A per-day marker
  (`logs/.done-YYYY-MM-DD`, written only on success) guarantees a single run; a failure retries next slot.
- `nightly.sh` (repo root) is the **pipeline** itself: Strava + Garmin pull → load rollup → coach
  briefing. Run it directly any time to force a run now.

So the briefing is generated right after you wake and your watch syncs, not at a fixed hour.
Timestamped logs land in `logs/nightly-YYYY-MM-DD.log`. Both scripts set their own PATH (node is
fnm-managed; python via the venv) and read secrets from `.env`.

Prereqs (one-time): `ingest/.venv` (`python -m venv ingest/.venv && ingest/.venv/bin/pip install -e
ingest`), `pnpm -C coach install`, and **one interactive Garmin login** so the token is cached in
`~/.garminconnect` (the unattended run can't answer an MFA prompt).

## Run / test manually
```bash
./nightly.sh                          # force the full pipeline now
./morning.sh                          # run the poller once (honors the marker; forces after 09:30)
rm -f logs/.done-$(date +%F)          # clear today's marker to let the poller fire again
tail -f logs/nightly-$(date +%F).log
```

## Schedule with launchd (recommended on macOS)
launchd survives sleep — it coalesces missed morning slots and fires on the next wake.
```bash
cp ops/io.massif.nightly.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/io.massif.nightly.plist     # enable
launchctl unload ~/Library/LaunchAgents/io.massif.nightly.plist   # disable
```
**Applying changes to the plist** (after editing times or the path): unload → cp → load.
The plist hardcodes the repo path `/Users/b/dev/perso/massif` and the morning window — edit if needed.

## Or with cron
cron can't run during sleep (no catch-up) — prefer launchd on a laptop.
```cron
*/30 6-9 * * *  /Users/b/dev/perso/massif/morning.sh
```
