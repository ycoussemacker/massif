#!/usr/bin/env bash
# Massif nightly — pull Strava + Garmin, roll up the unified load model, run the coach briefing.
#
# Built for UNATTENDED cron/launchd: it sets its own PATH (launchd/cron don't inherit the login
# shell's) and the ingest/coach load secrets from .env themselves. Garmin reuses its cached token
# (no MFA) and Strava auto-refreshes, so no interaction is needed after the one-time setup.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

# node is managed by fnm (its on-PATH location is per-shell and ephemeral) — resolve the newest
# installed fnm node, plus the usual homebrew/system bins. Python runs via the venv's absolute path.
FNM_NODE_DIR="$(ls -d "$HOME"/.local/share/fnm/node-versions/*/installation/bin 2>/dev/null | sort -V | tail -1)"
export PATH="${FNM_NODE_DIR:-}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

mkdir -p "$REPO/logs"
LOG="$REPO/logs/nightly-$(date +%F).log"
ts() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $1" | tee -a "$LOG"; }

log "=== Massif nightly start ==="

# 1. Ingestion + rollup. sync.py is resilient: one provider failing won't abort the other or the rollup.
PY="$REPO/ingest/.venv/bin/python"
if [ -x "$PY" ]; then
  log "ingest: sync (Strava + Garmin + rollup)…"
  if "$PY" -m massif_ingest.sync >>"$LOG" 2>&1; then log "ingest: ok"; else log "ingest: exited non-zero (see log)"; fi
else
  log "ingest: SKIP — venv missing (python -m venv ingest/.venv && ingest/.venv/bin/pip install -e ingest)"
fi

# 2. Coach briefing → writes coach_briefings + today's planned_sessions row.
TSX="$REPO/coach/node_modules/.bin/tsx"
if [ -x "$TSX" ] && command -v node >/dev/null 2>&1; then
  log "coach: briefing…"
  if "$TSX" "$REPO/coach/src/coach.ts" >>"$LOG" 2>&1; then log "coach: ok"; else log "coach: exited non-zero (see log)"; fi
else
  log "coach: SKIP — deps or node missing (pnpm -C coach install; ensure node is installed)"
fi

log "=== Massif nightly done ==="
