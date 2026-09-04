# Model upgrades — effort / fatigue / form

A running log of **innovations to the load → fatigue → form model**, layered on top of the baseline
described in [`ARCHITECTURE.md`](ARCHITECTURE.md) ("one global load, two channels"). Each entry records
the *problem*, the *change*, the *formula*, the *files touched* (Python source-of-truth + the TS mirrors),
how it was *verified*, and the *tunable* parameters it introduced.

**Why this file exists:** the baseline model is documented in ARCHITECTURE.md; this file tracks the
*deltas* so the innovation relative to a textbook Banister/TrainingPeaks PMC stays legible and auditable.

**Coach-facing rationale (no tech):** [`MODELE_ENTRAINEMENT.md`](MODELE_ENTRAINEMENT.md) explains the same
model from a physiology / sport-logic / coaching point of view — written to be reviewed and validated by a
real mountain coach (with an explicit "assumptions to validate" section). Keep it in sync conceptually.

**Ground rules carried by every upgrade**
- `load.py` is the source of truth. The TS mirrors (`web/src/lib/load.ts`, `web/src/lib/rollup.ts`,
  `web/src/lib/strava-sync.ts`) and the coach mirror (`coach/src/context.ts` ↔ `web/src/lib/coach-context.ts`)
  must stay behaviourally identical.
- **`load.py` ↔ `load.ts` parity is now ENFORCED, not asked for.** `tests/golden/load-parity.json`
  holds 141 `compute_load` cases (all six ladder methods) plus the shared pure helpers, with values
  computed by Python; `ingest/tests/test_load_parity.py` and `web/src/lib/load.parity.test.ts` replay
  the same file at 1e-9, on every push. **Every model change must regenerate it**
  (`ingest/.venv/bin/python ingest/scripts/gen_load_golden.py`) and commit the result with the change —
  the golden diff is the review of what the change actually moves. Forgetting is not silent: pytest
  fails immediately. Its first run found two real divergences, both in rounding (half-to-even vs
  half-up, and scale-then-round vs round-on-the-exact-value) — see `tests/golden/README.md`.
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
data-quality signal). Scoring was unchanged at the time; **Upgrade 6 later switched mostly-stopped
single-day outings to moving time** for the duration-driven methods (and a user RPE now clears that
branch). Mirror `load.py`↔`load.ts`; set on every write path
(ingest, recompute, RPE); migration `…0004`. Flags 12 real activities today (snowboard / surf / alpinism
stages / grande voie); the HR/IF rules are multi-user prophylaxis (0 hits now). Multi-day expeditions are
already handled (`effective_days > 1`) so they are not flagged.

---

## 2026-06-23 · Upgrade 4 — Heat & altitude (context + a narrow power/pace correction)

Full research write-up + sources: [`research/heat-altitude.md`](research/heat-altitude.md).

**Problem.** The model had no notion of **heat** or **hypoxic altitude** (distinct from D+/D-, which was
already the neuromuscular channel). The tempting fix — multiply load when it's hot or high — is **wrong**:
the dominant aerobic method is **hrTSS**, and HR already rises with heat/altitude, so an environmental
multiplier on HR-derived load **double-counts** the same strain. The genuine gaps are elsewhere.

**Change.** Three targeted moves, none of which multiplies HR-derived load:
1. **Altitude-adjusted power/pace — `tss` and `rtss` ONLY, never `hrtss`.** Power/pace are environment-blind,
   so they under-count an effort produced in thin air; HR is left untouched (it already reflects it).
2. **Effective-dated thresholds (`athlete_thresholds`).** Resolve thresholds as-of an activity's date, so a
   threshold change re-scores history faithfully and the model tracks the **non-stationary HR baseline** that
   heat/altitude acclimation creates (the right answer to acclimation, instead of a load multiplier).
