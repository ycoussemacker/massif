#!/usr/bin/env bash
# Massif morning poller — fire the nightly pipeline as soon as Garmin has finalized last night's
# sleep (i.e. right after you wake + your watch syncs). launchd runs this every 30 min across the
# morning window; it self-gates with a per-day marker so the pipeline runs at most once, and forces
# a run at the fallback time if the sleep session was never detected.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

# launchd/cron don't inherit the login PATH; node is fnm-managed (ephemeral on-PATH location).
FNM_NODE_DIR="$(ls -d "$HOME"/.local/share/fnm/node-versions/*/installation/bin 2>/dev/null | sort -V | tail -1)"
export PATH="${FNM_NODE_DIR:-}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

mkdir -p "$REPO/logs"
LOG="$REPO/logs/nightly-$(date +%F).log"
MARKER="$REPO/logs/.done-$(date +%F)"
ts() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] poller: $1" | tee -a "$LOG"; }

[ -f "$MARKER" ] && exit 0   # already ran successfully today

FORCE=930                              # HHMM fallback: run unconditionally from 09:30
now=$((10#$(date +%H%M)))              # 10# = force base-10 (avoid octal parse of e.g. 0830)

# Ask Garmin whether last night's sleep is finalized (cached token → no re-login / no MFA).
PY="$REPO/ingest/.venv/bin/python"
ready=1
if [ -x "$PY" ]; then
  "$PY" -c "import sys; from massif_ingest.config import Settings; from massif_ingest.garmin import login, sleep_ready; sys.exit(0 if sleep_ready(login(Settings.load())) else 1)" >/dev/null 2>&1
  ready=$?
fi

if [ "$ready" -eq 0 ]; then
  log "nuit de sommeil finalisée détectée → run"
elif [ "$now" -ge "$FORCE" ]; then
  log "fallback ${FORCE} atteint → run (sommeil non détecté)"
else
  log "sommeil pas encore finalisé — nouvel essai au prochain créneau"
  exit 0
fi

# Run the pipeline; mark done only on success so a failure retries at the next slot.
if "$REPO/nightly.sh"; then
  touch "$MARKER"
  log "pipeline terminé, marqueur du jour posé"
else
  log "pipeline en échec — réessai au prochain créneau"
fi
