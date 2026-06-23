# Heat & altitude in the load / fatigue / form model

**Status: implemented (2026-06-23).** This documents *why* heat and altitude enter Massif as **context and
a narrow power/pace correction — never as a multiplier on HR-derived load** — the evidence behind that call,
the exact data sources, and what is integrated. It is the research backing for Upgrade 4 in
[`MODEL_UPGRADES.md`](../MODEL_UPGRADES.md).

> Vocabulary trap: in this codebase "altitude" historically meant **elevation gain/loss (D+/D-)**, which is
> the *neuromuscular descent channel* and was already modelled. This doc is about the **other** two things:
> **heat** (ambient temperature / thermoregulatory strain) and **hypoxic altitude** (being high above sea
> level). Both were absent before this change.

---

## 1. The one thing to understand

Massif's dominant aerobic method is **hrTSS** (HR-driven). **Heart rate already integrates the acute strain
of heat and altitude**: at a fixed external effort, HR rises in the heat and in thin air. So an HR-based load
*already counts* that extra cost. **Adding an environmental multiplier on top of HR-derived load
double-counts** — and that is the single most common mistake in this space.

The genuine, residual problems are therefore **not** in the load magnitude (hrTSS handles it) but in three
narrower places, which is exactly what we built:

1. **Recovery interpretation (highest value).** Heat can depress next-morning HRV and raise resting HR
   *independently of training fatigue*. Since Massif gates hard days on the Garmin recovery composite as a
   *clean* fatigue signal, a heat confounder on the **recovery** side is more damaging than on the load side.
   → surfaced as **context** so the coach doesn't misread a heat-driven recovery dip as overtraining.
2. **Environment-blind methods.** `tss` (power) and `rtss` (pace) read *external work* and are blind to the
   environment, so they under-count an effort produced in thin air. → the **only** load correction we apply:
   altitude-adjusted power/pace, **tss/rtss only, never hrtss**.
3. **Non-stationary HR baseline.** Heat/altitude acclimation shift FCmax / LTHR / resting HR by several bpm
   over days–weeks (and decay back). → addressed by **effective-dated thresholds** (`athlete_thresholds`),
   not by a load multiplier.

---

## 2. Evidence (verified against primary sources)

A Perplexity literature pass was adversarially fact-checked against primary sources. Headline findings held;
several **citations were wrong** and one **number was ~2× too high** — corrected here. Coefficients we adopt
are population starting points (like the rest of `load.py`), to be personalized later.

### Heat
- **Cardiovascular drift** is real and large but condition-dependent — *not* a universal "per-°C" slope. In
  endurance-trained cyclists at fixed submaximal power, HR rose **+11 % from 15→45 min at 35 °C vs +2 % at
  22 °C** (Lafrenz, Wingo, Ganio, Cureton 2008, *Med Sci Sports Exerc*, **PMID 18461000**). Direction matters:
  in heat HR overstates *absolute* metabolic work, but since VO₂max itself falls, the elevated HR still
  validly tracks *relative* strain — so for an internal-load metric, hrTSS-in-heat is appropriately higher.
- **Dehydration → HR.** ~**3–5 bpm per 1 % body-mass loss** (often ~3.3), **not** the 6–10 bpm Perplexity
  claimed (≈2× too high). Source is Montain & Coyle 1992, *J Appl Physiol* (**PMID 1447078**) — Perplexity
  mis-cited PMID 8157372 (a different 1994 paper).
- **Heat acclimation** is fast: HR ↓ and plasma volume ↑ within the first week; cardiovascular adaptations
  near-complete by ~day 6–10; 1–2 weeks for performance (Périard, Racinais, Sawka 2015, *Scand J Med Sci
  Sports*, DOI 10.1111/sms.12408; Racinais et al. 2015 consensus, **PMID 26002286**). **Decay** ~**2.3–2.6 %/
  day**, re-acclimation 8–12× faster (Daanen, Racinais, Périard 2018, *Sports Med*, **PMID 29129022**). The
  "~75 % in 4–7 days" figure Perplexity gave conflates induction with the ~75 %-*lost-by-3-weeks* decay stat.

### Altitude (hypoxia, *not* elevation gain)
- **VO₂max** falls ~**6.3 % per 1000 m** (individual range **4.6–7.5 %**) in unacclimatized trained athletes,
  detectable from ~800 m (Wehrlin & Hallén 2006, *Eur J Appl Physiol*, **PMID 16311764**).
