# Research — Descent neuromuscular cost (trainability) & RPE capture

> **Status: literature review → gap analysis → model deltas. ALL SHIPPED 2026-06-25. Part A (descent):
> cost re-baseline + repeated-bout factor + exposure-dependent recovery τ (§A.4 + MODEL_UPGRADES Upgrade 7).
> Part B (RPE): Phase 1 (CR10 anchors + wording + timing) + Phase 2 (user-RPE-wins-ladder fix + differential
> RPE → perception-derived channel split) (§B.4 + MODEL_UPGRADES Upgrade 8). Pending only: the operational
> migration push (`…0004`, `…0005`) + the ladder-fix `--recompute-loads`.**
> Two questions raised in [`MODELE_ENTRAINEMENT.md`](../MODELE_ENTRAINEMENT.md) §11 (**Q2** descent
> trainability, **Q5** RPE) were researched (Perplexity, June 2026, sources below). This doc records what
> the literature says, **measures the gap** against what Massif does today, and the **bounded, phased**
> model changes that followed. Shipped upgrades are logged in
> [`MODEL_UPGRADES.md`](../MODEL_UPGRADES.md); the coach-facing rationale lives in
> [`MODELE_ENTRAINEMENT.md`](../MODELE_ENTRAINEMENT.md). Same pattern as
> [`heat-altitude.md`](heat-altitude.md): research first, then a narrow, defensible delta.
>
> **On citations.** The sources below back the *new* model directions. The pre-existing coefficients
> (`DESCENT_LOAD_PER_1000M`, `IF²` anchoring, the 7 d / 14 d τ, etc.) were population starting points
> adopted without inline sourcing — back-filling their references is a separate, later project step.

---

## Part A — The neuromuscular cost of descent is **trainable** (Q2, coupled to Q6)

### A.1 What the literature says

1. **Repeated-bout effect (RBE) is well established.** A first eccentric bout protects against a later
   similar bout (peripheral adaptations + neural/mechanical/cellular components). A single prior session
   already yields measurable protection; a second stimulus 1–2 weeks later shows **less CK, less soreness,
   less force loss**. *(RBE review — PMID 12641640.)*

2. **The adaptation is descent-specific and quick.** 1–2 weeks of small downhill volume markedly reduces
   post-test soreness, whereas *uphill* training protects little — the stimulus must be the eccentric
   braking of descent. Adaptation does not require many sessions; it depends on **volume, temporal
   proximity, and mechanical similarity**. *(PMID 3431375; downhill-running review — Giandolini thesis,
   jbmorin.net.)* Prior eccentric training reduces CK, soreness and force loss and **speeds return to
   baseline**. *(PMID 8887208.)*

3. **Beginner vs trained (same stimulus).** Immediately after a descent, isometric force loss averages
   **≈ −23.5 % (untrained)** vs **≈ −16.4 % (trained)**. Force recovery returns by **≈ 72 h in trained**
   but is **not yet complete at 96 h in untrained**. CK is a poor discriminant (peaks ≈ +346 % untrained
   vs +370 % trained — highly variable). DOMS peaks at **24–48 h**, similar magnitude between groups
   (≈ 49 vs 54 mm VAS). *(Downhill-running review, Giandolini thesis.)*

4. **Recovery speed.** Force loss typically lasts **4–5 days**; trained subjects recover **≈ 1–2 days
   faster** (≈ 72 h vs ≥ 96 h). No universal time constant, but recovery is **shortened by repeated
   exposure to the same descent type**, especially in the preceding days/weeks. *(Giandolini thesis;
   PMID 17373600.)*

5. **Load factors that modulate damage:** **slope, speed, duration → total descent exposure** (more
   braking, ground-reaction and impact). Carried mass increases absolute strain, but **no solid
   quantitative relation exists for trail-with-pack** in the retrieved sources. Fibre type, eccentric
   training history, descent familiarity and prior fatigue all modulate the response (large
   inter-individual variability). *(Giandolini thesis; PMID 12641640.)*

