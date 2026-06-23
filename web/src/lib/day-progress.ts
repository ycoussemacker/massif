/** Day-progress classification — a PURE, **LLM-free** comparison of today's actual training load
 *  against the load the coach recommended for today (planned_sessions.target_load). It returns only the
 *  FACTS (status + numbers + a session suggestion); the coach-voice copy lives in coach-voice.ts.
 *
 *  Bands are symmetric ±50 % around the target ("did I hit my number?"): below 50 % of target = under,
 *  within ±50 % = reached, above 150 % = over. Rest days (coach tagged rest, or target ≈ 0) get a
 *  "did you actually rest?" verdict instead. Kept free of JSX/I-O so it stays testable. */

export type DayStatus = "reached" | "below" | "above" | "rest_kept" | "rest_broken";
export type SuggestionSize = "big" | "normal" | "light";

export type DaySuggestion = {
  size: SuggestionSize;
  sportCode: string | null; // a favourite sport ≠ today's, or null when none can be picked
  gap: number;              // points still needed to reach the target
};

export type DayProgress = {
  status: DayStatus;
  actual: number;           // rounded points done today
  target: number;           // rounded coach target (0 on a rest day)
  overPct: number;          // % above target (0 unless `above`)
  suggestion: DaySuggestion | null; // set only for `below`
};

const REST_TARGET_MAX = 10; // a recommended load this low (or null) reads as a rest day
const BELOW = 0.5;          // actual < 50 % of target  → under
const ABOVE = 1.5;          // actual > 150 % of target → over

type SportRow = { local_date?: string; sport_code: string | null; training_load?: number | null };

/** Sport codes trained on `today` (deduped; excludes unknown/null). */
export function todaySportCodes(activities: SportRow[], today: string): Set<string> {
  return new Set(
    activities
      .filter((a) => a.local_date === today && a.sport_code && a.sport_code !== "unknown")
      .map((a) => a.sport_code as string),
  );
}

/** Favourite sports ranked by how often they appear in the supplied history (most-frequent first;
 *  excludes unknown/null) — so a suggestion lands on something the athlete actually likes doing. */
export function rankedFavorites(activities: SportRow[]): string[] {
  const count = new Map<string, number>();
  for (const a of activities) {
    const c = a.sport_code;
    if (!c || c === "unknown") continue;
    count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c);
}

/** The sport that carried the most load today (the "session" the coach references), or null. */
export function dominantTodaySportCode(activities: SportRow[], today: string): string | null {
  let best: string | null = null;
  let bestLoad = -1;
  for (const a of activities) {
    if (a.local_date !== today || !a.sport_code || a.sport_code === "unknown") continue;
    const l = a.training_load ?? 0;
    if (l > bestLoad) { bestLoad = l; best = a.sport_code; }
  }
  return best;
}

/** Compare today's load to the coach's recommendation. Returns null when there's nothing to compare
 *  against (the coach hasn't planned today). */
export function computeDayProgress(opts: {
  hasPlan: boolean;          // a coach-planned session exists for today
  target: number | null;     // summed coach target_load for today
  isRest: boolean;           // coach tagged today's session 'rest'
  actual: number;            // points done today (sum of today's activities)
  avgLoad: number | null;    // typical points/session (the "normal séance" reference)
  todaySports: Set<string>;
  favorites: string[];
}): DayProgress | null {
  const { hasPlan, target, isRest, avgLoad, todaySports, favorites } = opts;
  if (!hasPlan) return null;
  const actual = Math.round(opts.actual);

  // Rest day — judge "did you actually rest?" instead of dividing by a (near-)zero target.
  if (isRest || target == null || target < REST_TARGET_MAX) {
    const restKeptMax = Math.max(REST_TARGET_MAX, 0.25 * (avgLoad ?? 0));
    return {
      status: actual <= restKeptMax ? "rest_kept" : "rest_broken",
      actual, target: 0, overPct: 0, suggestion: null,
    };
  }

  const t = target;
  const ratio = actual / t;

  if (ratio < BELOW) {
    const gap = Math.max(0, Math.round(t - actual));
    const ref = avgLoad && avgLoad > 0 ? avgLoad : t; // a "normal" session for this athlete
    const size: SuggestionSize = gap >= 1.3 * ref ? "big" : gap >= 0.6 * ref ? "normal" : "light";
    const sportCode = favorites.find((c) => !todaySports.has(c)) ?? favorites[0] ?? null;
    return { status: "below", actual, target: Math.round(t), overPct: 0, suggestion: { size, sportCode, gap } };
  }

  if (ratio > ABOVE) {
    return { status: "above", actual, target: Math.round(t), overPct: Math.round((ratio - 1) * 100), suggestion: null };
  }

  return { status: "reached", actual, target: Math.round(t), overPct: 0, suggestion: null };
}