- **HRmax** barely moves: ~**1.7 bpm per 1000 m** (~0.1 %/100 m — an order of magnitude *less* than VO₂max),
  roughly linear, larger in fitter athletes (Mourot 2018, *Front Physiol*, **PMID 30083108**). Perplexity
  mis-cited this to PMID 18461000 (the 2008 heat paper); the real source is Mourot 2018.
- Consequence: submax HR rises at altitude (≈+12 % at 2800 m), so hrTSS captures the strain; but using a
  sea-level HRmax/LTHR to set zones slightly mis-prescribes intensity — a **zone-calibration** problem
  (→ `athlete_thresholds`), not a load-multiplier argument.

### Load math & industry practice
- HR-based internal load (TRIMP/hrTSS) already embeds environmental strain by definition (Impellizzeri,
  Marcora, Coutts 2019, *IJSPP*) → an extra environmental multiplier double-counts.
- For **power**, an altitude correction is established: **Bassett et al. 1999** (*Med Sci Sports Exerc*,
  **PMID 10589872**) — the acclimatized/unacclimatized curves intervals.icu uses for "altitude-adjusted
  power", framed as *equivalent sea-level power*, **not** a TSS multiplier. **No validated heat-adjusted TSS
  model exists.**
- **TrainingPeaks / WKO5 / intervals.icu apply no default heat/altitude multiplier to TSS** — environment is
  left to manual coach adjustment or shown as a separate display metric.

### Garmin / Firstbeat
- "Heat & Altitude Performance Acclimation" is **not a load metric** — it tracks heat acclimation when temp
  **> 22 °C** and altitude acclimation when **> 800 m**, and *corrects* Garmin's VO₂max estimate / Training
  Status (heat feature is GPS-only + needs phone weather). Same philosophy we adopt: it's a correction/context
  layer, not load. (Verbatim from Garmin device manuals.)

---

## 3. What is integrated

### Data sources (raw → stored)
| Signal | Source | Column | Used for |
|---|---|---|---|
| Ambient temperature | Strava summary `average_temp` (device-reported, °C) | `activities.avg_temp_c` | coach heat context |
| Max altitude reached | Strava altitude **stream** (peak) | `activities.max_altitude_m` | coach hypoxia context |
| Mean altitude | Strava altitude **stream** (mean) | `activities.avg_altitude_m` | **tss/rtss altitude correction** |
| Hypoxia exposure dose | Strava altitude stream (time ≥ ~1500 m) | `activities.time_high_altitude_s` | coach context |
| Heat acclimation % | Garmin **MaxMET** `heatAltitudeAcclimation.heatAcclimationPercentage` | `daily_metrics.heat_acclimation_pct` | coach HR/recovery interpretation |
| Altitude acclimation (m) | Garmin **MaxMET** `…altitudeAcclimation` | `daily_metrics.altitude_acclimation_m` | coach HR/recovery interpretation |

A lot of this was *already in the store unused*: the altitude stream was kept only for D-, and `average_temp`
sat in `raw_payload`. The Garmin MaxMET endpoint (`get_max_metrics`) is newly wired in `garmin.fetch_day`.

### Load model (the only correction)
**Altitude-adjusted power/pace — `tss` and `rtss` only, never `hrtss`** (`load.altitude_power_factor`,
mirrored in `load.ts altitudePowerFactor`):
```
loss   = VO2MAX_LOSS_PER_1000M · (avg_altitude_m − 800) / 1000     # 0 below the 800 m floor
loss  *= (1 − ALT_ACCLIM_RECOVERY)  if acclimatized                # default: unacclimatized (larger correction)
loss   = min(loss, ALT_CORRECTION_CAP)
factor = 1 / (1 − loss)          # ≥ 1.0; multiplies the tss/rtss intensity
```
Coefficients (population starts, in `load.py`): `VO2MAX_LOSS_PER_1000M = 0.065`, `ALT_ACCLIM_THRESHOLD_M =
800`, `ALT_ACCLIM_RECOVERY = 0.35`, `ALT_CORRECTION_CAP = 0.30`, `ALT_HYPOXIA_THRESHOLD_M = 1500`. Impact is
small in practice (the athlete is mostly HR-driven and at low altitude) — this is a correctness corner, not a
headline change. **hrTSS is never altitude-corrected** (a test locks this).

### Effective-dated thresholds (`athlete_thresholds`)
`load.resolve_profile(profile, history, on_date)` overlays the latest `athlete_thresholds` row with
`effective_date ≤ activity date` onto the base `athlete_profile` (non-null `THRESHOLD_FIELDS` only). **Empty
table ⇒ the base profile unchanged — identical behaviour until a dated row exists.** Wired into every load
path: `strava._build_activity_row`, `sync.recompute_activity_loads`, and the TS `strava-sync.ts`. This makes
historical load reproducible after a threshold/FTP/weight change and lets the model track the non-stationary
HR baseline that acclimation creates.