3. **Heat/altitude as coach CONTEXT** (not load): per-activity `temp_c`/`alt_max_m`, an `environment` block
   (7-day exposure + Garmin/Firstbeat acclimation), surfaced so the coach reads a hot/high session as a
   **recovery/HR confounder** (don't misread a heat-driven HRV dip as overtraining) — rule 8 rewritten.

**Formula** (`load.py` ↔ `load.ts`, applied inside `_method_tss` / `_method_rtss`):
```
altitude_power_factor(avg_altitude_m, acclimatized=False):
    loss   = 0.065 · (avg_altitude_m − 800) / 1000        # 0 below the 800 m floor (Wehrlin&Hallén 6.3%/1000m)
    loss  *= (1 − 0.35)  if acclimatized                  # default unacclimatized = larger correction
    loss   = min(loss, 0.30)                              # cap (extreme altitude out of model range)
    return 1 / (1 − loss)                                 # ≥ 1.0; multiplies the tss/rtss intensity
intensity_tss  = (np_power / ftp)              · altitude_power_factor(avg_altitude_m)
intensity_rtss = (thr_pace / actual_pace)      · altitude_power_factor(avg_altitude_m)
# hrtss intensity is NEVER multiplied — locked by test_altitude_raises_power_and_pace_load_but_never_hr

resolve_profile(profile, athlete_thresholds, on_date):    # rec 2 — empty history ⇒ base profile unchanged
    row = latest threshold row with effective_date ≤ on_date; overlay its non-null THRESHOLD_FIELDS
```

**Files.** Python `ingest/massif_ingest/{load.py, strava.py, garmin.py, db.py, sync.py}` · TS mirrors
`web/src/lib/{load.ts, strava-sync.ts, coach-context.ts}`, `coach/src/{context.ts, db.ts}` · prompts
`coach/src/{coach.ts, ask.ts}`, `web/src/lib/{coach-briefing.ts, coach-chat.ts}` (rule 8) · migrations
`…0007_activity_environment.sql`, `…0008_daily_acclimation.sql`, `…0009_athlete_thresholds.sql`. New data:
`activities.{avg_temp_c, max_altitude_m, avg_altitude_m, time_high_altitude_s}` (Strava summary + altitude
stream), `daily_metrics.{heat_acclimation_pct, altitude_acclimation_m}` (Garmin MaxMET `get_max_metrics`).

**Verification.** pytest **44 green** (added: altitude factor gating/bounds, tss/rtss rise at altitude while
hrtss is unchanged, `resolve_profile` effective-dating + no-mutation, Garmin `_acclimation` defensive +
normalize); web + coach `tsc --noEmit` clean. Behaviour is **unchanged until data flows**: the altitude
factor is 1.0 below 800 m, and `resolve_profile` is a no-op with an empty `athlete_thresholds`. Reaches
history via `--recompute-loads` (recompute now reads `avg_altitude_m` + resolves thresholds per date).

**Tunable.** `VO2MAX_LOSS_PER_1000M = 0.065`, `ALT_ACCLIM_THRESHOLD_M = 800`, `ALT_ACCLIM_RECOVERY = 0.35`,
`ALT_CORRECTION_CAP = 0.30`, `ALT_HYPOXIA_THRESHOLD_M = 1500` (load.py / load.ts) — population starts; the
single-athlete history (paired Strava+Garmin + stored altitude streams) is ideal to personalize them later.

## 2026-06-23 · Upgrade 5 — Adaptive calibration (prio 3c: foundation + aerobic auto-fit)

**Principle.** The model must work with **zero athlete input** (population defaults) and **refine
automatically** as data accumulates — never require manual tuning.

**A — Foundation.** New `athlete_load_params` key-value table holds personalized overrides; `load.py`
(`_effective`) and the rollup resolve each calibratable coefficient to its fitted value **or the
population default** (`default_if`, `descent_load_per_1000m`, `ascent_aerobic_per_1000m`,
`neuro_atl_days`). Threaded through `compute_load(…, params)` and mirrored in `load.ts` / `rollup.ts` /
`strava-sync.ts`; loaded by `db.load_load_params()`. **Zero behaviour change until a row is fitted.**

**C-aéro — Aerobic auto-fit (`calibrate.py`).** Runs in the nightly (`calibrate_all()`): re-fits cheaply
every run and only re-scores history when a coefficient actually moves; `--calibrate` forces it.
The one safe aerobic target is `DEFAULT_IF` (the *no-HR* effort assumption) — and the honest finding,
verified on data, is that it must be fit from the **easy end** (20th pct) of the athlete's intensity
distribution and **only ever lowered**, never raised: the HR sessions skew harder than the no-HR
activities (surf/snowboard) it's used for, so a median fit (0.76) over-states them. For this athlete the
fit doesn't qualify (easy IF already > 0.55) → it self-cleans to the default. The aerobic channel is
already personalized via the FC thresholds, so this surface is intentionally thin; **the real
calibration payoff is the neuromuscular channel**, which activates once the optional soreness log fills.

**B — Soreness collection (optional).** `daily_metrics.soreness` (1–5, migration `…0006`) is the missing
neuromuscular ground-truth (wearables are blind to it), with a non-blocking "Jambes ce matin ?" dashboard
input (`SorenessInput` → `setSoreness` server action, neutral stone — a self-report, not a verdict). The
neuromuscular fits (`descent_load_per_1000m`, `neuro_atl_days`) join `calibrate_all()` once it accumulates.

**Files.** `ingest/massif_ingest/{calibrate.py (new), load.py, sync.py, db.py, strava.py}` · mirrors
`web/src/lib/{load.ts, rollup.ts, strava-sync.ts}` · migrations `…0005_athlete_load_params`,
`…0006_daily_soreness`. **Verification.** pytest 44 green; web + coach tsc clean; live `--calibrate`
self-cleaned the stale fit and re-scored 395 activities back to the population default (GR20 2368, latest
CTL 84.8 / TSB −27.2 unchanged). **Tunable.** `MIN_IF_SAMPLES=30`, the p20 easy-end + only-lower guard.

## 2026-06-24 · Upgrade 6 — Mis-categorised mountain days: reclassification + mostly-stopped scoring

**Problem.** Strava offers no "alpinism" / "grande voie" type, so the athlete logs them as **Rando**
(`hiking`). Scored as a hike on ELAPSED time, the long belays / approach / transitions inflate the aerobic
load — and trip `needs_review` (Upgrade 3d) without an actionable fix. Root cause: **wrong category**, not
the model — `alpinism`/`rock_climbing`/`via_ferrata` are `needs_manual_rpe` (meant to be RPE-scored), and
the elapsed-time hike estimate is the wrong instrument for a stop-heavy technical day.

**A — Mostly-stopped → moving time (narrow scoring change).** `load._scored_duration` now returns MOVING
time for a single-day outing that was mostly stopped (the same `needs_review` stop-ratio: `moving/elapsed
< 0.5`, ≥ 1 h), extending the multi-day rule. Applied ONLY to the duration-driven no-HR methods
(`vertical_duration`, `session_rpe`, `duration_fallback`); `hrtss`/`tss`/`rtss` KEEP elapsed because their
intensity (HR/power averaged over the elapsed window) already reflects the stops — shortening the duration
too would double-correct downward. A **user RPE clears the stop-ratio flag** (`needs_review` skips it when
`rpe_source='user'` — the athlete vouched for the effort). Mirror `load.py`↔`load.ts`.

**B — `grande_voie` sport + the `mountain_technical` group.** A grande voie loads BOTH systems — the
aerobic engine of a long mountain day (+ approach/D+) AND a technical forearm/core neuromuscular cost. New
sport `grande_voie` (ladder `vertical_duration → session_rpe → duration_fallback`, no hrtss,
`needs_manual_rpe`) in a new ADDITIVE taxonomy group `mountain_technical` with `IMPACT_FRAC=0.40` — so it
keeps the independent eccentric-descent term (unlike `technical_strength` 15/85, which would erase both the
long aerobic day and the walk-off descent). The CHECK on `sports.taxonomy_group` was widened (migration
`…0006`).

**C — Detection + validated reclassification (UI).** A conservative keyword detector
(`web/src/lib/sport-suggest.ts`) proposes a likely re-category on `hiking`/`walking`/`unknown` activities
(e.g. "grande voie" / "alpi" / "via ferrata" in the title) → surfaced in the now-clickable ⚠ badge
(`activity-flag.tsx`, replacing the hover-only tooltip; tappable on mobile, to the right of the type). One
tap reclassifies via `reassignActivitySport`, which **recomputes the load with the new ladder** (single
owner `applySportReassignment`, also adopted by the accepted-coach-proposal path — fixing a latent
staleness bug where that path changed the sport without recomputing). Never auto-applied; the athlete
validates.

**Files.** `ingest/massif_ingest/{load.py, db.py, strava.py}` · mirror `web/src/lib/load.ts` ·
`web/src/lib/{sport-suggest.ts (new), data.ts, labels.ts, strava-sync.ts}` · `web/src/app/actions.ts` ·
`web/src/components/{activity-flag.tsx (new), activity-row.tsx}` · `web/src/app/seance/[id]/page.tsx` ·
migration `…0006_add_grande_voie_sport`. **Verification.** pytest 53 green (new: mostly-stopped→moving,
hrtss-keeps-elapsed, user-RPE-clears-flag, grande_voie additive split, grande-voie keyword); web + coach
tsc clean. Reaches history via `--recompute-loads`.

## 2026-06-25 · Upgrade 7 — Descent trainability (repeated-bout) + trained-base re-baseline

Research + sources: [`research/descent-neuromuscular-rpe.md`](research/descent-neuromuscular-rpe.md) part A;
coach-facing `MODELE_ENTRAINEMENT.md` §2.3 + §11 Q2. **(Also shipped this day: RPE Phase 1 — CR10 anchors +
validated wording + `rpe_recorded_at`; see the backlog RPE entry, Phase 1 done.)**

**Problem.** `DESCENT_LOAD_PER_1000M = 70` was a **fixed, naive** eccentric cost. The downhill-running
literature shows the cost is **trainable** (repeated-bout effect): a regularly-exposed athlete takes
~20–30 % less damage for the same D− and recovers ~1–2 d faster. A fixed naive coefficient therefore
over-counts a trained descender's neuromuscular load.

**Dry-run finding (the design driver).** A read-only dry-run on the real 399-activity history
(`ingest/scripts/dry_run_descent.py`, reusing `compute_load` + the rollup EWMA) showed a **dynamic
exposure factor alone nets ≈ 0** for this athlete — and *should*: his biggest descents fall at de-adapted
season-starts, which the factor *correctly* penalises (+25 %), offsetting mid-block discounts. So the
**−20–30 % trained-vs-naive** is an **absolute** effect → it belongs in the **base coefficient**; the
factor is the **risk-timing** modulator around it. Anchor/swing sweeps confirmed no tuning makes the
dynamic factor a standing discount without under-counting the genuinely damaging de-adapted descents.

**Change (two moves).**
1. **Trained base re-baseline:** `DESCENT_LOAD_PER_1000M 70 → 55` (≈0.78× naive; lit. trained force-loss
   ≈ −16 % vs naive −24 %). Reversible; the soreness fit (below) refines it from real soreness later.
2. **Dynamic repeated-bout factor**, applied as-of each activity's date, anchored at the athlete's
   **median** exposure (trained base applies at typical training; climbs toward the naive ~70 when
   de-adapted, dips in a heavy block):
```
familiarity_ratio(date) = trailing-28d D-  /  p50 of trailing-28d D- over descent-active dates
descent_factor          = 1 − SWING·(ratio−1)/(ratio+1)        # bounded [1-SWING,1+SWING]=[0.75,1.25], saturating
descent_per_1000m_eff   = DESCENT_LOAD_PER_1000M × descent_factor
# gate: < MIN_SAMPLES=12 descent-active dates → no factor (inert), flagged low-confidence (no false precision)
```
   Built from the activities' raw `vertical_loss_m` (no circularity with the load).

**Reliability ALERT.** `descent_model_confidence()` → `off` (<12 dates, factor inert) / `low` (12–24, noisy
percentile baseline) / `ok` (≥24), so a still-firming estimate is surfaced rather than presented as fact.

**Files.** `ingest/massif_ingest/load.py` (`descent_factor`, `descent_familiarity_ratios`, `_percentile`,
`descent_model_confidence`, base 55, applied in `_descent_load`) ↔ mirror `web/src/lib/load.ts`. Wired into
all scoring paths for parity: `sync.recompute_activity_loads`, `strava.sync` (+ `_build_activity_row`
`fam_ratios`), `web/src/lib/strava-sync.ts`, and the RPE write `web/src/app/actions.ts` (`setRpe`). New
dry-run tool `ingest/scripts/dry_run_descent.py`. **No migration** (factor baked into `neuromuscular_load`).

**Verification (2026-06-25).** `--recompute-loads` re-scored **399** activities (rollup 1764 days). Base
re-baseline ≈ **−5.6 %** total neuromuscular load (the trained discount); dynamic factor ≈ **+0.5 %** net
(risk-timing: de-adapted descents up to +25 %, heavy-block to ~−7 %). pytest **62 green**; web `tsc` clean.
The descent coefficient calibrates load *magnitude* (activity cards, `CTL_neuro`), barely the readiness
verdict — `TSB_neuro` is a difference of two EWMAs that scale together.

**Tunables.** `DESCENT_LOAD_PER_1000M=55`, `DESCENT_FAMILIARITY_{WINDOW_D=28, SWING=0.25, ANCHOR_PCT=50,
MIN_SAMPLES=12}` (load.py ↔ load.ts). Population starts; the soreness fit refines the base later.

**Phase 2 (recovery τ) — shipped same day.** The repeated-bout effect also speeds *recovery* (trained
≈ 72 h vs naive ≥ 96 h), so the neuromuscular **acute τ** is now **non-stationary**:
`neuro_atl_days_eff = NEURO_ATL_DAYS × descent_recovery_factor(ratio)`, `factor = 1 − 0.18·(r−1)/(r+1)`
∈ [0.82, 1.18] → τ ≈ **11.5–16.5 d** (adapted clears faster, de-adapted lingers). Reuses the **same**
familiarity ratios as the cost (coherent), computed per *spine* day (rest days included), feeding a
variable-τ EWMA (`ewma_variable_tau` ↔ `ewmaVariableTau`) for `atl_neuromuscular` **only** — the neuro
**CTL keeps the 42 d chronic τ**, so this is the piece that actually moves `tsb_neuromuscular` (Phase 1
scaled CTL+ATL together → barely moved it). Files: `load.py` (`descent_recovery_factor`, `ewma_variable_tau`,
`DESCENT_RECOVERY_SWING=0.18`) ↔ `load.ts`; rollup `sync.py` ↔ `web/src/lib/rollup.ts`. **No migration**
(recomputed in the rollup). Dry-run `ingest/scripts/dry_run_descent_tau.py`. **Verified:** rollup re-run →
latest `tsb_neuromuscular` −4.76 → **−4.54** (small now — athlete at typical exposure; the lever bites on
season-transition days), combined CTL/ATL/TSB unchanged. pytest **65 green**; web `tsc` clean. Inert below
the `MIN_SAMPLES` gate.

## 2026-06-25 · Upgrade 8 — RPE: user-RPE wins the ladder + differential channel split

Research + sources: [`research/descent-neuromuscular-rpe.md`](research/descent-neuromuscular-rpe.md) part B;
coach-facing `MODELE_ENTRAINEMENT.md` §2.2 + §11 Q5. (Phase 1 — Foster CR10 anchors + global-session wording
+ 20–30 min nudge + `rpe_recorded_at`, migration `…0004` — shipped earlier the same day.)

**Bug fixed.** For alpinism/via_ferrata/grande_voie the ladder is `[vertical_duration, session_rpe, …]`;
`vertical_duration` always has inputs, so it won `compute_load` and a **user-entered RPE was silently
ignored** on recompute/sync (only `setRpe` honoured it → divergence). Live cases: a grande_voie rated
**RPE 10 scored 38**, an alpi rated **RPE 3 scored 182**. **Fix:** when `rpe_source=='user'` + `perceived_rpe`
set + `session_rpe` in the ladder, `session_rpe` is moved to the front (the athlete's direct effort report
supersedes the objective duration estimate; HR/power methods are never in these ladders, and auto-RPE does
not trigger it). Re-scores ~5 historical user-RPE mountain days toward their RPE (all old → current model
barely moves).

**Differential RPE.** Optional CR10 sub-scores `rpe_cardio` (souffle → aerobic), `rpe_legs`, `rpe_grip`
(→ neuromuscular). When **≥2** are present (>0), an RPE-scored session's aero/neuro SPLIT is perception-derived
instead of the fixed `CHANNEL_SPLIT` / `IMPACT_FRAC`:
```
points    = hours·(perceived_rpe/10)²·100            # global magnitude unchanged (validated session-RPE)
neuro_rpe = min(10, √(legs² + grip²))                # quadrature: ≥max, <sum (credits a 2nd loaded system)
aero_frac = cardio² / (cardio² + neuro_rpe²)         # 0 if no cardio
structural    → aerobic = points·aero_frac, neuro = points·(1−aero_frac)              (total = points)
aerobic-engine→ aerobic = points·aero_frac, neuro = max(points·(1−aero_frac), impact+descent)  # descent FLOOR
```
The **objective descent term stays a floor** for aerobic-engine sports (a same-session RPE under-reports
delayed eccentric DOMS, so a big descent must still outscore a calm day — the model thesis). **Guard:** on
aerobic-engine sports the split needs an `rpe_cardio` score, else a blank cardio would zero the engine
(structural sports split on legs+grip alone — their aerobic ≈ 0). **Inert by default** (existing rows have
NULL sub-scores → byte-identical to pre-change, regression-locked).

**Files.** `ingest/massif_ingest/load.py` (`_differential_split`, user-RPE ladder reorder, the split branches)
↔ mirror `web/src/lib/load.ts` (`differentialSplit`, `sessionRpeLoad`, `computeLoad`). Carried through all
five scoring paths for parity: `db.fetch_activities_for_recompute` (select) + `db.load_user_differential_rpes`,
`strava.sync` (`_build_activity_row` `differential_rpe`), `web/src/lib/strava-sync.ts` (re-apply on pull),
`web/src/app/actions.ts` (`setRpe(id, rpe, {cardio,legs,grip})`). Surfaced to the coach (`coach-context.ts`
`rpe_diff`). UI: `web/src/components/rpe.tsx` "préciser par système" panel (cardio = Alpine, legs/grip =
Summit). **Migration `…0005`** adds `rpe_cardio/rpe_legs/rpe_grip smallint 0..10` (nullable, additive).

**Verification.** Adversarial multi-agent pass (parity load.py↔load.ts, partition invariant in all branches,
inertness, edge cases, migration) → clean. Dry-run: the 5 ladder-fix activities move toward their RPE
(alpi RPE 3: 182→57; grande_voie RPE 10: 38→75), all old → current CTL/TSB barely shifts. pytest **71 green**;
web `tsc` clean. **Operational gate:** the three columns are SELECTed unconditionally → push migrations
`…0004` + `…0005` (`supabase db push`, CLI only) **before** the code runs, then apply the ladder-fix re-score
with `--recompute-loads`. The `/seance` detail shows the sub-scores back (souffle = Alpine, jambes/prise =
Summit) and the `rpe.tsx` picker pre-fills + auto-expands them on re-edit (`data.ts` `ACTIVITY_COLS` + the
`Activity` type carry the 3 columns). **Backlog:** the coach-chat/proposal tool schemas still carry only the
global RPE (they read `perceived_rpe`, unaffected) — extend to differential if the coach should reason on it.

## 2026-07-06 · Upgrade 9 — Périodisation : phases + rampe de CTL + décharges (Q15/Q17)

**Problème.** Le plan 7 jours était une fenêtre glissante sans mémoire : après un gros bloc il ramenait
toujours vers la semaine « type » (maintenance), rien ne poussait une **surcharge progressive** vers
l'objectif, et rien ne cadençait les semaines de décharge. L'athlète (à juste titre) s'interrogeait :
« viser CTL > ATL, est-ce vraiment ce qui fait progresser ? » — non : la progression vit en TSB légèrement
négatif, la fraîcheur se réserve pour la course (MODELE §5.2, research/periodisation-phases-seances-cles.md).

**Modèle.** `phaseFromDaysTo(days_to)` (briefing-algo.ts, pur + testé) rétro-compte les phases depuis
l'objectif PRINCIPAL daté (rank 1) : **affûtage** ≤ 14 j (inchangé, exponentiel) · **pré-compétition**
S−3..S−5 (volume ×0.85, intensité maintenue) · **build** S−6..S−13 (mésocycles **2:1**) · **base** au-delà
(mésocycles **3:1**, 1 seule qualité générée/sem). Les mésocycles sont **ancrés sur la fin de phase** : la
dernière semaine de chaque bloc est une **décharge** (volume ×0.65, une qualité conservée) — on encaisse
avant d'intensifier. En semaine de **charge** (base/build), la **rampe de CTL** vise `+4 pts/sem`
(borne sourcée +3-5 aéro) en gonflant les jours **easy** générés uniquement (le volume est le levier ;
une séance de qualité reste une séance de qualité), borné ×1.35, dérivation EWMA :
```
ΔCTL_sem = (L_quotidien − CTL)·(1−e^(−7/42))  ⇒  L_quotidien = CTL + 6.51·ΔCTL_cible
cible hebdo = 7·(CTL + 6.51·4) ;  scale_easy = clamp((cible − reste_semaine)/Σeasy, 1, 1.35)
```
**Garde-fous** : les ancres (événements/sessions épinglées) ne sont jamais rescalées ; la readiness
(rouge/ambre, seuils TSB/ACWR par canal) reste le gate quotidien au-dessus de la phase ; **inerte sans
objectif daté** (phase "none" → comportement byte-identique, verrouillé par tests) ; l'affûtage de
n'importe quel objectif ≤ fenêtre prime sur la phase.

**Surfaces.** PhaseChip sous l'objectif principal du dashboard (« Phase build · S−8 · semaine 1/3 du bloc —
on charge », aide ⁉ pédagogique) ; `state_assessment` du briefing ouvre par la phase ; le chat reçoit
`training_phase` + une consigne (ne jamais pousser vers un TSB positif hors affûtage). **Pas de rampe
par canal encore** (le neuro reste protégé par les seuils tsb_neuro/ACWR-neuro quotidiens) — backlog.

