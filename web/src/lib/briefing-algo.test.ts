/** Unit tests for the algorithmic briefing engine (LLM-free). Run: `npx tsx --test src/lib/briefing-algo.test.ts`
 *  Excluded from the Next build via tsconfig "exclude". Deterministic — this is the token-free verification. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { frWeekday } from "./briefing-shared";
import {
  buildAlgorithmicBriefing, computeReadiness, buildWeekPlan, targetLoadFor, type SystemTag, type WeekDay,
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

test("week plan: declared event is anchored (not overwritten) + eve is tapered", () => {
  const w = buildWeekPlan(ctx({
    declared_events: [{ ref: "e1", day_offset: 5, sport: "alpinism", title: "Sortie AD+", is_key: true,
      estimated_load: { aerobic: 200, neuro: 150 }, forecast: { tsb: 3, tsb_aerobic: 4, tsb_neuromuscular: 1 } }],
  }), "green");
  assert.equal(w[5].anchors_event_ref, "e1");
  assert.equal(w[5].is_key, true);
  assert.equal(w[5].target_load, 350);
  assert.ok(!isHard(w[4].system_tag), "eve of a key event must not be hard (taper)");
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