6. **No clean universal law.** Quantitative data are *averages of protocols*, not an individualized
   predictive model — RBE protection is dose-dependent but there is **no simple "x % less damage per y m
   of D−"**. One can model **trends**, not a single robust law. *(PMID 12641640.)*

7. **Recommendation (literal).** Do **not** keep a strictly fixed coefficient if the goal is physiological
   realism. Make **both** the load coefficient **and** the recovery τ depend on a **proxy of recent
   eccentric exposure** (cumulative D− over the **last 2–6 weeks**), with a **bounded, saturating** law
   (diminishing returns after a few exposures), e.g. `cost = base × f(exposure)` and
   `τ_recovery = τ_base / g(exposure)`, `f`,`g` bounded ≈ **0.7–1.3**, then calibrated on field data.
   Keep the fixed coefficient **only as the default** for athletes with no usable history. *(PMIDs 8887208,
   3431375, 12641640, 17373600.)*

### A.2 What Massif does today

- **Cost coefficient.** `_descent_load = (D⁻/1000) × DESCENT_LOAD_PER_1000M × mass_factor`, with
  `DESCENT_LOAD_PER_1000M = 70.0` — **fixed**. `athlete_load_params.descent_load_per_1000m` can override it,
  but only as a **single global fitted value** (the soreness-driven fit is backlog, not active), never
  modulated by *recent* exposure. *(`ingest/massif_ingest/load.py`.)*
- **Recovery τ.** `NEURO_ATL_DAYS = 14` — a **fixed**, rollup-wide acute time constant for the
  neuromuscular EWMA (`atl_neuromuscular`). Globally calibratable (backlog), **not** exposure-dependent.
  *(`ingest/massif_ingest/sync.py` ↔ `web/src/lib/rollup.ts`.)*
- **Mass scaling** is present (`_mass_factor`). **Slope/speed of descent are NOT used** (only total D−).

### A.3 Gap (and its magnitude)

| Axis | Literature | Massif today | Gap |
|---|---|---|---|
| Cost vs recent exposure | trained ≈ **−20–30 %** damage for same D− | **fixed** 70/1000 m | **Over-counts** the neuro cost of a descent for a regularly-exposed athlete by ~20–30 % |
| Recovery τ vs exposure | trained recover **1–2 d faster** (≈ 72 h vs ≥ 96 h) | **fixed** τ = 14 d | **Over-states** lingering neuro fatigue (`tsb_neuromuscular`) for a trained descender → readiness skews conservative |
| Saturating/bounded law | yes (diminishing returns; f,g ∈ ~0.7–1.3) | none | n/a (not modelled) |
| Slope/speed of descent | modulate damage | only total D− | minor (we lack reliable descent-segment grade/speed) — **low priority** |
| Default for no-history athlete | keep fixed | fixed | ✅ already correct — keep as the floor |

**Why it matters for this athlete.** A regular mountain user accumulates a lot of trailing D−. The model
currently charges the *naive* damage dose (70/1000 m) and recovers it over the *naive* 14 d for every
descent — so a descent-heavy block reads as more neuromuscular fatigue, lingering longer, than is
physiologically true for someone adapted to descent. That directly inflates `atl_neuromuscular` /
deflates `tsb_neuromuscular`, which feeds the readiness verdict and the "no two hard same-system days"
planning rule.

### A.4 What shipped (Phase 1) — and the dry-run finding that shaped it

A read-only **dry-run on the real 399-activity history** (`ingest/scripts/dry_run_descent.py`, reusing the
source-of-truth `compute_load` + rollup EWMA) drove a design that differs from the first sketch. The key
empirical finding:

