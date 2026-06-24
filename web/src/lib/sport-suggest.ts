/** Keyword detection that a logged activity is probably MIS-categorised — typically a climbing / alpinism
 *  / grande-voie outing logged as "Rando" (hiking) because Strava offers no such type. Returns the
 *  suggested sport code + its FR label + the matched keyword, or null.
 *
 *  CONSERVATIVE by design: only fires when the CURRENT sport is one of the catch-all defaults the athlete
 *  falls back to (hiking / walking / unknown) AND a strong keyword matches the title (and optionally the
 *  description), so a correctly-labelled trail run is never second-guessed. The athlete always validates —
 *  this only proposes. Pure + client-safe (one import: the FR labels). Keep the keyword set aligned with
 *  strava.py `_climbing_sport_code` and lib/event-parse.ts `SPORT_SYNONYMS`. */
import { SPORT_FR } from "./labels";

// The only sports we second-guess: the generic defaults used when Strava lacks the right type.
const DEFAULTABLE = new Set(["hiking", "walking", "unknown"]);

// Ordered — first match wins. 'grande voie' before the generic alpi/climbing terms (it contains "voie"
// but is its own sport); via ferrata before alpinism. Patterns are matched on accent-stripped lowercase.
const RULES: { code: string; re: RegExp }[] = [
  { code: "grande_voie", re: /\bgrande[s]? ?voie[s]?\b|\bmulti[- ]?pitch\b|\bgv\b/ },
  { code: "via_ferrata", re: /\bvia[- ]?ferrata\b|\bferrata\b/ },
  {
    code: "alpinism",
    re: /\balpi(nisme)?\b|\barete\b|\bcouloir\b|\bgoulotte\b|\bcascade de glace\b|\bcrampons?\b|\bpiolet\b|\bencorde[e]?\b|\bvoie normale\b|\bcourse de montagne\b/,
  },
  { code: "bouldering", re: /\bbloc\b|\bboulder\b/ },
  { code: "rock_climbing", re: /\bfalaise\b|\bcouenne\b|\bcrag\b/ },
];

export type SportSuggestion = { code: string; label: string; matched: string };

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function suggestSport(
  currentSportCode: string | null | undefined,
  name: string | null | undefined,
  description?: string | null,
): SportSuggestion | null {
  if (!currentSportCode || !DEFAULTABLE.has(currentSportCode)) return null;
  const text = stripAccents(`${name ?? ""} ${description ?? ""}`).toLowerCase();
  if (!text.trim()) return null;
  for (const { code, re } of RULES) {
    if (code === currentSportCode) continue;
    const m = text.match(re);
    if (m) return { code, label: SPORT_FR[code] ?? code, matched: m[0].trim() };
  }
  return null;
}
