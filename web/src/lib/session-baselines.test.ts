/** Unit tests for the personalised session-load baselines. Run: `npx tsx --test src/lib/session-baselines.test.ts` */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, computeSessionBaselines } from "./session-baselines";

test("classify: intensity (IF) + neuromuscular fraction", () => {
  assert.equal(classify({ training_load: 75, aerobic_load: 68, neuromuscular_load: 7, intensity_factor: 0.9 }), "hard_aerobic");
  assert.equal(classify({ training_load: 45, aerobic_load: 38, neuromuscular_load: 7, intensity_factor: 0.7 }), "easy");
  assert.equal(classify({ training_load: 22, aerobic_load: 20, neuromuscular_load: 2, intensity_factor: 0.5 }), "easy"); // low-IF endurance → easy (recovery is a fixed light dose)
  assert.equal(classify({ training_load: 80, aerobic_load: 36, neuromuscular_load: 44, intensity_factor: 0.5 }), "hard_neuromuscular"); // nf 0.55
  assert.equal(classify({ training_load: 100, aerobic_load: 20, neuromuscular_load: 80, intensity_factor: 0.5 }), "hard_structural"); // nf 0.80
  assert.equal(classify({ training_load: 3, aerobic_load: 2, neuromuscular_load: 1, intensity_factor: 0.6 }), null); // noise
  assert.equal(classify({ training_load: 50, aerobic_load: 45, neuromuscular_load: 5, intensity_factor: null }), "easy"); // no IF → easy
});

test("computeSessionBaselines: median per bucket, needs ≥3 samples", () => {
  const acts = [
    { training_load: 70, aerobic_load: 64, neuromuscular_load: 6, intensity_factor: 0.88 },
    { training_load: 75, aerobic_load: 68, neuromuscular_load: 7, intensity_factor: 0.9 },
    { training_load: 80, aerobic_load: 72, neuromuscular_load: 8, intensity_factor: 0.85 },
    { training_load: 40, aerobic_load: 34, neuromuscular_load: 6, intensity_factor: 0.7 }, // only 2 easy
    { training_load: 50, aerobic_load: 42, neuromuscular_load: 8, intensity_factor: 0.72 },
  ];
  const b = computeSessionBaselines(acts);
  assert.equal(b.hard_aerobic, 75);     // median of 70/75/80
  assert.equal(b.easy, undefined);      // 2 samples → omitted (caller keeps the default)
});

test("computeSessionBaselines: empty input → empty (new user keeps defaults)", () => {
  assert.deepEqual(computeSessionBaselines([]), {});
});