> **A dynamic exposure factor cannot, by itself, produce a standing "trained discount" for this athlete —
> and it shouldn't.** Anchoring `f = 1.0` at the athlete's own *median* gave a net effect of ≈ **0 %**;
> sweeping the anchor (p50→p15) or widening the swing only pushed the net slightly *up* (+0.5 → +0.8 %).
> Reason: the athlete's *biggest* descents happen at **de-adapted season-starts** (winter→spring ski-touring,
> 1000–2500 m D−), which the factor *correctly* penalises (+25 % — the real "first descent of the season
> destroys your quads" DOMS), and those outweigh the mid-block discounts. Making the net negative would
> require capping that penalty — i.e. **under-counting the genuinely most-damaging sessions**.

So the literature's **−20–30 % trained-vs-naive** is an **absolute** effect → it belongs in the **base
coefficient**, while the **dynamic factor** is the correct **risk-timing** modulator (net ≈ 0) around it.
Two moves, both shipped:

1. **Base re-baselined to the TRAINED cost.** `DESCENT_LOAD_PER_1000M 70 → 55` (≈0.78 × the original naive
   value; lit. trained force-loss ≈ −16 % vs naive −24 % → ratio ≈ 0.70–0.78). This is the standing
   discount. Reversible; the soreness fit (Upgrade 5 backlog) refines it from real next-day soreness later.
2. **Dynamic repeated-bout factor**, applied as-of each activity's date, anchored at the athlete's
   **median** (typical) exposure so the trained base applies at typical training and climbs back toward the
   naive ~70 when de-adapted:
   ```
   familiarity_ratio(date) = trailing-28d D-  /  p50 of trailing-28d D- over descent-active dates
   descent_factor = 1 − 0.25 · (ratio − 1)/(ratio + 1)   →   bounded [0.75, 1.25], saturating
   descent_per_1000m_eff = DESCENT_LOAD_PER_1000M(=55) × descent_factor
   ```
   Built from the activities' raw `vertical_loss_m` (no circularity with the load), in all three scoring
   paths for parity (`load.py` ↔ `load.ts`; wired in `sync.recompute_activity_loads`, `strava.sync`,
   `strava-sync.ts`, and the RPE write `actions.setRpe`).

**Reliability ALERT (the "imprecise/unreliable" guard).** The factor is **gated** to ≥ `MIN_SAMPLES = 12`
descent-active dates — below it the model has too little history to judge familiarity, so it stays inert
(`descent_factor = 1.0`, no false precision). `descent_model_confidence()` reports `off` (< 12), `low`
(12–24, percentile baseline still noisy) or `ok` (≥ 24), surfaced so the coach can flag a still-firming
estimate instead of presenting a shaky number as fact. (For this athlete: 351 descent-active dates → `ok`.)

**Verified (2026-06-25):** `--recompute-loads` re-scored 399 activities; the base re-baseline cut total
neuromuscular load ≈ **−5.6 %** (the trained discount), the dynamic factor adds ≈ **+0.5 %** net (risk-timing:
de-adapted descents up to +25 %, heavy-block ones to ~−7 %). pytest 62 green; web `tsc` clean.

**Phase 2 — recovery τ (SHIPPED 2026-06-25).** The repeated-bout effect also speeds *recovery* (trained
≈ 72 h vs naive ≥ 96 h), so the neuromuscular **acute τ** is now **non-stationary**: a per-day
`neuro_atl_days_eff = NEURO_ATL_DAYS × descent_recovery_factor(familiarity_ratio)`,
`factor = 1 − 0.18·(r−1)/(r+1)` bounded **[0.82, 1.18]** → τ ≈ **11.5–16.5 d** (adapted clears faster,
de-adapted lingers). It reuses the **same** familiarity ratios as the cost (coherent), computed per *spine*
day (rest days included), and feeds a variable-τ EWMA (`ewma_variable_tau` ↔ `ewmaVariableTau`) for
`atl_neuromuscular` **only** — the neuro **CTL keeps the fixed 42 d chronic τ**, so this moves
`tsb_neuromuscular` (unlike Phase 1, which scaled CTL and ATL together). `load.py` ↔ `load.ts`; rollup
`sync.py` ↔ `rollup.ts`. **Verified:** latest `tsb_neuromuscular` −4.76 → **−4.54** (the athlete is at
typical exposure now → small; the lever bites on season-transition days); combined CTL/ATL/TSB unchanged.
Inert below the `MIN_SAMPLES` gate. pytest 65 green; web `tsc` clean.

**Tunables.** `DESCENT_LOAD_PER_1000M=55`, `DESCENT_FAMILIARITY_{WINDOW_D=28, SWING=0.25, ANCHOR_PCT=50,
MIN_SAMPLES=12}`, `DESCENT_RECOVERY_SWING=0.18` (load.py ↔ load.ts). Population starts; the soreness fit
refines the base later. **Now fully done — remaining descent calibration folds into the soreness-driven fit.**

---

## Part B — RPE capture (Q5)

### B.1 What the literature says

- **Scale: Borg CR10 / Foster session-RPE (0–10)**, centred on the *global* effort of the session;
  load index = `RPE × duration`. Preferred over Borg 6–20 for a consumer app (more intuitive,
  mobile-friendly, directly tied to session load). The two scales correlate strongly. *(Haddad et al.
  review — PMC5673663; Foster — minds.wisconsin.)*
- **Timing: 20–30 min post-session** (Foster's classic guidance to limit the **recency** bias of a very
  hard/easy finish). In practice **~10 min** is already close for several sports; keep a **standardized**
  protocol. *(boxing study — ijspp.2018-0637; PMID 30160557.)*
- **Wording: ask the *global* session effort, not a snapshot.** Validated phrasing ≈ *"Globally, how hard
  was this session?"* + *"Think of the whole session, not just the end."* *(PMC5673663; Foster.)*
- **Verbal anchors (Foster CR10):** 0 repos · 1 très très facile · 2 facile · 3 modéré · 4 assez dur ·
  5 dur · 7 très dur · 10 maximal. Emphasis on the **bounds + a few stable anchors**, not every
  intermediate point. *(borgperception PDF; fysio.dk CR10.)*
- **Pitfalls.** Don't confuse effort with **fatigue/soreness/emotional stress**; don't inflate the score
  **because it was long** (session-RPE already × duration); users need **familiarization**; recency bias
  in intermittent/contrasted sessions. *(PMC5673663; fysio.dk; ijspp.2018-0637.)*
- **Cross-discipline.** Session-RPE is comparably *useful* across very different sports (one global
  internal load), **but the same value can mask different physiological strain** — a trail cardio session
  and a local-muscular climbing session can score the same. The robust fix for mountain sports is
  **differential RPE**: at minimum **breath/cardio** + **legs/local-muscular**; for climbing/alpinism a
  **forearm/grip** sub-score is probably the most informative. *(PMC5673663; differential RPE —
  PMID 30160557.)*
- **Vs objective measures.** Session-RPE correlates well-to-strongly with HR/TRIMP/VO2/lactate.
  Best design is **hybrid**: RPE primary, objective metrics to **contextualize** (and watch the
  perceived-vs-objective **gap** to flag fatigue/atypical sessions), not to replace it. *(PMC5673663;
  ijspp.2018-0637.)*

### B.2 What Massif does today

- **Scale 1–10**, bare numbers, no anchors. `perceived_rpe smallint check (between 1 and 10)`;
  `rpe_source in ('user','estimated','pending')`. *(migration `…0001`; `web/src/components/rpe.tsx`.)*
- **Load mapping:** `session_rpe → intensity = rpe/10 → load = hours × intensity² × 100` (so RPE 10 = IF
  1.0 = threshold). This deliberately keeps RPE-scored sessions on the **same "1 h @ threshold = 100"**
  currency as hrTSS (a unification choice, not a session-RPE-AU formula). *(`load.py _method_session_rpe`.)*
- **Timing:** none. RPE is entered whenever the athlete opens the app (possibly days later); no timestamp,
  no 20–30 min nudge.
- **Wording:** tooltip *"Saisir l'effort perçu (RPE 1–10) → charge réelle"* — no global-session framing,
  no recency caution, no anchors.
- **Differential RPE:** none. RPE-scored sports split aero/neuro by a **fixed** `CHANNEL_SPLIT`
  (climbing 0.15/0.85) / `IMPACT_FRAC` — a taxonomy guess, not the athlete's perception.
- **Hybrid:** partial — `needs_review` flags suspect loads, but there is no perceived-vs-objective gap
  monitor.

### B.3 Gap (and its magnitude)

| # | Literature | Massif today | Gap / magnitude |
|---|---|---|---|
| G1 | CR10 **0–10 with anchors** | 1–10, no anchors | **Medium** — validity/consistency, esp. cross-discipline comparability (the single-currency promise) |
| G2 | Ask **20–30 min** post, standardized | no timing at all | **Medium** — recall/recency error; future-proofing + calibration hygiene |
| G3 | **Global-session** wording + recency caution | generic tooltip | **Low effort, high value** — pure copy/UI |
| G4 | **Differential RPE** (breath/legs/grip) for mountain | single global RPE → fixed channel split | **High for mountain fidelity** — maps perception directly onto the two channels; replaces the `CHANNEL_SPLIT` guess for the exact sports (alpi/climbing) where wearables are blind |
| G5 | Familiarization + perceived-vs-objective gap | none | **Low** — calibration nicety |

### B.4 What shipped (Phases 1 & 2)

- **Phase 1 — instrument quality (SHIPPED 2026-06-25).** Foster CR10 picker with anchors + the validated
  global-session wording + a 20–30 min nudge + `rpe_recorded_at` timestamp (migration `…0004`). Details below.

- **Phase 2 — differential RPE → perception-driven channel split (SHIPPED 2026-06-25).** Two coupled moves:
  - **Prerequisite bug fix — a USER RPE now wins the ladder.** For alpinism/via_ferrata/grande_voie the
    ladder is `[vertical_duration, session_rpe, …]`; `vertical_duration` always has inputs, so it won
    `compute_load` and the athlete's RPE was **silently ignored on recompute/sync** (only `setRpe` honoured
    it → divergence; a grande_voie rated **RPE 10 scored 38**, an alpi rated **RPE 3 scored 182**). Fix:
    when `rpe_source == 'user'` + a `perceived_rpe` is set + `session_rpe` is in the ladder, `session_rpe`
    is moved to the front. Re-scores ~5 historical user-RPE mountain days toward their effort report
    (all old → current CTL/TSB barely moves).
  - **The differential split.** Optional CR10 sub-scores `rpe_cardio` (souffle → aerobic), `rpe_legs`,
    `rpe_grip` (→ neuromuscular). When **≥ 2** are present (> 0), an RPE-scored session's aero/neuro split
    is **perception-derived**, replacing the fixed `CHANNEL_SPLIT` / `IMPACT_FRAC`:
    ```
    points    = hours·(perceived_rpe/10)²·100            # global magnitude, unchanged
    neuro_rpe = min(10, √(legs² + grip²))                # quadrature: ≥max, <sum (credits a 2nd loaded system)
    aero_frac = cardio² / (cardio² + neuro_rpe²)         # 0 if no cardio
    structural sports    → aerobic = points·aero_frac, neuro = points·(1−aero_frac)   (total = points)
    aerobic-engine sports→ aerobic = points·aero_frac, neuro = max(points·(1−aero_frac), impact + descent)
    ```
    The **objective descent term stays a FLOOR** for aerobic-engine sports — a same-session RPE is taken
    before DOMS and under-reports delayed eccentric damage, so a big descent must still be able to outscore
    a calm day (the model thesis). **Guard:** on aerobic-engine sports the split needs a `rpe_cardio`
    score (else a blank cardio would zero the engine); structural sports (aerobic ≈ 0) split on legs+grip
    alone. **Inert by default** — all existing rows have NULL sub-scores → today's behaviour, byte-identical
    (regression-locked). Migration `…0005` adds the three nullable `smallint 0..10` columns.
  - Wired byte-identical across all five scoring paths (`load.py` ↔ `load.ts`; `sync.recompute_activity_loads`,
    `strava.sync` + `db.load_user_differential_rpes`, `strava-sync.ts`, `actions.setRpe`), so on-demand ==
    nightly; surfaced to the coach (`coach-context.ts` `rpe_diff`). UI: an optional "préciser par système"
    panel in `rpe.tsx` (cardio = Alpine, legs/grip = Summit, per the design system). Verified by an
    adversarial multi-agent pass (parity, partition invariant, inertness, edges, migration). pytest 71 green.
  - **Operational gate:** the code SELECTs the three columns unconditionally → **migration `…0005` (and the
    pending `…0004`) must be pushed (`supabase db push`) before this code runs/deploys**, else PostgREST
    42703. Apply the ladder-fix re-score with `--recompute-loads` *after* the push.

