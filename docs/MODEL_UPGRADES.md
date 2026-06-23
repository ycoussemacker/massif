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

## 2026-06-23 · Upgrade 3 — Interpretation & hygiene (prio-3 backlog)

Three smaller refinements layered on Upgrades 1–2:

**3a — `/analyse` multi-day awareness.** The A-vs-B comparison aggregated activities by their START date,
so a multi-day expedition dumped its whole load into one period while the CTL/ATL/TSB KPIs (from the
spread `daily_metrics`) disagreed. The per-day spread is now a shared `aggregate.spreadActivities()`
(`groupByDateSpanned` builds on it); `/analyse` routes every activity-based aggregation (totals, per-sport,
channel, cumulative, B-series) through it, clipped to each period, with the fetch widened 31 d so an
expedition starting just before a period still attributes its in-period days.

**3b — Form (TSB) bands relative to CTL.** The dashboard "TSB · forme" gauge judged form against fixed
TrainingPeaks points (−30/−10/+8). Those don't transfer across load levels (the original "+100 looks
huge" confusion). Bands now scale with the athlete's own CTL — **lo −30 % · mid −10 % · hi +10 % of CTL**
(absolute fallback when CTL is unknown) — so the same TSB is judged relative to how trained you are.
**ACWR stays absolute** (it's already a normalized ratio; its 0.8–1.3 sweet spot is scale-independent).
`web/src/app/page.tsx` (`tsbBandBounds`/`tsbZones`), help text in `charts-section.tsx`.

**3d — `needs_review` outlier guard (flag-only).** A persisted boolean flag — never a silent cap — set by
`load.needs_review()` when a load rests on a suspect input: an HR-sensor glitch (`avg_hr > max_hr`), an
implausible intensity factor (> 1.5), or a single-day outing scored on elapsed time that was mostly spent
stopped (`moving/elapsed < 0.5`, ≥ 1 h elapsed — forgotten pause / lift laps / long belays → load
overstated). Surfaced as a neutral "⚠ à vérifier" chip (deliberately NOT the readiness palette — it's a
data-quality signal). Scoring is **unchanged** (whether a mostly-stopped outing should switch to moving
time is the per-sport calibration question below). Mirror `load.py`↔`load.ts`; set on every write path
(ingest, recompute, RPE); migration `…0004`. Flags 12 real activities today (snowboard / surf / alpinism
stages / grande voie); the HR/IF rules are multi-user prophylaxis (0 hits now). Multi-day expeditions are
already handled (`effective_days > 1`) so they are not flagged.

## Backlog (candidate upgrades, not yet built)

- **Calibrate load coefficients** to the athlete (prio 3c — being planned) — fit `DESCENT_LOAD_PER_1000M`,
  `IMPACT_FRAC`, the strength split, `NEURO_ATL_DAYS`, `MULTIDAY_GAP_S` to their own RPE / soreness /
  Garmin history. Today's clean CTL (~85) is already sane, so this is refinement, not a fix; it needs a
  ground-truth signal decided first (sparse manual RPE vs Garmin training-load vs soreness).
- **Per-sport "moving vs elapsed" scoring** — the 12 `needs_review` single-day outings (surf / snowboard /
  alpinism) are scored on elapsed time incl. large stops. Whether to switch them to moving time is
  sport-dependent (alpine belay time can be effortful) — fold into the 3c calibration rather than a blunt switch.
- **Per-day-load chart band scaling** — the dashboard TSB *bar chart* still draws fixed −30/0 reference
  lines; only the gauge bands are CTL-relative (3b). Low priority (the chart is a trend view).
