# Model upgrades — effort / fatigue / form

A running log of **innovations to the load → fatigue → form model**, layered on top of the baseline
described in [`ARCHITECTURE.md`](ARCHITECTURE.md) ("one global load, two channels"). Each entry records
the *problem*, the *change*, the *formula*, the *files touched* (Python source-of-truth + the TS mirrors),
how it was *verified*, and the *tunable* parameters it introduced.

**Why this file exists:** the baseline model is documented in ARCHITECTURE.md; this file tracks the
*deltas* so the innovation relative to a textbook Banister/TrainingPeaks PMC stays legible and auditable.

**Ground rules carried by every upgrade**
- `load.py` is the source of truth. The TS mirrors (`web/src/lib/load.ts`, `web/src/lib/rollup.ts`,
  `web/src/lib/strava-sync.ts`) and the coach mirrors (`coach/src/context.ts` ↔ `web/src/lib/coach-context.ts`,
  `coach/src/coach.ts` ↔ `web/src/lib/coach-briefing.ts`) must stay behaviourally identical.
- New coefficients/time-constants are **population starting points** — tunable, to be personalized from
  the athlete's own history later (see ARCHITECTURE.md → personalization).
- A model change reaches history without a provider re-pull via
  `python -m massif_ingest.sync --recompute-loads` (re-score) then the rollup.

---

## 2026-06-23 · Upgrade 1 — Multi-day expedition handling (data hygiene)

**Problem.** Strava lets a multi-day outing be published as **one** activity. Real case: a 13-day GR20
(`« Morning Hike » du gr20`) uploaded as a single activity with `elapsed_time = 317.7 h` (13 nights
included) and `local_date` = its start day. Two compounding distortions:
1. load was computed over the **elapsed** window → the nights counted as effort (hrTSS over 317 h);
2. a whole trip's load (**12 021 pts**, 27× the p99) landed on **one** calendar day.

The single spike wrecked the EWMAs: ATL → **1614**, TSB → **−1305** that day, then CTL stayed falsely
high (~180–300) for ~2 months as the slow (42 d) chronic term decayed, while the fast (7 d) ATL cleared —
manufacturing a **phantom +99 TSB** ("super fresh") for weeks. This is what surfaced the investigation
(the dashboard showed TSB ≈ +99 in Sept 2025).

**Change.** Detect a genuine multi-day **expedition** and (a) score it on **moving** time, (b) **spread**
its load evenly across the calendar days it truly spans.
- `effective_days` = calendar span of the activity, but only when it is a real expedition:
  `span > 1 day` **AND** a large non-moving gap `elapsed − moving ≥ MULTIDAY_GAP_S` (6 h, ~one overnight).
  A night race that merely crosses midnight (elapsed ≈ moving) stays `effective_days = 1` — unchanged.