<details><summary>Original phased proposal (superseded by the above)</summary>

- **Phase 1 — instrument quality (cheap, no model risk).**
  - Scale → **CR10 0–10 with Foster anchors** (0 repos … 10 maximal). `rpe/10` mapping still holds
    (0 → 0). Migration: relax CHECK to `between 0 and 10`.
  - **Wording:** *"Globalement, à quel point cette séance était-elle difficile ? Pense à toute la séance,
    pas seulement à la fin."* + anchor legend in the picker.
  - **Timing:** add `activities.rpe_recorded_at timestamptz` + a gentle "idéalement 20–30 min après" hint;
    store the delay for later quality-weighting. No re-score (existing values + formula unchanged).
  - Files: `web/src/components/rpe.tsx`, `web/src/app/actions.ts` (timestamp), one migration. UI-led, on
    the design system (neutral stone; RPE numbers `tabular-nums`).

- **Phase 2 — differential RPE → perception-driven channel split (the model-relevant one).**
  - Optional sub-scores: `rpe_cardio` (souffle → **aerobic**), `rpe_legs` (musculaire local → **neuro**),
    `rpe_grip` (avant-bras/prise → **neuro**, climbing-specific). Migration:
    `activities.{rpe_cardio, rpe_legs, rpe_grip} smallint check (… between 0 and 10)`.
  - **Model rule:** when sub-scores are present, an RPE-scored session splits aero/neuro **from
    perception** (cardio → aerobic engine; legs/grip → neuromuscular) instead of `CHANNEL_SPLIT` /
    `IMPACT_FRAC`. When only the global RPE is given → **today's behaviour unchanged** (inert by default).
  - `load.py` rule → mirror `load.ts`/`strava-sync.ts`; coach context can surface the split. **Dry-run on
    climbing/alpi history before `--recompute-loads`.**
  - This is where RPE meets the two-channel thesis: it makes the aero/neuro split **measured** for the
    sports where it currently rests on a fixed guess.

