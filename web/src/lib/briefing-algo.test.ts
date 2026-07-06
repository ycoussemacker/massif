/** Unit tests for the algorithmic briefing engine (LLM-free). Run: `npx tsx --test src/lib/briefing-algo.test.ts`
 *  Excluded from the Next build via tsconfig "exclude". Deterministic — this is the token-free verification. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { frWeekday } from "./briefing-shared";
import {
  buildAlgorithmicBriefing, computeReadiness, buildWeekPlan, targetLoadFor, phaseFromDaysTo,
  phaseSummaryFr, phaseMarkFr, PHASE_PARAMS, resolveWindowEffect, effectivePhase,
  type SystemTag, type WeekDay, type TrainingWindow,
} from "./briefing-algo";

const ZONES = [
  { zone: "Z1", low_bpm: 97, high_bpm: 116 }, { zone: "Z2", low_bpm: 116, high_bpm: 135 },
  { zone: "Z3", low_bpm: 135, high_bpm: 154 }, { zone: "Z4", low_bpm: 154, high_bpm: 179 },
  { zone: "Z5", low_bpm: 179, high_bpm: 193 },
];

function ctx(over: Record<string, any> = {}): any {
  return {
    today: "2026-06-25", // jeudi
    fitness_model_latest: { ctl: 45, atl: 40, tsb: 5, tsb_aerobic: 6, tsb_neuromuscular: 2, acwr: 1.0 },
    recovery_today: { available: true, training_readiness: 70, hrv_status: "balanced", resting_hr: 48 },
    environment: { heat_acclimation_pct: 80 },
    weather: [],
    thresholds: { resting_hr: 48, max_hr: 188, lthr: 178 },
    hr_zones: { source: "garmin", zones: ZONES },
    daily_load_21d: [],
    recent_activities_14d: [],
    declared_events: [],
    pinned_sessions: [],
    coach_prior_plan: [],
    athlete_constraints: null,
    favourite_sports: ["trail_running", "running"],
    goals: [], primary_goal: null,
    ...over,
  };
}

const isHard = (t: SystemTag) => t.startsWith("hard");
const fam = (t: SystemTag) => (t === "hard_aerobic" ? "aerobic" : t === "hard_neuromuscular" || t === "hard_structural" ? "neuro" : null);

// daily_load_21d fixtures for the F5 ACWR-rising condition (chronological; element = { date, load }).
const RISING = Array.from({ length: 21 }, (_, i) => ({ date: `d${i}`, load: i < 14 ? 30 : 60 })); // last 7 d heavier
const FLAT = Array.from({ length: 21 }, (_, i) => ({ date: `d${i}`, load: 40 }));                  // no trend

test("readiness: green when fresh + good recovery", () => {
  assert.equal(computeReadiness(ctx()), "green");
});
test("readiness: red on ACWR spike / deep neuro fatigue / low Garmin readiness", () => {
  assert.equal(computeReadiness(ctx({ fitness_model_latest: { ctl: 45, tsb: 5, tsb_neuromuscular: 2, acwr: 1.8 } })), "red");
  assert.equal(computeReadiness(ctx({ fitness_model_latest: { ctl: 45, tsb: 0, tsb_neuromuscular: -18, acwr: 1.0 } })), "red");
  assert.equal(computeReadiness(ctx({ recovery_today: { available: true, training_readiness: 18 } })), "red");
});
test("readiness: amber on mild fatigue / missing Garmin / poor HRV", () => {
  assert.equal(computeReadiness(ctx({ fitness_model_latest: { ctl: 45, tsb: 0, tsb_neuromuscular: -8, acwr: 1.0 } })), "amber");
  assert.equal(computeReadiness(ctx({ recovery_today: { available: false, missing: ["sommeil"] } })), "amber");
  assert.equal(computeReadiness(ctx({ recovery_today: { available: true, hrv_status: "low" } })), "amber");
});
test("readiness: amber on a moderate Garmin readiness (the live calibration case)", () => {
  // tsb_neuro -2.56, tsb -4.45, training_readiness 56 → was wrongly GREEN; now AMBER (don't greenlight hard).
  assert.equal(computeReadiness(ctx({
    fitness_model_latest: { ctl: 81, tsb: -4.45, tsb_aerobic: 0.63, tsb_neuromuscular: -2.56, acwr: 1.06 },
    recovery_today: { available: true, training_readiness: 56, hrv_status: "balanced", resting_hr: 50 },
  })), "amber");
  // A clearly fresh morning (readiness 72) stays green.
  assert.equal(computeReadiness(ctx({
    fitness_model_latest: { ctl: 81, tsb: 2, tsb_aerobic: 3, tsb_neuromuscular: 1, acwr: 1.0 },
    recovery_today: { available: true, training_readiness: 72, hrv_status: "balanced", resting_hr: 48 },
  })), "green");
});

test("week plan: always 7 days, offsets 0..6", () => {
  const w = buildWeekPlan(ctx(), "green");
  assert.equal(w.length, 7);
  w.forEach((d, i) => assert.equal(d.day_offset, i));
});

test("week plan: today gated by readiness", () => {
  assert.equal(buildWeekPlan(ctx(), "red")[0].system_tag, "rest");
  assert.equal(buildWeekPlan(ctx(), "amber")[0].system_tag, "recovery");
});

test("week plan: never a hard day on a no_hard weekday", () => {
  const w = buildWeekPlan(ctx({ athlete_constraints: { no_hard_days: ["jeudi", "lundi"] } }), "green");
  for (const d of w) {
    const wd = frWeekday(dateOf("2026-06-25", d.day_offset));
    if (["jeudi", "lundi"].includes(wd)) assert.ok(!isHard(d.system_tag), `hard fell on ${wd}`);
  }
});

test("week plan: never two consecutive hard days on the same system", () => {
  const w = buildWeekPlan(ctx(), "green");
  for (let i = 1; i < w.length; i++) {
    if (isHard(w[i].system_tag) && isHard(w[i - 1].system_tag)) {
      assert.notEqual(fam(w[i].system_tag), fam(w[i - 1].system_tag), `two ${fam(w[i].system_tag)} hard in a row`);
    }
  }
});

test("week plan: declared event is anchored (not overwritten), and does NOT trigger a taper", () => {
  const w = buildWeekPlan(ctx({
    declared_events: [{ ref: "e1", day_offset: 5, sport: "alpinism", title: "Sortie AD+", is_key: true,
      estimated_load: { aerobic: 200, neuro: 150 }, forecast: { tsb: 3, tsb_aerobic: 4, tsb_neuromuscular: 1 } }],
  }), "green");
  assert.equal(w[5].anchors_event_ref, "e1");
  assert.equal(w[5].is_key, true);
  assert.equal(w[5].target_load, 350); // event keeps its estimated load (never tapered/rescaled)
});

test("taper (F4): a primary GOAL within 14 d lightens volume but KEEPS one short aerobic quality", () => {
  const hard = (w: WeekDay[]) => w.filter((d) => d.system_tag.startsWith("hard")).length;
  const base = buildWeekPlan(ctx(), "green");                                              // no goal
  const near = buildWeekPlan(ctx({ goals: [{ title: "Course A", rank: 1, days_to: 3 }] }), "green"); // J-3
  assert.ok(hard(base) >= 1, "without a goal, the week has a quality day");
  // Intensity maintained: at most ONE quality day in the taper (hardCap=1), and it's AEROBIC (eccentric cut).
  assert.ok(hard(near) <= 1, "taper keeps at most one quality day");
  assert.ok(!near.some((d) => d.system_tag === "hard_neuromuscular" || d.system_tag === "hard_structural"),
    "taper cuts generated eccentric/structural work so legs/tendons arrive fresh");
  // Volume is scaled down (exponential factor < 1) on the non-anchored days.
  const easyBase = base.find((d) => d.system_tag === "easy");
  const easyNear = near.find((d) => d.system_tag === "easy");
  if (easyBase && easyNear) assert.ok(easyNear.target_load < easyBase.target_load, "taper lowers easy-day load");
});

test("taper (F4): exponential — earlier / larger volume cut than the old linear ramp", () => {
  const easyLoad = (daysTo: number | null) => {
    const w = daysTo == null ? buildWeekPlan(ctx(), "green")
      : buildWeekPlan(ctx({ goals: [{ title: "G", rank: 1, days_to: daysTo }] }), "green");
    const e = w.find((d) => d.system_tag === "easy");
    return e ? e.target_load : null;
  };
  const base = easyLoad(null)!, j10 = easyLoad(10)!, j3 = easyLoad(3)!;
  assert.ok(j10 < base && j3 < j10, "volume drops with proximity (front-loaded)");
  // Exponential factor at J-10 ≈ 0.74 (vs old linear 0.86) → easy load ≈ 0.74×base.
  assert.ok(Math.abs(j10 / base - 0.735) < 0.05, `J-10 factor ~0.74, got ${(j10 / base).toFixed(2)}`);
});

test("readiness (F5): ACWR amber only when high AND load rising AND TSB not negative", () => {
  // Fresh form (tsb +2), ACWR 1.38, load rising → orthogonal vigilance → AMBER (old logic = green).
  assert.equal(computeReadiness(ctx({
    fitness_model_latest: { ctl: 50, atl: 60, tsb: 2, tsb_neuromuscular: 1, acwr: 1.38 }, daily_load_21d: RISING,
  })), "amber");
  // Same ratio but load NOT rising → stays green (no flicker on a stable 1.38).
  assert.equal(computeReadiness(ctx({
    fitness_model_latest: { ctl: 50, atl: 60, tsb: 2, tsb_neuromuscular: 1, acwr: 1.38 }, daily_load_21d: FLAT,
  })), "green");
  // Neuro ACWR IGNORED when ctl_neuromuscular is below the reliability floor (small-denominator noise).
  assert.equal(computeReadiness(ctx({
    fitness_model_latest: { ctl: 50, tsb: 2, tsb_neuromuscular: 1, ctl_neuromuscular: 5, atl_neuromuscular: 20, acwr: 1.0 },
    daily_load_21d: RISING,
  })), "green");
  // Neuro ACWR ARMED when ctl_neuromuscular ≥ floor and ratio > 1.3 + rising.
  assert.equal(computeReadiness(ctx({
    fitness_model_latest: { ctl: 50, tsb: 2, tsb_neuromuscular: 1, ctl_neuromuscular: 15, atl_neuromuscular: 22, acwr: 1.0 },
    daily_load_21d: RISING,
  })), "amber");
});

test("sport (#1): quality = goal sport, easy/recovery = base run, rest = no sport (not all rando)", () => {
  // Base-phase volume is rando (hiking most frequent) but the goal is trail.
  const w = buildWeekPlan(ctx({
    favourite_sports: ["hiking", "running"],
    primary_goal: { sport: "trail_running", rank: 1 },
  }), "green");
  for (const d of w.filter((x) => !x.anchors_event_ref)) {
    if (d.system_tag === "rest") assert.equal(d.sport_code, "", "rest → no sport icon");
    else if (d.system_tag === "easy" || d.system_tag === "recovery")
      assert.equal(d.sport_code, "running", "easy/recovery → running (base), not rando/trail");
    else assert.equal(d.sport_code, "trail_running", "quality/structural → the goal sport (trail)");
  }
  // Fallback when the goal carries no sport: quality falls back to the most-frequent sport…
  const w2 = buildWeekPlan(ctx({ favourite_sports: ["hiking"], primary_goal: { rank: 1 } }), "green");
  const hard2 = w2.find((d) => d.system_tag.startsWith("hard"));
  assert.equal(hard2?.sport_code, "hiking", "no goal sport → quality falls back to most-frequent");
  // …but easy/recovery still read as a flat run, and rest still has no sport.
  assert.ok(w2.filter((d) => d.system_tag === "easy" || d.system_tag === "recovery").every((d) => d.sport_code === "running"));
  assert.ok(w2.filter((d) => d.system_tag === "rest").every((d) => d.sport_code === ""));
});

// ── Périodisation (Q15/Q17) ───────────────────────────────────────────────────────────────────────
test("phases: bornes rétro-comptées depuis l'objectif (taper/peak/build/base), inertes sans date", () => {
  assert.equal(phaseFromDaysTo(null).phase, "none");
  assert.equal(phaseFromDaysTo(-1).phase, "none");
  assert.equal(phaseFromDaysTo(10).phase, "taper");   // ≤14 j
  assert.equal(phaseFromDaysTo(20).phase, "peak");    // S−3
  assert.equal(phaseFromDaysTo(35).phase, "peak");    // S−5 (dernière semaine de peak)
  assert.equal(phaseFromDaysTo(36).phase, "build");   // S−6 (première semaine côté course du build)
  assert.equal(phaseFromDaysTo(91).phase, "build");   // S−13 (build max 8 sem)
  assert.equal(phaseFromDaysTo(92).phase, "base");    // S−14 → base
});

test("phases: cadence de décharge — 2:1 en build (S−6, S−9 déchargées), 3:1 en base (S−14, S−18)", () => {
  // Build : la DERNIÈRE semaine du bloc (avant peak) est une décharge, puis rétro-compte 2 charges/1 décharge.
  assert.equal(phaseFromDaysTo(36).isDeload, true);   // S−6 → décharge (on encaisse avant d'affûter)
  assert.equal(phaseFromDaysTo(43).isDeload, false);  // S−7 → charge (semaine 2/3)
  assert.equal(phaseFromDaysTo(50).isDeload, false);  // S−8 → charge (semaine 1/3)
  assert.equal(phaseFromDaysTo(57).isDeload, true);   // S−9 → décharge
  assert.equal(phaseFromDaysTo(50).weekInCycle, 1);
  assert.equal(phaseFromDaysTo(43).weekInCycle, 2);
  assert.equal(phaseFromDaysTo(36).weekInCycle, 3);
  // Base : 3:1.
  assert.equal(phaseFromDaysTo(92).isDeload, true);    // S−14 (dernière de base)
  assert.equal(phaseFromDaysTo(99).isDeload, false);   // S−15
  assert.equal(phaseFromDaysTo(120).isDeload, true);   // S−18
});

test("phases: semaine de décharge → volume −35 % sur les jours générés + une seule qualité", () => {
  const charge = buildWeekPlan(ctx({ goals: [{ title: "G", rank: 1, days_to: 50 }] }), "green"); // S−8 charge
  const deload = buildWeekPlan(ctx({ goals: [{ title: "G", rank: 1, days_to: 57 }] }), "green"); // S−9 décharge
  assert.ok(deload.filter((d) => isHard(d.system_tag)).length <= 1, "décharge : au plus 1 séance dure");
  const easyDeload = deload.find((d) => d.system_tag === "easy");
  assert.ok(easyDeload && easyDeload.target_load === Math.round(42 * PHASE_PARAMS.deload_factor),
    `easy déchargé = 42×${PHASE_PARAMS.deload_factor}, obtenu ${easyDeload?.target_load}`);
  // Et la rampe ne s'applique PAS en décharge (les easy ne sont jamais regonflés).
  const easyCharge = charge.find((d) => d.system_tag === "easy");
  assert.ok(easyCharge && easyDeload && easyDeload.target_load < easyCharge.target_load);
});

test("phases: rampe de CTL en semaine de charge — les jours easy montent (bornés), la qualité ne bouge pas", () => {
  const none = buildWeekPlan(ctx(), "green");                                                    // pas d'objectif
  const charge = buildWeekPlan(ctx({ goals: [{ title: "G", rank: 1, days_to: 50 }] }), "green"); // build charge
  const easyNone = none.find((d) => d.system_tag === "easy")!;
  const easyCharge = charge.find((d) => d.system_tag === "easy")!;
  // ctl 45 → cible hebdo ≈ 7×(45+6.51×4) ≈ 497 ≫ semaine type → facteur borné à +35 %.
  assert.equal(easyCharge.target_load, Math.round(42 * PHASE_PARAMS.ramp_scale_max));
  assert.ok(easyCharge.target_load > easyNone.target_load, "la charge passe par le volume easy");
  const hardLoads = (w: WeekDay[]) => w.filter((d) => isHard(d.system_tag)).map((d) => d.target_load);
  assert.deepEqual(hardLoads(charge), hardLoads(none), "une séance de qualité reste une séance de qualité");
});

test("phases: base = volume, 1 seule séance dure générée par semaine", () => {
  const w = buildWeekPlan(ctx({ goals: [{ title: "G", rank: 1, days_to: 99 }] }), "green"); // base, charge
  assert.equal(w.filter((d) => isHard(d.system_tag)).length, PHASE_PARAMS.base_hard_cap);
});

test("phases: le briefing situe la semaine (state_assessment) et l'étiquette FR est cohérente", () => {
  const b = buildAlgorithmicBriefing(ctx({ goals: [{ title: "Roubion", rank: 1, days_to: 50 }] }));
  assert.match(b.state_assessment, /^Phase build \(S−8 · semaine 1\/3 du bloc — on charge\)\./);
  const s = phaseSummaryFr(phaseFromDaysTo(36));
  assert.equal(s?.name, "build");
  assert.match(s!.detail, /décharge/);
  assert.equal(phaseSummaryFr(phaseFromDaysTo(null)), null);
});

// ── Fenêtres de contrainte (Upgrade 10) — la vraie vie re-cadre les phases ───────────────────────
// ctx.today = 2026-06-25 (jeudi). Fenêtre « Bordeaux » : cas réel de l'athlète (déplacement, plat).
const BX = (over: Partial<TrainingWindow> = {}): TrainingWindow => ({
  starts_on: "2026-06-28", ends_on: "2026-07-10", label: "Déplacement Bordeaux",
  effect: "auto", no_mountains: true, ...over,
});

test("fenêtres: effet auto = décharge si capacité réduite ≥ 5 j, sinon entretien ; l'explicite gagne", () => {
  assert.equal(resolveWindowEffect(BX()), "deload");                                    // plat, 13 j
  assert.equal(resolveWindowEffect(BX({ ends_on: "2026-06-30" })), "maintain");         // plat mais court (3 j)
  assert.equal(resolveWindowEffect(BX({ no_mountains: false })), "maintain");           // long mais sans contrainte
  assert.equal(resolveWindowEffect(BX({ effect: "charge" })), "charge");                // intention explicite
});

test("fenêtres: la décharge calendaire est REPORTÉE sur une fenêtre décharge proche (on charge avant)", () => {
  // days_to 36 → S−6 = semaine de décharge calendaire… mais une fenêtre décharge démarre dans 3 j.
  const c = ctx({ goals: [{ title: "G", rank: 1, days_to: 36 }], training_windows: [BX()] });
  const eff = effectivePhase(c);
  assert.equal(eff.isDeload, false, "décharge calendaire annulée");
  assert.equal(eff.deloadMovedTo, "Déplacement Bordeaux");
  assert.match(phaseSummaryFr(eff)!.detail, /décharge reportée/);
  assert.match(phaseMarkFr(eff)!, /décharge reportée/);
  // Sans la fenêtre, la même semaine serait bien déchargée (sanity).
  assert.equal(effectivePhase(ctx({ goals: [{ title: "G", rank: 1, days_to: 36 }] })).isDeload, true);
});

test("fenêtres: avant une fenêtre terrain plat, les qualités « mangent du D+ » ; pendant, seuil sur plat", () => {
  const w = buildWeekPlan(ctx({ training_windows: [BX()] }), "green"); // fenêtre à J+3 (offsets 3..6 couverts)
  const before = w.filter((d) => d.day_offset < 3 && isHard(d.system_tag));
  const during = w.filter((d) => d.day_offset >= 3);
  assert.ok(before.length >= 1, "au moins une qualité avant le départ");
  assert.ok(before.every((d) => d.system_tag === "hard_neuromuscular"), "les qualités d'avant ciblent le dénivelé");
  assert.ok(during.every((d) => d.system_tag !== "hard_neuromuscular" && d.system_tag !== "hard_structural"),
    "aucune côtes/force générée dans la fenêtre");
  assert.ok(during.filter((d) => isHard(d.system_tag)).length <= 1, "une seule qualité max dans la fenêtre");
  // Terrain plat : même la qualité se court sur le plat (running), pas le sport montagne.
  assert.ok(during.filter((d) => d.system_tag !== "rest").every((d) => d.sport_code === "running"));
  // Volume des jours easy dans la fenêtre : réduit (décharge ×0.65), pas regonflé par la rampe.
  const easyIn = during.find((d) => d.system_tag === "easy");
  if (easyIn) assert.equal(easyIn.target_load, Math.round(42 * PHASE_PARAMS.deload_factor));
});

test("fenêtres: aujourd'hui DANS la fenêtre → le chip/le bilan la nomment, même sans objectif daté", () => {
  const c = ctx({ today: "2026-07-01", training_windows: [BX()] });
  const eff = effectivePhase(c);
  assert.equal(eff.window?.effect, "deload");
  const s = phaseSummaryFr(eff)!;
  assert.equal(s.name, "contrainte"); // pas d'objectif daté → la fenêtre porte seule le libellé
  assert.match(s.detail, /Déplacement Bordeaux/);
  assert.match(s.detail, /terrain plat/);
  const b = buildAlgorithmicBriefing(c);
  assert.match(b.state_assessment, /Déplacement Bordeaux/);
});

test("fenêtres: en semaine de charge, la rampe ne regonfle QUE les easy hors fenêtre", () => {
  // Build charge (days_to 50) + fenêtre décharge couvrant la fin de semaine.
  const w = buildWeekPlan(ctx({ goals: [{ title: "G", rank: 1, days_to: 50 }], training_windows: [BX()] }), "green");
  const easyOut = w.find((d) => d.day_offset < 3 && d.system_tag === "easy");
  const easyIn = w.find((d) => d.day_offset >= 3 && d.system_tag === "easy");
  if (easyOut) assert.equal(easyOut.target_load, Math.round(42 * PHASE_PARAMS.ramp_scale_max), "hors fenêtre : rampe");
  if (easyIn) assert.equal(easyIn.target_load, Math.round(42 * PHASE_PARAMS.deload_factor), "dans la fenêtre : décharge");
  assert.ok(easyOut || easyIn, "au moins un jour easy à vérifier");
});

test("targetLoadFor: default when no history, personalised baseline when present", () => {
  assert.equal(targetLoadFor("hard_aerobic"), 72);                                   // no ctx → default
  assert.equal(targetLoadFor("easy"), 42);
  assert.equal(targetLoadFor("rest"), 0);
  assert.equal(targetLoadFor("hard_aerobic", { session_baselines: {} }), 72);        // empty bucket → default
  assert.equal(targetLoadFor("hard_aerobic", { session_baselines: { hard_aerobic: 88 } }), 88); // personalised wins
  assert.equal(targetLoadFor("rest", { session_baselines: { rest: 99 } } as any), 0); // rest is always 0
});

test("target loads: rest is 0, others positive and ordered", () => {
  assert.equal(targetLoadFor("rest", ctx()), 0);
  assert.ok(targetLoadFor("easy", ctx()) > 0);
  assert.ok(targetLoadFor("hard_aerobic", ctx()) > targetLoadFor("easy", ctx()));
});

test("full briefing: shape + today detail carries the Garmin Z-band", () => {
  const b = buildAlgorithmicBriefing(ctx({ recovery_today: { available: true, training_readiness: 40 } })); // amber → today recovery (Z2)
  assert.equal(b.readiness, "amber");
  assert.equal(b.week_plan.length, 7);
  assert.ok(b.detailed_sessions.length >= 1);
  assert.equal(b.detailed_sessions[0].day_offset, 0);
  assert.equal(b.detailed_sessions[0].intensity_zone, "Z2");
  assert.equal(b.detailed_sessions[0].target_hr_low, 116);
  assert.equal(b.detailed_sessions[0].target_hr_high, 135);
  assert.ok(typeof b.why === "string" && b.why.length > 0);
  assert.ok(typeof b.state_assessment === "string" && b.state_assessment.length > 0);
  assert.ok(b.confidence >= 0 && b.confidence <= 1);
});

test("anchored today (pinned session) uses the pinned title — not a generic template", () => {
  const b = buildAlgorithmicBriefing(ctx({
    pinned_sessions: [{ ref: "p1", day_offset: 0, sport: "trail_running", title: "Trail facile 40 min — ce soir",
      system_tag: "easy", target_load: 84, is_key: false }],
  }));
  assert.equal(b.week_plan[0].focus, "Trail facile 40 min — ce soir");
  assert.equal(b.detailed_sessions[0].title, "Trail facile 40 min — ce soir");
  assert.equal(b.week_plan[0].anchors_event_ref, null); // pinned → skipped via pinnedDates, not anchors_event_ref
  assert.ok(/validée/.test(b.why));
});

test("anchored today (declared event) uses the event title for today_session", () => {
  const b = buildAlgorithmicBriefing(ctx({
    declared_events: [{ ref: "e1", day_offset: 0, sport: "alpinism", title: "Course alpi AD+", is_key: true,
      estimated_load: { aerobic: 200, neuro: 150 } }],
  }));
  assert.equal(b.week_plan[0].focus, "Course alpi AD+");
  assert.equal(b.detailed_sessions[0].title, "Course alpi AD+");
  assert.equal(b.week_plan[0].anchors_event_ref, "e1");
});

test("full briefing: missing Garmin recovery raises a flag", () => {
  const b = buildAlgorithmicBriefing(ctx({ recovery_today: { available: false, missing: ["sommeil", "VFC (HRV)"] } }));
  assert.ok(b.flag && /Garmin/i.test(b.flag));
});

/** today + offset → YYYY-MM-DD (UTC), local helper to avoid importing date utils into the test surface. */
function dateOf(today: string, off: number): string {
  return new Date(Date.parse(today + "T00:00:00Z") + off * 86_400_000).toISOString().slice(0, 10);
}