**Vérification.** 6 nouveaux tests (bornes de phases, cadence 2:1/3:1 end-anchored, facteur décharge,
rampe bornée easy-only à qualité constante, base_hard_cap, texte briefing) ; 25/25 engine, zéro régression.

## 2026-07-06 · Upgrade 10 — Fenêtres de contrainte : la vraie vie re-cadre les phases

**Problème.** Les phases (Upgrade 9) sont ancrées sur la date de course — mais la vie réelle (déplacement
2 semaines à Bordeaux sans montagne, semaine chargée au boulot) doit pouvoir **reporter une décharge,
prolonger une charge, adapter le terrain**. Cas fondateur : « d'ici mercredi je veux *manger du D+*,
puis récupérer pendant le déplacement ».

**Modèle.** Table **`training_windows`** (migration `…20260706000001`, appliquée) : période datée +
`label` + intention `effect` (`auto`/`deload`/`maintain`/`charge`) + drapeaux de capacité
(`no_mountains`, `limited_hills`, `reduced_volume`). `effect=auto` → décharge si capacité réduite sur
≥ 5 j, sinon entretien (`resolveWindowEffect`). Trois règles dans le moteur (briefing-algo.ts, pur + testé) :
1. **Décharge reportée** (`effectivePhase`) : une fenêtre décharge qui démarre d'ici ≤ 21 j ABSORBE la
   décharge calendaire (on charge avant, on encaisse pendant) ; une décharge calendaire ≤ 7 j après la
   fin d'une fenêtre décharge est aussi supprimée (déjà encaissé).