</details>

---

## Sources

**Descent / repeated-bout:** Giandolini thesis (downhill-running review, `jbmorin.net`) · RBE review
PMID 12641640 · prior-eccentric protection PMID 8887208 · descent-specific adaptation PMID 3431375 ·
DOMS time-course PMID 17373600.

**RPE:** Haddad et al. session-RPE review PMC5673663 · Foster CR10 session-RPE (minds.wisconsin) ·
timing/recency boxing study `10.1123/ijspp.2018-0637` · differential RPE PMID 30160557 · CR10 anchors
(`borgperception` PDF; `fysio.dk` CR10 scale).

---

## Integration discipline (both parts)

- `load.py` stays source of truth → mirror `load.ts` / `strava-sync.ts` / `rollup.ts`; coach context
  mirrors (`context.ts` ↔ `coach-context.ts`) if the new signals feed the coach.
- Migrations via the Supabase **CLI** only (never the MCP), applied **before** the code.
- **Dry-run on real data → measure the delta on the neuro channel + CTL/`tsb_neuromuscular` → only then
  `--recompute-loads`** (same discipline as Upgrades 4–6).
- New coefficients are **population defaults**, **bounded**, **inert until data flows** — refine from the
  athlete's own history. pytest + `tsc` gates.
</content>
</invoke>
