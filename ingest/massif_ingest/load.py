"""Cross-sport training-load computation — the heart of Massif.

Every activity gets ONE comparable load, split into two channels that PARTITION the total — but the
channels are computed INDEPENDENTLY and summed, never one number sliced by a fixed ratio:

  - aerobic_load        : the cardiometabolic engine cost (power/HR/pace; or, with no HR, a
                          duration + ascent estimate). HRV / RHR / Body Battery see it; recovers fast.
                          Anchor: 100 points ≈ 1 h at threshold on THIS channel.
  - neuromuscular_load  : the structural / CNS cost, built from stressors the wearables are blind to —
                          the eccentric DESCENT (D-), plus a small impact fraction of the aerobic
                          effort. HRV-blind, recovers slowly (tendons: weeks), an injury vector.

The DB derives training_load = aerobic_load + neuromuscular_load (generated column), so this module
writes only the two channels.

WHY ADDITIVE (not "one method → fixed split"): a long descent loads the quads/tendons eccentrically
while the heart stays calm. Under a HR-only method that cost is invisible; under a fixed taxonomy
split it is merely a fraction of the (HR-blind) total. Computing the descent term separately and
ADDING it is what lets a 3000 m-descent trail correctly outscore a smaller hike even when both ran
at a moderate HR. Pure strength/technical sports have no aerobic engine, so for them the session
effort itself is split (mostly neuromuscular) — see STRUCTURAL_EFFORT_GROUPS.

`compute_load` walks the sport's ordered `load_method_ladder` to pick the aerobic-engine method
(first whose inputs are present), guaranteeing a non-NULL load for every activity.

NOTE: the coefficients/ratios below are population starting points. For a single athlete they
should be personalized from the user's own RPE-vs-Garmin history over the first few weeks
(see docs/ARCHITECTURE.md → "personalization"). Treat early output as provisional. Two known
calibration gaps to revisit with real data:
  - ASCENT_AEROBIC_PER_1000M (no-HR mountain estimate) credits a fixed cost per 1000 m of D+
    regardless of how easy the climb was, so a HR-less hike can read higher than the same hike via
    hrtss. Most outings have HR (→ hrtss), so this only affects HR-less mountain days.
  - For needs_manual_rpe mountain sports (alpinism / via_ferrata), the descent term is added on top
    of an RPE-derived aerobic number; the RPE may already partly reflect the descent, so its marginal
    attribution there is a calibration item, not a clean independent signal (unlike the HR/power path).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

# Sports with no real aerobic engine: the session effort (sRPE / grade / tonnage) is itself mostly
# muscular, so it is split aerobic : neuromuscular by taxonomy (must sum to 1.0) rather than treated
# as a cardiac cost. Everything else is an "aerobic-engine" sport (additive channels, see below).
STRUCTURAL_EFFORT_GROUPS = {"technical_strength", "resistance"}
CHANNEL_SPLIT: dict[str, tuple[float, float]] = {
    "technical_strength": (0.15, 0.85),  # climbing: fingers/forearms/CNS
    "resistance":         (0.10, 0.90),  # heavy strength
    "other":              (0.70, 0.30),  # conservative fallback for an unclassified effort sport
}

# Aerobic-engine sports — the HRV-blind structural cost of the locomotion itself, as a fraction of
# the aerobic load (running impact, uphill muscular work, posture). The big eccentric cost of
# descending is handled separately by DESCENT_LOAD_PER_1000M, so these stay modest.
IMPACT_FRAC: dict[str, float] = {
    "paced_endurance":   0.15,
    "mountain_vertical": 0.20,
    "mountain_technical": 0.40,  # multi-pitch / grande voie: a long mountain day (aerobic base + D±) AND
    #                              real technical/forearm/core neuromuscular cost → a higher impact fraction
    #                              on top of the additive descent term. Population start; calibrate.
    "aquatic":           0.10,
    "other":             0.25,
}

# Default intensity factor when nothing better is known (used by duration_fallback / sRPE base).
DEFAULT_IF = 0.55  # ~ easy aerobic effort
# Eccentric structural cost per 1000 m of DESCENT (D-), scaled by carried mass — the neuromuscular
# stressor wearables can't see. This is the cost for a regularly-exposed (TRAINED) descender: the
# downhill-running literature puts the trained eccentric-damage response at ~0.70-0.78× the naive one
# (force loss ≈ -16% trained vs -24% naive — Giandolini review, docs/research/descent-neuromuscular-rpe.md),
# so we anchor the base at the trained value (≈0.78 × the original naive 70 ≈ 55) and let descent_factor
# climb back toward the naive ~70 when the athlete is currently DE-adapted. Reversible; the soreness fit
# (Upgrade 5 backlog) refines it from real next-day soreness later.
DESCENT_LOAD_PER_1000M = 55.0
# Aerobic cost per 1000 m of ASCENT (D+) credited ONLY when there is no usable HR (the no-HR mountain
# estimate). With HR present, hrtss already captures the climb, so this is not added (no double count).
ASCENT_AEROBIC_PER_1000M = 100.0

# ── Descent trainability — repeated-bout effect (docs/research/descent-neuromuscular-rpe.md, part A) ──
# The eccentric cost of a descent is TRAINABLE: an athlete recently exposed to descents takes ~20-30%
# less damage for the same D- (repeated-bout effect) and recovers faster, so a strictly FIXED
# DESCENT_LOAD_PER_1000M over-counts a descent for a well-exposed athlete. We modulate it by a FAMILIARITY
# proxy = the athlete's trailing D- relative to their OWN typical trailing D-, with a BOUNDED, SATURATING
# law (the literature recommends f bounded ≈0.7-1.3, with diminishing returns). The factor is 1.0 when
# recent exposure == the athlete's typical (or unknown) → INERT until a caller stamps `descent_familiarity`
# on the activity. Phase 1 = coefficient only; the recovery-τ modulation (Q6/NEURO_ATL_DAYS) is a later upgrade.
DESCENT_FAMILIARITY_WINDOW_D = 28   # trailing window (days) for the cumulative-D- exposure proxy (lit.: 2-6 wk)
DESCENT_FAMILIARITY_SWING = 0.25    # max ±swing → factor ∈ [1-SWING, 1+SWING] = [0.75, 1.25]
DESCENT_FAMILIARITY_ANCHOR_PCT = 50  # percentile of trailing-D- (over descent-active dates) that maps to
#   factor 1.0 — the athlete's TYPICAL exposure, where the (trained-anchored) base coefficient applies.
#   The factor then climbs toward the NAIVE cost (~base × 1.25 ≈ 70) after a layoff and dips below in a
#   heavy block. (The trained↔naive STANDING level lives in the base coefficient — the factor is the
#   DYNAMIC, net-~0 risk-timing modulator around it; see the dry-run analysis in MODEL_UPGRADES.md.)
DESCENT_FAMILIARITY_MIN_SAMPLES = 12  # need ≥ this many descent-active dates before the factor is trusted;
#   below it the model has too little history to judge familiarity → stay inert (factor 1.0), no false
#   precision. The "imprecise/unreliable" guard — surfaced to the coach via the descent-model confidence.


def descent_factor(familiarity_ratio: float | None) -> float:
    """Repeated-bout multiplier on the descent coefficient, bounded to [1-SWING, 1+SWING] and saturating.
    `familiarity_ratio` = trailing-WINDOW D- as-of the activity / the NAIVE reference exposure (the
    ANCHOR_PCT percentile of the athlete's trailing D-). ratio 1.0 = naive → factor 1.0 (full base cost);
    ratio > 1 (more exposed than the naive reference) → adapted → factor < 1 (less damage); ratio < 1 →
    factor > 1. The (r-1)/(r+1) shape is bounded by construction and flattens (diminishing returns).
    Returns 1.0 when the ratio is missing/zero — inert until the context is wired in."""
    if not familiarity_ratio or familiarity_ratio <= 0:
        return 1.0
    return 1.0 - DESCENT_FAMILIARITY_SWING * (familiarity_ratio - 1.0) / (familiarity_ratio + 1.0)


# Phase 2 — descent trainability also speeds RECOVERY (the repeated-bout effect shortens the time the
# eccentric/structural fatigue lingers): trained ≈ 72 h vs naive ≥ 96 h (≈ -25-33%). We modulate the
# neuromuscular ACUTE τ (NEURO_ATL_DAYS) by the SAME familiarity ratio as the cost — adapted (ratio > 1)
# → shorter τ (fatigue clears faster); de-adapted → longer. Bounded & saturating, like descent_factor, but
# a gentler swing (recovery moves less than damage). Applied in the rollup as a NON-STATIONARY neuro-ATL
# EWMA. The neuro CHRONIC (CTL, 42 d) is untouched, so this shifts tsb_neuromuscular (the readiness lever).
DESCENT_RECOVERY_SWING = 0.18  # τ_neuro swing → factor ∈ [0.82, 1.18] → τ ≈ 11.5-16.5 d at base 14 (≈ -30%/+18%)


def descent_recovery_factor(familiarity_ratio: float | None) -> float:
    """Multiplier on the neuromuscular acute τ from descent familiarity (repeated-bout → faster recovery).
    ratio > 1 (more exposed than typical) → adapted → factor < 1 (shorter τ, fatigue clears faster);
    ratio < 1 → factor > 1 (longer τ). Bounded [1-RECOVERY_SWING, 1+RECOVERY_SWING], saturating. 1.0 when
    the ratio is missing/zero (history below the gate, or no recent descent) → the base τ unchanged (inert)."""
    if not familiarity_ratio or familiarity_ratio <= 0:
        return 1.0
    return 1.0 - DESCENT_RECOVERY_SWING * (familiarity_ratio - 1.0) / (familiarity_ratio + 1.0)


def ewma_variable_tau(values: list[float], tau_days: list[float]) -> list[float]:
    """Banister-style EWMA with a PER-STEP time constant (non-stationary): alpha_t = 1 - e^(-1/tau_t).
    Used for the neuromuscular acute load when its recovery τ varies day-to-day with descent familiarity
    (Phase 2). With a constant tau list it reduces exactly to the fixed-τ EWMA (sync._ewma_series)."""
    import math
    out: list[float] = []
    prev = 0.0
    for v, tau in zip(values, tau_days):
        alpha = 1.0 - math.exp(-1.0 / tau) if tau and tau > 0 else 1.0
        prev = prev + alpha * (v - prev)
        out.append(prev)
    return out


def _percentile(sorted_vals: list[float], pct: float) -> float:
    """Linear-interpolated percentile of an already-sorted list (pct in 0-100)."""
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    rank = (pct / 100.0) * (len(sorted_vals) - 1)
    lo = int(rank)
    if lo + 1 >= len(sorted_vals):
        return sorted_vals[-1]
    return sorted_vals[lo] + (rank - lo) * (sorted_vals[lo + 1] - sorted_vals[lo])


def descent_familiarity_ratios(
    daily_descent: dict[str, float], anchor_pct: float = DESCENT_FAMILIARITY_ANCHOR_PCT
) -> dict[str, float]:
    """Map {local_date(ISO): D- metres that day} → {local_date: familiarity RATIO}. A date's ratio is its
    trailing DESCENT_FAMILIARITY_WINDOW_D-day D- sum (the days BEFORE it — prior exposure, NOT the day
    itself, so a descent can't pre-adapt the body to itself) divided by the NAIVE reference exposure: the
    `anchor_pct` percentile of trailing D- over descent-active dates. Anchoring at a LOW percentile (not the
    median) means a regularly-exposed athlete sits above it and earns a standing repeated-bout discount,
    self-normalising per athlete (multi-user-ready). Returns {} when there's no usable descent history."""
    parsed = sorted((date.fromisoformat(d), m) for d, m in daily_descent.items())
    if not parsed:
        return {}
    window, one_day = timedelta(days=DESCENT_FAMILIARITY_WINDOW_D), timedelta(days=1)
    trailing: dict[str, float] = {}
    active: list[float] = []
    for d, m in parsed:
        s = sum(mm for pd, mm in parsed if d - window <= pd <= d - one_day)
        trailing[d.isoformat()] = s
        if m > 0:
            active.append(s)
    if len(active) < DESCENT_FAMILIARITY_MIN_SAMPLES:
        return {}  # too little descent history to judge familiarity → stay inert (no false precision)
    active.sort()
    baseline = _percentile(active, anchor_pct)
    if baseline <= 0:
        return {}
    return {iso: s / baseline for iso, s in trailing.items()}


def descent_model_confidence(daily_descent: dict[str, float]) -> dict:
    """Reliability of the descent-trainability adjustment for THIS athlete, surfaced as an ALERT when low.
    `applied` is False below DESCENT_FAMILIARITY_MIN_SAMPLES descent-active dates (factor stays 1.0);
    `confidence` is 'low' until there are ~2× the minimum (the band where the percentile baseline is still
    noisy), else 'ok'. Lets the coach say 'descent cost adjusted to your recent exposure (estimate still
    firming up)' instead of presenting a shaky number as fact."""
    n = sum(1 for m in daily_descent.values() if m and m > 0)
    applied = n >= DESCENT_FAMILIARITY_MIN_SAMPLES
    return {
        "applied": applied,
        "sample_dates": n,
        "confidence": "ok" if n >= 2 * DESCENT_FAMILIARITY_MIN_SAMPLES else ("low" if applied else "off"),
    }

# ── Heat & altitude (docs/research/heat-altitude.md) ──────────────────────────────────────────────
# THE RULE: heat and altitude already raise HR for a given effort, so the HR-driven channels (hrtss)
# ALREADY count that strain — never multiply HR-derived load by an environmental factor (double-count).
# The ONLY load correction we apply is to the environment-BLIND mechanical methods tss (power) and rtss
# (pace): they read external work, which under-counts the cost of producing it in thin air. Everything
# else (temperature, acclimation, hypoxia exposure dose) is CONTEXT for the coach, not a load input.
HEAT_TEMP_THRESHOLD_C = 22.0     # Garmin's heat-acclimation threshold (manuals); "a hot session" for the coach
ALT_ACCLIM_THRESHOLD_M = 800.0   # Garmin's altitude-acclimation threshold; also the floor below which the
#                                  altitude power/pace correction is negligible → factor 1.0
ALT_HYPOXIA_THRESHOLD_M = 1500.0  # exposure-dose threshold: where hypoxia starts to matter for endurance
#                                   (effects are detectable from ~800 m but become clear above ~1000-1500 m)
# Altitude-adjusted power/pace (Bassett et al. 1999, MSSE — the curves intervals.icu uses; anchored to
# Wehrlin & Hallén 2006, PMID 16311764: VO2max falls ~6.3%/1000 m, range 4.6-7.5%, in unacclimatized fit
# athletes). We express the loss as an intensity MULTIPLIER 1/(1-loss) ≥ 1.0: the same recorded power/pace
# at altitude reflects a harder effort relative to a reduced aerobic ceiling. Population starts (like the
# rest of this module) — calibrate later. Acclimatization recovers ~30-40% of the acute loss; we default
# to UNACCLIMATIZED (the bigger, conservative correction), since the athlete lives low and climbs for sessions.
VO2MAX_LOSS_PER_1000M = 0.065
ALT_ACCLIM_RECOVERY = 0.35       # fraction of the acute VO2max loss recovered once acclimatized
ALT_CORRECTION_CAP = 0.30        # cap the loss term — beyond ~5000 m we're outside this linear model's range


def altitude_power_factor(avg_altitude_m: float | None, acclimatized: bool = False) -> float:
    """Intensity multiplier (≥ 1.0) for the altitude-blind mechanical methods (tss/rtss) — NOT for hrtss.
    Below ALT_ACCLIM_THRESHOLD_M the effect is negligible → 1.0. Above it, the athlete's usable aerobic
    power is reduced ~VO2MAX_LOSS_PER_1000M per 1000 m, so the same recorded power/pace is a harder effort:
    multiply intensity by 1/(1-loss). Defaults to unacclimatized (the larger correction)."""
    alt = avg_altitude_m or 0.0
    if alt <= ALT_ACCLIM_THRESHOLD_M:
        return 1.0
    loss = VO2MAX_LOSS_PER_1000M * (alt - ALT_ACCLIM_THRESHOLD_M) / 1000.0
    if acclimatized:
        loss *= (1.0 - ALT_ACCLIM_RECOVERY)
    loss = min(loss, ALT_CORRECTION_CAP)
    return 1.0 / (1.0 - loss)


# ── Effective-dated thresholds (athlete_thresholds; rec 2) ────────────────────────────────────────
# Resolve the athlete's thresholds AS-OF an activity's date so historical load stays reproducible after a
# threshold change, and so the model can track a non-stationary HR baseline (heat/altitude acclimation
# shifts FCmax/LTHR over days-weeks). Only these fields are dated; everything else stays on athlete_profile.
THRESHOLD_FIELDS = ("max_hr", "resting_hr", "lthr", "ftp_watts", "threshold_pace_s_per_km", "weight_kg")


def resolve_profile(profile: dict, history: list[dict] | None, on_date: str | None) -> dict:
    """Return the profile as-of `on_date` (YYYY-MM-DD): the base athlete_profile overlaid with the latest
    athlete_thresholds row whose effective_date <= on_date (its non-null THRESHOLD_FIELDS only). Empty/absent
    history or date → the base profile UNCHANGED, so behaviour is identical until dated rows exist."""
    if not history or not on_date:
        return profile
    applicable = [h for h in history if (h.get("effective_date") or "") <= on_date]
    if not applicable:
        return profile
    row = max(applicable, key=lambda h: h["effective_date"])
    merged = dict(profile)
    for k in THRESHOLD_FIELDS:
        if row.get(k) is not None:
            merged[k] = row[k]
    return merged

# ── Multi-day expedition handling (data hygiene) ────────────────────────────────────────────────
# Strava lets you publish a multi-day outing (a GR20, a trek) as ONE activity: elapsed_time then spans
# the whole trip (nights included) and the row lands entirely on its START date. Two distortions follow:
# the load is computed over the elapsed window (sleep counted as effort), and a trip's worth of load
# spikes a single day — wrecking the EWMAs (ATL explodes, then CTL stays falsely high for ~2 months →
# phantom +TSB). We detect such activities and (a) compute their load from MOVING time, not elapsed, and
# (b) spread it across the calendar days they truly span (done in the rollup, via `effective_days`).
# A normal session that merely crosses midnight (a night race) has elapsed≈moving → NOT flagged. The
# tell of a real expedition is a large non-moving GAP (≥ one overnight) on top of a multi-day span.
MULTIDAY_GAP_S = 6 * 3600  # min elapsed−moving gap (an overnight) to treat a multi-day span as a trip


def activity_span_days(started_at: str | None, duration_s: int | None, moving_s: int | None) -> int:
    """Calendar days a multi-day EXPEDITION truly spans (≥2); else 1 (the normal single-day case).

    A trip qualifies only if its elapsed window crosses calendar-day boundaries AND it contains a large
    non-moving gap (≥ MULTIDAY_GAP_S) — so a night race that just crosses midnight (elapsed≈moving)
    stays a 1-day activity. Returns 1 on missing/unparsable inputs (degrade to current behaviour)."""
    if not started_at or not duration_s:
        return 1
    try:
        start = datetime.fromisoformat(started_at)
    except (TypeError, ValueError):
        return 1
    end = start + timedelta(seconds=duration_s)
    span = (end.date() - start.date()).days + 1
    gap = duration_s - (moving_s or duration_s)
    return span if span > 1 and gap >= MULTIDAY_GAP_S else 1


def _active_duration(a: dict) -> int:
    """Seconds of real effort to score. For a multi-day expedition this is MOVING time (elapsed would
    count the nights); for every normal activity it stays elapsed `duration_s` (unchanged behaviour)."""
    dur = a.get("duration_s") or 0
    if activity_span_days(a.get("started_at"), dur, a.get("moving_s")) > 1:
        return a.get("moving_s") or dur
    return dur


# ── Outlier guard + mostly-stopped correction (data hygiene, multi-user-ready) ──────────────────
# Flag — never silently cap — activities whose load rests on a SUSPECT input (an HR glitch, an
# implausible intensity): a heuristic can't tell a real hard mountain day from a glitch, and
# suppressing genuine load is worse than flagging.
# Mostly-stopped single-day outings (long belays/approach/pauses — typically alpinism / grande voie
# logged as a hike) are different: their elapsed time genuinely over-counts effort, so the
# duration-driven methods score them on MOVING time (see _scored_duration). We still FLAG them so the
# athlete can confirm with an RPE; a user-entered RPE then supersedes the concern (the session is
# scored at the declared effort) → the flag clears. The HR/power/pace methods keep elapsed: their
# intensity already reflects the stops (low HR while belaying), so shortening duration too would
# double-correct. See docs/MODEL_UPGRADES.md.
REVIEW_IF_CEILING = 1.5      # an intensity factor this high implies bad inputs, not a real effort
REVIEW_STOP_RATIO = 0.5      # single-day moving/elapsed below this = mostly stopped → score on moving time
REVIEW_MIN_ELAPSED_S = 3600  # only consider the stop ratio once the outing is long enough to matter


def _mostly_stopped(a: dict, effective_days: int) -> bool:
    """A single-day outing (≥ REVIEW_MIN_ELAPSED_S elapsed) that was mostly spent stopped
    (moving/elapsed < REVIEW_STOP_RATIO): belays / approach / lift laps / forgotten pauses inflate its
    elapsed time. Multi-day expeditions (effective_days>1) are handled separately (already on moving)."""
    dur, mov = a.get("duration_s") or 0, a.get("moving_s")
    return bool(effective_days == 1 and dur >= REVIEW_MIN_ELAPSED_S and mov and mov / dur < REVIEW_STOP_RATIO)


def _scored_duration(a: dict) -> int:
    """Effort seconds for the DURATION-DRIVEN methods (vertical_duration / session_rpe /
    duration_fallback): MOVING time when a multi-day expedition (elapsed counts the nights) OR a
    single-day outing that was mostly spent stopped (belays/approach inflate elapsed), else elapsed.
    The HR/power/pace methods keep _active_duration (see the guard comment above)."""
    dur = a.get("duration_s") or 0
    eff_days = activity_span_days(a.get("started_at"), dur, a.get("moving_s"))
    if eff_days > 1 or _mostly_stopped(a, eff_days):
        return a.get("moving_s") or dur
    return dur


def needs_review(a: dict, profile: dict, intensity_factor: float | None, effective_days: int) -> bool:
    """True when the computed load rests on a suspect input: an HR sensor glitch (avg_hr above the
    athlete's max), an implausible intensity factor, or a mostly-stopped single-day outing (long
    belays/pauses). A user-entered RPE clears the stop-ratio flag — the athlete vouched for the effort,
    and the session is then scored at that RPE rather than on elapsed time."""
    avg_hr, max_hr = a.get("avg_hr"), profile.get("max_hr")
    if avg_hr and max_hr and avg_hr > max_hr:
        return True
    if intensity_factor and intensity_factor > REVIEW_IF_CEILING:
        return True
    if a.get("rpe_source") != "user" and _mostly_stopped(a, effective_days):
        return True
    return False


@dataclass
class LoadResult:
    aerobic_load: float
    neuromuscular_load: float
    load_method_used: str
    intensity_factor: float | None
    effective_days: int = 1  # >1 ⇒ multi-day expedition; the rollup spreads the load across this many days
    needs_review: bool = False  # load rests on a suspect input (see needs_review) — surface for review

    @property
    def training_load(self) -> float:
        return self.aerobic_load + self.neuromuscular_load


def _tss_from_if(duration_s: int, intensity_factor: float) -> float:
    """TSS-style: 100 points == 1h at threshold (IF=1.0)."""
    hours = max(duration_s, 0) / 3600.0
    return hours * (intensity_factor ** 2) * 100.0


def _hr_fraction(hr: float, rhr: float, max_hr: float) -> float:
    denom = max_hr - rhr
    return (hr - rhr) / denom if denom > 0 else 0.0


def _mass_factor(activity: dict, profile: dict) -> float:
    """Carried-mass amplifier (1.0 = bodyweight only). A 14 kg pack on a 64 kg athlete → 1.22."""
    weight = profile.get("weight_kg") or 70.0
    return 1.0 + (activity.get("carried_load_kg") or 0.0) / weight


# ── adaptive calibration (prio 3c) ──────────────────────────────────────────────────────────────
# Calibratable coefficients are resolved to a PERSONALIZED value from athlete_load_params when one has
# been fitted, else the population default below — so an un-calibrated athlete gets exactly today's
# behaviour ("works without any input, refines with data"). The resolved coefficients ride along in `c`.
def _effective(params: dict | None) -> dict:
    p = params or {}
    return {
        "default_if": p.get("default_if", DEFAULT_IF),
        "descent_per_1000m": p.get("descent_load_per_1000m", DESCENT_LOAD_PER_1000M),
        "ascent_per_1000m": p.get("ascent_aerobic_per_1000m", ASCENT_AEROBIC_PER_1000M),
    }


def _descent_load(activity: dict, profile: dict, c: dict) -> float:
    """Eccentric/structural cost of descending (D-) — the HRV-blind neuromuscular stressor, computed
    independently of the aerobic engine and ADDED to the neuromuscular channel. Descending brakes the
    body weight eccentrically (quads/tendons) while the heart stays calm, so this must not be
    discounted just because HR — and hence the aerobic load — was low. Linear in D-, scaled by mass.
    `vertical_loss_m` may be absent (no altitude stream / non-GPS sport) → 0, degrading gracefully.
    Modulated by the repeated-bout `descent_factor` when the caller has stamped `descent_familiarity`
    (else 1.0 — inert)."""
    vloss = activity.get("vertical_loss_m") or 0.0
    factor = descent_factor(activity.get("descent_familiarity"))
    return (vloss / 1000.0) * c["descent_per_1000m"] * _mass_factor(activity, profile) * factor


# ── Differential RPE (Phase 2; docs/research/descent-neuromuscular-rpe.md part B) ─────────────────
# A single global session-RPE can't tell apart a cardio-driven day from a forearm/leg-driven one — yet
# that is exactly the aerobic-vs-neuromuscular split this model lives on. So the athlete may add OPTIONAL
# CR10 sub-scores (rpe_cardio = souffle → aerobic; rpe_legs / rpe_grip = local muscular → neuromuscular).
# When present, they set the aerobic/neuromuscular SPLIT of the global-RPE magnitude (`points`) from
# perception, REPLACING the fixed taxonomy ratio (CHANNEL_SPLIT) / impact fraction. The global perceived_rpe
# still sets the magnitude (it is the validated session-RPE), and — crucially — the OBJECTIVE eccentric
# descent term stays additive for aerobic-engine sports (a same-session RPE is taken before DOMS and
# under-reports delayed eccentric damage; a big descent must still be able to outscore a calm day).

def _differential_split(activity: dict) -> float | None:
    """Aerobic FRACTION (0..1) from differential RPE, or None to fall back to the fixed taxonomy split.
    Applies only when >= 2 of {rpe_cardio, rpe_legs, rpe_grip} are present (not None and > 0) — so a
    climber's legs+grip pair works even with no cardio score. The two local systems combine in QUADRATURE
    (>= max, < sum, capped at 10) so a second loaded system counts without two 8s reading as 16. aero_frac
    = cardio^2 / (cardio^2 + neuro_rpe^2); 0 when cardio is absent (a pure structural session)."""
    cardio = activity.get("rpe_cardio")
    legs = activity.get("rpe_legs")
    grip = activity.get("rpe_grip")
    present = [x for x in (cardio, legs, grip) if x is not None and x > 0]
    if len(present) < 2:
        return None
    neuro_rpe = min(10.0, ((legs or 0) ** 2 + (grip or 0) ** 2) ** 0.5)
    cardio_sq = (cardio or 0) ** 2
    denom = cardio_sq + neuro_rpe ** 2
    if denom <= 0:
        return None
    return cardio_sq / denom


# ── per-method computations: each returns (load_points, IF) or None if inputs are missing.
#    `c` carries the resolved (personalized-or-default) coefficients; unused by methods that need none. ──

def _method_tss(a: dict, p: dict, c: dict) -> tuple[float, float] | None:
    np_w, ftp = a.get("np_power_w") or a.get("avg_power_w"), p.get("ftp_watts")
    if not (np_w and ftp):
        return None
    # Power is environment-blind → correct for altitude (thin air costs more for the same watts). HR is NOT
    # corrected (hrtss already reflects the strain). Factor is 1.0 at low altitude, so flat rides are unchanged.
    intensity = (np_w / ftp) * altitude_power_factor(a.get("avg_altitude_m"))
    return _tss_from_if(_active_duration(a), intensity), intensity


def _method_hrtss(a: dict, p: dict, c: dict) -> tuple[float, float] | None:
    avg_hr, rhr, max_hr, lthr = a.get("avg_hr"), p.get("resting_hr"), p.get("max_hr"), p.get("lthr")
    if not (avg_hr and rhr and max_hr and lthr):
        return None
    avg_frac = _hr_fraction(avg_hr, rhr, max_hr)
    thr_frac = _hr_fraction(lthr, rhr, max_hr)
    intensity = avg_frac / thr_frac if thr_frac > 0 else c["default_if"]
    return _tss_from_if(_active_duration(a), intensity), intensity


def _method_rtss(a: dict, p: dict, c: dict) -> tuple[float, float] | None:
    # pace-based TSS: IF = threshold_pace / actual_pace (faster = higher IF). Pace is environment-blind →
    # correct for altitude (same pace is harder in thin air); hrtss is never corrected (no double-count).
    avg_pace, thr_pace = a.get("avg_pace_s_per_km"), p.get("threshold_pace_s_per_km")
    if not (avg_pace and thr_pace):
        return None
    intensity = (thr_pace / avg_pace) * altitude_power_factor(a.get("avg_altitude_m"))
    return _tss_from_if(_active_duration(a), intensity), intensity


def _method_vertical_duration(a: dict, p: dict, c: dict) -> tuple[float, float] | None:
    # No-HR mountain AEROBIC estimate: duration base + the climb's aerobic cost (ascent × mass). When
    # HR is usable, hrtss is more faithful (it already reflects the climb), so compute_load skips this
    # method in favour of hrtss — but ONLY when the ladder actually offers hrtss, so ladders without an
    # hrtss step (alpinism / via_ferrata) still get this ascent supplement instead of stranding on
    # duration_fallback. The eccentric DESCENT cost is added separately in compute_load, regardless of
    # which aerobic method wins.
    if not a.get("duration_s"):
        return None
    vgain = a.get("vertical_gain_m") or 0.0
    base = _tss_from_if(_scored_duration(a), c["default_if"])
    ascent_points = (vgain / 1000.0) * c["ascent_per_1000m"] * _mass_factor(a, p)
    return base + ascent_points, c["default_if"]


def _method_session_rpe(a: dict, p: dict, c: dict) -> tuple[float, float] | None:
    rpe = a.get("perceived_rpe")
    if not rpe:
        return None
    intensity = rpe / 10.0
    return _tss_from_if(_scored_duration(a), intensity), intensity


def _method_grade_volume(a: dict, p: dict, c: dict) -> tuple[float, float] | None:
    # TODO (Phase 2/3): grade-weighted climbing load from climbing_sets
    # (sum grade_numeric_weight x attempts x neuromuscular_coeff, scaled by wall-time density).
    # Until climbing detail is wired, return None so the ladder falls through to session_rpe.
    return None


def _method_tonnage_rpe(a: dict, p: dict, c: dict) -> tuple[float, float] | None:
    # TODO (Phase 2/3): tonnage (sets x reps x kg) x avg RPE from strength_sets.
    return None


def _method_duration_fallback(a: dict, p: dict, c: dict) -> tuple[float, float] | None:
    if not a.get("duration_s"):
        return None
    return _tss_from_if(_scored_duration(a), c["default_if"]), c["default_if"]


_METHODS = {
    "tss": _method_tss,
    "hrtss": _method_hrtss,
    "rtss": _method_rtss,
    "vertical_duration": _method_vertical_duration,
    "grade_volume": _method_grade_volume,
    "tonnage_rpe": _method_tonnage_rpe,
    "session_rpe": _method_session_rpe,
    "duration_fallback": _method_duration_fallback,
}


def compute_load(activity: dict, sport: dict, profile: dict, params: dict | None = None) -> LoadResult:
    """Pick the aerobic-engine method (first ladder method whose inputs exist), then build the two
    channels INDEPENDENTLY (see module docstring) and let the DB sum them.

    `params` (athlete_load_params) personalizes the calibratable coefficients; absent/empty → today's
    population defaults (no behaviour change). Aerobic-engine sports: the chosen method IS the aerobic
    load; the neuromuscular channel is the eccentric descent (D-) plus a small impact fraction of that
    aerobic effort, added on top. Strength/technical sports (STRUCTURAL_EFFORT_GROUPS): no aerobic
    engine, so the session effort is split aerobic : neuromuscular by taxonomy (mostly neuromuscular)."""
    c = _effective(params)
    ladder = sport.get("load_method_ladder") or ["duration_fallback"]
    # A USER-entered RPE is the athlete's direct report of how hard the session was → it supersedes the
    # objective duration estimate (vertical_duration / duration_fallback) for needs_manual_rpe sports.
    # Without this, vertical_duration (always has inputs) wins the alpinism/grande_voie/via_ferrata ladder
    # and the user's RPE is silently ignored on recompute/sync (it only ever took effect via setRpe's forced
    # session_rpe → divergence: a grande_voie rated RPE 10 could score ~38). HR/power methods are never in
    # these ladders; auto-estimated RPE (rpe_source != 'user') does NOT trigger this.
    if activity.get("rpe_source") == "user" and activity.get("perceived_rpe") and "session_rpe" in ladder:
        ladder = ["session_rpe", *(m for m in ladder if m != "session_rpe")]
    chosen_method, points, intensity = "duration_fallback", 0.0, c["default_if"]
    for method in ladder:
        fn = _METHODS.get(method)
        if fn is None:
            continue
        # Prefer HR over the no-HR vertical estimate when this ladder offers hrtss — so a valid HR
        # reading is used (and the climb isn't double-counted), yet ladders without an hrtss step
        # (alpinism / via_ferrata) still get vertical_duration's ascent supplement rather than falling
        # through to duration_fallback. (Bug guard: HR must never LOWER a vertical day's load.)
        if method == "vertical_duration" and "hrtss" in ladder and _method_hrtss(activity, profile, c):
            continue
        result = fn(activity, profile, c)
        if result is not None:
            points, intensity = result
            chosen_method = method
            break

    group = sport["taxonomy_group"]
    # Perception-derived split (differential RPE) only when the session was RPE-scored AND the athlete gave
    # >= 2 sub-scores; else None → the fixed taxonomy split below (today's behaviour, inert for all existing
    # rows since their sub-scores are NULL).
    aero_frac = _differential_split(activity) if chosen_method == "session_rpe" else None
    if group in STRUCTURAL_EFFORT_GROUPS:
        if aero_frac is not None:
            aerobic, neuromuscular = points * aero_frac, points * (1.0 - aero_frac)
        else:
            a_ratio, n_ratio = CHANNEL_SPLIT.get(group, CHANNEL_SPLIT["other"])
            aerobic, neuromuscular = points * a_ratio, points * n_ratio
    else:
        # `points` is the cardiometabolic cost → the aerobic channel in full. The neuromuscular
        # channel is built additively from stressors the aerobic number can't see.
        impact = points * IMPACT_FRAC.get(group, IMPACT_FRAC["other"])
        objective_neuro = impact + _descent_load(activity, profile, c)
        # The split applies here only when a CARDIO sub-score was given: on an aerobic-engine sport the
        # engine IS the defining cost, so a blank rpe_cardio (with legs/grip filled) must NOT zero the
        # aerobic channel — fall back to the full engine magnitude instead. (Structural sports above don't
        # need cardio: their aerobic cost is genuinely ~0, so aero_frac=0 there is correct.)
        if aero_frac is not None and activity.get("rpe_cardio"):
            # Perception splits the engine magnitude; but the OBJECTIVE descent+impact stays a FLOOR so a
            # big descent (which a same-session RPE under-reports) still outscores a calm day. neuro =
            # max(perceived non-cardio share, objective descent+impact). aerobic shrinks when the athlete
            # reports the cardio engine was easy (low rpe_cardio) — exactly the easy-HR / hard-legs case.
            aerobic = points * aero_frac
            neuromuscular = max(points * (1.0 - aero_frac), objective_neuro)
        else:
            aerobic = points
            neuromuscular = objective_neuro

    eff_days = activity_span_days(
        activity.get("started_at"), activity.get("duration_s"), activity.get("moving_s"))
    intensity_factor = round(intensity, 3) if intensity is not None else None
    return LoadResult(
        aerobic_load=round(aerobic, 2),
        neuromuscular_load=round(neuromuscular, 2),
        load_method_used=chosen_method,
        intensity_factor=intensity_factor,
        effective_days=eff_days,
        needs_review=needs_review(activity, profile, intensity_factor, eff_days),
    )