2. **Biais D+ avant** : les qualités générées avant une fenêtre terrain-plat qui démarre dans la semaine
   deviennent `hard_neuromuscular` (on front-charge la qualité qui sera indisponible).
3. **Adaptation pendant** : modulation PAR JOUR (une semaine coupée en deux se module jour par jour) —
   décharge ×0.65 / entretien ×0.85, une seule qualité max (aérobie), jamais de côtes/force générées sur
   terrain plat (qualité → seuil, sport → running), la rampe ne regonfle jamais un jour en fenêtre.
   Les ancres (événements déclarés / sessions épinglées) ne sont JAMAIS modifiées ; la readiness reste au-dessus.

**Surfaces.** Agenda : bouton « + Contrainte » (modale label/dates/effet/drapeaux), jours couverts en
fond grisé sobre (+ légende), fiche du jour = contrainte modifiable/supprimable, **marqueur de phase en
début de semaine uniquement** (`phaseMarkFr` : « build · S−8 · charge 1/3 », « Déplacement Bordeaux ·
on encaisse »). Dashboard : le PhaseChip passe à la **phase effective** (« décharge reportée sur … »).
Chat : `training_windows` dans le contexte (web + mirror coach/) + consigne (inviter à déclarer une
contrainte évoquée en chat mais absente). Briefing : le `state_assessment` nomme la fenêtre / le report.