- When `effective_days > 1`, load methods use **moving** seconds (`_active_duration`) instead of elapsed.
- The daily rollup spreads `aerobic/neuromuscular/vertical` by `1/effective_days` across the spanned days.
- `effective_days > 1` is also the persisted **audit flag** for an adjusted activity, and the generic
  multi-user mechanism (any user's multi-day uploads are split automatically, on every ingest path).

**Formulas** (`load.py`, mirrored in `load.ts`):
```
activity_span_days(started_at, duration_s, moving_s):
    span = (end_date − start_date) + 1        # end = started_at + elapsed; UTC calendar days
    gap  = duration_s − (moving_s or duration_s)
    return span  if span > 1 and gap ≥ 6h  else 1

_active_duration(a) = moving_s  if effective_days > 1  else duration_s   # elapsed
rollup: each spanned day d gets load(d) += channel / effective_days
```

**Files.** `ingest/massif_ingest/{load.py, sync.py, db.py, strava.py}` · mirrors
`web/src/lib/{load.ts, rollup.ts, strava-sync.ts}` · per-day-spread display in
`web/src/lib/aggregate.ts` (`groupByDateSpanned`, deduped by id), `web/src/components/{charts-section.tsx, activity-row.tsx}`,
`web/src/lib/data.ts` (`effective_days`, `moving_s`; `getDashboard` also fetches `effective_days > 1`
**unbounded** so an expedition starting before the chart window still projects onto in-view days) · RPE path
`web/src/app/actions.ts` (uses active time + persists `effective_days`) · migration `20260623000002_activity_effective_days.sql`.
Also: the Python rollup now **bulk-upserts** `daily_metrics` (was ~1800 sequential writes → REST timeouts).

**Verification.** GR20 re-scored 12 021 → **2 368 pts** total (`effective_days = 14`, hrTSS on 62.6 h moving),
spread to **~169 pts/day**. Aug–Oct 2025 **peak TSB +98.9 → +14.2** (CTL 178.8 → 63.5). Only that one
activity changed — median / p95 / p99 of `training_load` unchanged → zero regression on the other 394.
Dashboard day-panel now lists the expedition on **every** spanned day (169 pts/day, "jour i/14"), matching
the chart. pytest 38 green; tsc clean; adversarial review (2 confirmed findings fixed: a `??`-vs-`or` TS
parity bug at the multi-day flag, and the day-panel spread).

**Tunable.** `MULTIDAY_GAP_S = 6 h` (load.py / load.ts). Detection is deliberately conservative — it
isolates true expeditions and leaves continuous ultras / midnight-crossers as single-day.

---

## 2026-06-23 · Upgrade 2 — Per-channel form (TSB) with physiology-aware acute τ

**Problem.** The combined form `TSB = CTL − ATL` uses a single acute (fatigue) time constant of **7 days**.
That's right for the **aerobic** (cardiac) system — fatigue clears in ~days and is visible to HRV /
Body Battery. It is **wrong** for the **neuromuscular / structural** system (eccentric descent, impact,
carried mass): tendon and structural fatigue linger **weeks** and are invisible to wearables. So the
headline TSB systematically *under-counts* lingering structural fatigue after descent-heavy blocks.

**Change.** Give the neuromuscular channel a **slower acute τ** and expose form **per channel**.
- `NEURO_ATL_DAYS = 14` (vs aerobic acute 7 d). Chronic τ stays 42 d for both.
- New persisted columns:
  - `tsb_aerobic = ctl_aerobic(42d) − atl_aerobic(7d)` — fast, HRV-visible freshness.
  - `tsb_neuromuscular = ctl_neuromuscular(42d) − atl_neuromuscular(14d)` — slow, structural freshness.
- **Combined `ctl/atl/tsb` are unchanged** (headline stays stable). The pair is additive insight.
- Surfaced: dashboard "Fraîcheur par système" (Aérobie = Alpine, Neuromusculaire = Summit, with a help
  note on the two recovery speeds); fed into the coach context + rule 4 ("a clearly negative
  `tsb_neuromuscular` = carry structural fatigue even when combined TSB, `tsb_aerobic` and Garmin look fresh").

**Files.** `ingest/massif_ingest/sync.py` ↔ `web/src/lib/rollup.ts` (τ + the two TSB columns) ·
migration `20260623000003_per_channel_tsb.sql` · `web/src/lib/data.ts` (`DailyMetric`) ·
coach mirrors `coach/src/context.ts` ↔ `web/src/lib/coach-context.ts` and
`coach/src/coach.ts` ↔ `web/src/lib/coach-briefing.ts` · UI `web/src/app/page.tsx`.

**Verification.** On the early-April Belledonne descent block, two weeks into recovery the **aerobic** TSB
had returned ~87 % toward fresh (−86.5 → −11.5) while the **neuromuscular** TSB had recovered only ~59 %
(−30.1 → −12.4) — a **crossover** where the structural channel becomes the more-fatigued one, exactly the
lingering fatigue the 7-day combined TSB hid. Test `test_neuromuscular_acute_decays_slower_than_aerobic`
locks the crossover invariant; pytest 38 green; web + coach tsc clean.

**Tunable.** `NEURO_ATL_DAYS = 14` (sync.py / rollup.ts) — population start; personalize from
soreness / RPE history later.

---

## Backlog (candidate upgrades, not yet built)

- **Calibrate load coefficients** to the athlete (`DESCENT_LOAD_PER_1000M`, `IMPACT_FRAC`, the strength
  split, `NEURO_ATL_DAYS`, `MULTIDAY_GAP_S`) from their own RPE / soreness / Garmin history. Today's
  clean CTL (~85) is already sane, so this is refinement, not a fix.
- **Relative interpretation bands** — express TSB/ACWR thresholds as percentiles of the athlete's own
  history rather than fixed TrainingPeaks values, so the bands transfer across athletes (multi-user).
- **Generic outlier guard** beyond multi-day — flag/cap single-activity load glitches (GPS/HR dropouts,
  Strava↔Garmin duplicates) for the multi-user rollout.
- **`/analyse` multi-day awareness** — the A-vs-B comparison still attributes a multi-day activity's full
  load to the period of its start day (the dashboard day-panel and the rollup already spread it).
