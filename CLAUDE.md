# Massif — guide for Claude

Personal, **single-user, multi-sport** training app. Pulls Strava + Garmin into one Supabase
store, computes a unified cross-sport training load, and (later) runs an agentic AI coach that
reshapes the plan each morning. Read `docs/ARCHITECTURE.md` first — it holds the design rationale.

## Stack
- **web/** — Next.js 16 (App Router, `src/`) · React 19 · Tailwind 4 · TypeScript · pnpm.
  Supabase via `@supabase/ssr` (`web/src/lib/supabase/{client,server}.ts`, mirrors `yziame_website`).
- **ingest/** — Python ≥3.11 package `massif_ingest` (Strava REST + `python-garminconnect` + pandas).
- **coach/** — TypeScript (Anthropic SDK), run on a schedule. Empty until Phase 7.
- **supabase/** — SQL migrations (source of truth for the schema).
- **DB** — Supabase Postgres. Local-first for now; a personal Supabase **cloud** project will be
  provisioned (org separate from the company "AFOODI V0" org).

## The one thing to understand
Every activity gets ONE comparable `training_load`, split into two channels that PARTITION it:
`training_load` is a **generated column = aerobic_load + neuromuscular_load`. The coach reasons on
both channels + recovery, because climbing/strength load the neuromuscular/structural system that
HRV/Body Battery can't see. Don't break this invariant; write the two channels, never the total.

## Conventions & gotchas
- **Strava**: read `sport_type`, NOT the legacy `type` (it returns 'Ride' for road/gravel/MTB/ebike
  and 'Run' for road/trail). `sports.source_aliases` map provider strings → sport; unmatched →
  `unknown` (flagged). Strava 'Workout' is a generic catch-all → maps to `unknown`, not strength.
- **Garmin**: no official API. `python-garminconnect`; tokens cached in `GARMIN_TOKEN_DIR`
  (`~/.garminconnect`) — **never commit them** (gitignored).
- **Load**: `sports.load_method_ladder` is ordered; `load.compute_load` picks the first method
  whose inputs exist. Coefficients/ratios in `load.py` are population starting points — TODO to
  personalize per athlete.
- **RPE hybrid**: `needs_manual_rpe=true` sports prompt for a post-session RPE; others auto-estimate.
- **daily_metrics** is written by two column-scoped upserts (load rollup vs Garmin recovery) keyed
  on `local_date` — they must not include each other's columns. The rollup writes a contiguous
  daily spine (zero-load rest days included) so the EWMAs have no gaps.
- **RLS** is intentionally OFF (local-first). A later migration adds auth + RLS before any deploy.
- Secrets via `.env` (root) / `ingest/.env`; see `.env.example`. `COACH_MODEL` defaults to
  `claude-sonnet-4-6` (bump to `claude-opus-4-8` for heavy analyses).

## Run
```bash
# web
pnpm -C web dev                      # http://localhost:3000

# ingest (after creating a venv + pip install -e ingest)
python -m massif_ingest.sync                 # pull + rollup (pulls are stubbed until Phase 2/3)
python -m massif_ingest.sync --skip-pull     # recompute the daily fitness model only

# supabase (once a project/local stack exists)
supabase db push                     # apply migrations
```

## Status
Phase 1 (scaffold) done. Next: apply the migration to a Supabase project, then Phase 2 (Strava).
See `docs/ARCHITECTURE.md` → Phase roadmap. Don't commit unless asked.
