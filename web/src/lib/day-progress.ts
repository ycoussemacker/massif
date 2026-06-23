/** Day-progress nudge — a PURE, **LLM-free** comparison of today's actual training load against the
 *  load the coach recommended for today (planned_sessions.target_load). It classifies the day as under /
 *  on / over the coach's target (or returns a rest-day verdict), and — when under — suggests how big a
 *  session to add and in which favourite sport. All copy is pre-built French templates (no token spend).
 *
 *  Bands are symmetric ±50 % around the target ("did I hit my number?"): below 50 % of target = under,
 *  within ±50 % = reached, above 150 % = over. Kept free of JSX/I-O so it stays testable and the banner
 *  component (<DayProgress>) is a thin renderer. */
import type { Activity } from "./data";

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
  overPct: number | null;   // % above target — only meaningful for "above"
  title: string;
  body: string;
  suggestion: DaySuggestion | null; // set only for "below"
};

const REST_TARGET_MAX = 10; // a recommended load this low (or null) reads as a rest day
const BELOW = 0.5;          // actual < 50 % of target  → under
const ABOVE = 1.5;          // actual > 150 % of target → over

/** Sport codes trained on `today` (deduped; excludes unknown/null). */
export function todaySportCodes(activities: Activity[], today: string): Set<string> {
  return new Set(
    activities
      .filter((a) => a.local_date === today && a.sport_code && a.sport_code !== "unknown")
      .map((a) => a.sport_code as string),
  );
}

/** Favourite sports ranked by how often they appear in the supplied history (most-frequent first;
 *  excludes unknown/null) — so a suggestion lands on something the athlete actually likes doing. */
export function rankedFavorites(activities: Activity[]): string[] {
  const count = new Map<string, number>();
  for (const a of activities) {
    const c = a.sport_code;
    if (!c || c === "unknown") continue;
    count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c);
}

/** Compare today's load to the coach's recommendation. Returns null when there's nothing to compare
 *  against (the coach hasn't planned today) — the banner then renders nothing. */
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
  if (!hasPlan) return null; // coach hasn't planned today → no recommendation to measure against
  const actual = Math.round(opts.actual);

  // Rest day — divide-by-(near-)zero would be meaningless, so judge "did you actually rest?" instead.
  if (isRest || target == null || target < REST_TARGET_MAX) {
    const restKeptMax = Math.max(REST_TARGET_MAX, 0.25 * (avgLoad ?? 0));
    if (actual <= restKeptMax) {
      return {
        status: "rest_kept", actual, target: 0, overPct: null,
        title: "Repos respecté",
        body: "Le coach conseillait du repos aujourd'hui, et tu l'as suivi. C'est au repos que les adaptations se consolident.",
        suggestion: null,
      };
    }
    return {
      status: "rest_broken", actual, target: 0, overPct: null,
      title: "Jour de repos entamé",
      body: `Le coach prévoyait du repos aujourd'hui — tu as déjà chargé ${actual} pts. Garde la suite légère et privilégie la récup.`,
      suggestion: null,
    };
  }

  const t = Math.round(target);
  const ratio = actual / target;

  if (ratio < BELOW) {
    const gap = Math.max(0, Math.round(target - actual));
    const ref = avgLoad && avgLoad > 0 ? avgLoad : target; // a "normal" session for this athlete
    const size: SuggestionSize = gap >= 1.3 * ref ? "big" : gap >= 0.6 * ref ? "normal" : "light";
    // A favourite the athlete hasn't already done today; fall back to the top favourite, else none.
    const sportCode = favorites.find((c) => !todaySports.has(c)) ?? favorites[0] ?? null;
    return {
      status: "below", actual, target: t, overPct: null,
      title: "Il te manque de la charge",
      body: `Tu es à ${actual} pts sur les ${t} conseillés par le coach (il en manque ~${gap}).`,
      suggestion: { size, sportCode, gap },
    };
  }

  if (ratio > ABOVE) {
    const overPct = Math.round((ratio - 1) * 100);
    return {
      status: "above", actual, target: t, overPct,
      title: "Cible dépassée",
      body: `Tu es à ${actual} pts pour ${t} conseillés (+${overPct} %). Belle séance — place maintenant au calme et à la récup pour bien encaisser la charge.`,
      suggestion: null,
    };
  }

  return {
    status: "reached", actual, target: t, overPct: null,
    title: "Objectif du jour atteint",
    body: `Tu es à ${actual} pts pour ${t} conseillés — pile dans la cible du coach. Beau travail, laisse maintenant le corps assimiler.`,
    suggestion: null,
  };
}
