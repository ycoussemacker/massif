# Massif

> Many summits, one massif. A personal multi-sport training app that reads all your sport as one
> adaptive system.

Massif pulls your **Strava** and **Garmin** data into one store, computes a **unified training
load across every sport** (running, trail, hiking, climbing, alpinism, cycling, strength… —
whatever you do), and is building toward an autonomous coach that reshapes your plan each morning
from your real recovery and load.

The trick: every activity — even climbing or a big hike, where there's no pace and HR lies —
produces one comparable load number, split into an **aerobic** and a **neuromuscular/structural**
channel. So a hard bouldering day correctly fatigues tomorrow's run, and the coach never stacks
two hard days on the same physiological budget.

## Structure

| Path | What |
|---|---|
| `web/` | Next.js dashboard (Next 16 · React 19 · Tailwind 4 · Supabase) |
| `ingest/` | Python ingestion + load computation (`massif_ingest`) |
| `coach/` | Agentic AI coach (TypeScript, Anthropic) — Phase 7 |
| `supabase/migrations/` | Postgres schema (source of truth) |
| `docs/ARCHITECTURE.md` | Design & rationale — **start here** |

## Quickstart

```bash
# 1. Web dashboard
cp .env.example .env.local            # fill Supabase keys
pnpm -C web install
pnpm -C web dev                       # http://localhost:3000

# 2. Ingestion
python -m venv ingest/.venv && source ingest/.venv/bin/activate
pip install -e ingest
cp .env.example ingest/.env           # fill Strava + Garmin creds
python -m massif_ingest.sync

# 3. Database (once a Supabase project exists)
supabase db push
```

## Status

**Phase 1 (scaffold) complete.** Roadmap in `docs/ARCHITECTURE.md`:
1. ✅ Scaffold  2. Strava  3. Garmin  4. Metrics  5. Dashboard  6. Profile+plan
7. Coach Brain  8. Scheduling  9. Deploy

Personal project. Not affiliated with Strava, Garmin, or any named app.