### Coach context (not load)
`coach/src/context.ts` ↔ `web/src/lib/coach-context.ts` now expose an **`environment`** block (today's
acclimation + 7-day heat/altitude exposure) and per-activity `temp_c` / `alt_max_m`; `recovery_today` carries
the acclimation %. The briefing/chat/ask prompts (`coach.ts`, `coach-briefing.ts`, `coach-chat.ts`, `ask.ts`,
rule 8) instruct the coach to use heat/altitude to read **HR and recovery** — never to inflate load.

### Files touched
- **Python (source of truth):** `load.py` (constants, `altitude_power_factor`, `resolve_profile`, tss/rtss),
  `strava.py` (`altitude_stats`, temp + threshold resolution), `garmin.py` (`get_max_metrics` + `_acclimation`),
  `db.py` (`load_threshold_history`, recompute select), `sync.py` (recompute per-date resolution).
- **TS mirrors:** `web/src/lib/load.ts`, `web/src/lib/strava-sync.ts`, `web/src/lib/coach-context.ts`,
  `coach/src/context.ts`, `coach/src/db.ts`.
- **Prompts:** `coach/src/coach.ts`, `web/src/lib/coach-briefing.ts`, `web/src/lib/coach-chat.ts`,
  `coach/src/ask.ts`.
- **Migrations:** `20260623000007_activity_environment.sql`, `20260623000008_daily_acclimation.sql`,
  `20260623000009_athlete_thresholds.sql`.
- **Tests:** `ingest/tests/test_load.py` (altitude factor, hr-never-corrected, `resolve_profile`),
  `ingest/tests/test_garmin.py` (`_acclimation` defensive + normalize).

### Apply to history / cloud
- New columns/tables land via `supabase db push` (CLI only). They are additive; behaviour is unchanged until
  data flows.
- `avg_temp_c` / altitude stats backfill on the next Strava sync; acclimation on the next Garmin sync.
- The Bassett correction reaches history via `python -m massif_ingest.sync --recompute-loads` (recompute now
  reads `avg_altitude_m` + resolves thresholds per date), then the rollup.

---

## 4. Deliberately NOT done (and open questions)
- **No multiplier on HR-derived load.** By design — it would double-count (§1).
- **No heat term on the load.** No validated heat-adjusted TSS model exists, and the only available
  temperature is **dry-bulb** (`average_temp`), the wrong variable — heat strain is core-temp-driven
  (humidity/wind/radiation, i.e. WBGT). A naive dry-temp term would mis-rank exactly the trail/mountain
  sessions Massif centres on. Heat stays **context only**.
- **No neuromuscular-channel environment term.** Evidence that heat/hypoxia amplify eccentric/structural cost
  is thin; left as an open question rather than a coefficient.
- **Altitude correction defaults to *unacclimatized*** — the `acclimatized` path exists in
  `altitude_power_factor` but isn't auto-fed from `altitude_acclimation_m` yet (future refinement).
- **`time_high_altitude_s` is approximate** (fraction-of-samples × duration), good enough for context.
- **Personalization** of every coefficient/slope from this athlete's own paired Strava+Garmin history is the
  natural next step (folds into the prio-3c calibration backlog in `MODEL_UPGRADES.md`).

## Key sources
- Lafrenz/Wingo/Ganio/Cureton 2008, *MSSE* — PMID 18461000 (heat CV drift)
- Montain & Coyle 1992, *J Appl Physiol* — PMID 1447078 (dehydration → HR)
- Périard/Racinais/Sawka 2015, *Scand J Med Sci Sports* — DOI 10.1111/sms.12408 (heat acclimation)
- Racinais et al. 2015 consensus — PMID 26002286
- Daanen/Racinais/Périard 2018, *Sports Med* — PMID 29129022 (acclimation decay)
- Wehrlin & Hallén 2006, *Eur J Appl Physiol* — PMID 16311764 (altitude VO₂max)
- Mourot 2018, *Front Physiol* — PMID 30083108 (altitude HRmax)
- Bassett et al. 1999, *MSSE* — PMID 10589872 (altitude-adjusted power)
- Impellizzeri/Marcora/Coutts 2019, *IJSPP* (internal vs external load)
- Garmin device manuals — Heat & Altitude Performance Acclimation (22 °C / 800 m thresholds)
