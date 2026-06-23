/** Chart / inline-SVG colours, named by MEANING.
 *  The values live in globals.css (`@theme`) as CSS custom properties — this module only
 *  references them so SVG `fill`/`stroke` and the colour-coded gauges share one source of truth
 *  (and follow the dark-mode overrides automatically). Never hard-code hex in components.
 *
 *  Principle: colour encodes physiology, never sport category. See docs/DESIGN_SYSTEM.md. */

/** The two load channels / fitness poles. */
export const VIZ = {
  aerobic: "var(--color-aerobic)", // blue  — aerobic channel, CTL (fitness), "fresh"
  neuro: "var(--color-neuro)",     // orange— neuromuscular channel, ATL (fatigue)
} as const;

/** Readiness / state ramp (traffic light + two extra stops for multi-zone gauges). */
export const STATE = {
  ready: "var(--color-ready)",            // green  — fresh / ideal / good
  caution: "var(--color-caution)",        // amber  — productive fatigue / borderline
  cautionSoft: "var(--color-caution-soft)", // yellow — mid step of the recovery ramp
  rest: "var(--color-rest)",              // red    — overload / risk / poor
  neutral: "var(--color-stone-400)",      // grey   — balance / baseline
  cool: "var(--color-alpine-400)",        // blue   — ACWR under-load
} as const;

/** Axis lines, baselines, muted fallbacks. */
export const AXIS = "var(--color-stone-400)";
export const MUTED = "var(--color-stone-500)";

/** Categorical palette for distinguishing SPORTS in composition charts — a scoped exception to the
 *  "sports are never coloured" rule (the user asked for legible per-sport colours). Disjoint from the
 *  Alpine/Summit physiology hues so it can't be misread as a load channel. Index by sport rank. */
export const SERIES = [
  "var(--color-series-1)", "var(--color-series-2)", "var(--color-series-3)", "var(--color-series-4)",
  "var(--color-series-5)", "var(--color-series-6)", "var(--color-series-7)", "var(--color-series-8)",
] as const;

/** Period A/B convention (period is not a physiology → neutral): B = bold ink, A = muted stone. */
export const PERIOD = {
  a: "var(--color-stone-400)",
  b: "var(--color-ink)",
} as const;