**Vérification.** 5 nouveaux tests engine (effet auto, report de décharge + sanity sans fenêtre, biais
D+ avant/seuil-plat pendant/une qualité max/×0.65, libellés, rampe hors-fenêtre seulement) ; 30/30,
zéro régression ; build + lint 0 erreur ; coach tsc clean. **Backlog** : proposition de fenêtre PAR le
coach depuis le chat (tool propose_window), phase transition post-objectif, rampe neuro par canal.

## Backlog (candidate upgrades, not yet built)

- **Neuromuscular calibration** (the 3c payoff) — once the soreness log has data, fit
  `DESCENT_LOAD_PER_1000M` / `NEURO_ATL_DAYS` so modelled neuromuscular load predicts next-day soreness;
  add the fitters to `calibrate_all()`. Needs ~2-3 weeks of optional soreness entries. *(Complementary to
  the descent-trainability upgrade above: that one modulates by recent D− exposure; this one fits the
  baseline level from soreness ground-truth.)*
- **Per-sport "moving vs elapsed" scoring** — _resolved in Upgrade 6:_ mostly-stopped single-day outings
  now score the duration-driven methods on moving time (HR methods keep elapsed; a user RPE supersedes).
  Remaining calibration nuance (how effortful belay time is per sport) folds into the 3c neuromuscular fit.
- **Per-day-load chart band scaling** — the dashboard TSB *bar chart* still draws fixed −30/0 reference
  lines; only the gauge bands are CTL-relative (3b). Low priority (the chart is a trend view).
