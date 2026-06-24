/** Free-text → structured draft for the quick-add event flow. PURE + free (no LLM): a heuristic parser
 *  over a French sentence like "samedi grosse rando 1500 D+ avec les potes" → {date, sport, vertical, …}.
 *  Always shown to the athlete as an EDITABLE draft before saving, so a miss is harmless. An optional
 *  "améliorer avec l'IA" path can replace this later without changing the form. Client-safe (no imports). */

export type ParsedEvent = {
  date: string | null; // YYYY-MM-DD, resolved within the next ~2 weeks
  sportCode: string | null;
  title: string; // a tidy title (the raw text, trimmed)
  distanceM: number | null;
  verticalGainM: number | null;
  durationS: number | null;
  description: string | null;
};

type SportLite = { code: string; name: string };

// FR weekday keys in JS getUTCDay() order (0 = Sunday).
const WEEKDAY_KEYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** Synonyms → a canonical sport code. Resolved against the athlete's actual sports list (a synonym whose
 *  code isn't available falls through to name-matching, then to null = the athlete picks it in the form). */
const SPORT_SYNONYMS: Record<string, string> = {
  rando: "hiking", randonnee: "hiking", randonnée: "hiking", "rando montagne": "hiking", marche: "hiking",
  "ski de rando": "ski_touring", "ski-rando": "ski_touring", skirando: "ski_touring",
  "ski de randonnée": "ski_touring", "ski touring": "ski_touring", "ski de randonnee": "ski_touring",
  ski: "ski_touring",
  trail: "trail_running", "trail running": "trail_running",
  course: "running", run: "running", footing: "running", "course à pied": "running", jogging: "running",
  velo: "cycling", vélo: "cycling", bike: "cycling", "sortie vélo": "cycling", route: "cycling",
  vtt: "mountain_biking", mtb: "mountain_biking",
  escalade: "rock_climbing", grimpe: "rock_climbing", couenne: "rock_climbing", falaise: "rock_climbing",
  bloc: "bouldering", boulder: "bouldering",
  "salle d'escalade": "indoor_climbing", "salle": "indoor_climbing",
  natation: "swimming", nat: "swimming", piscine: "swimming", nage: "swimming",
  alpinisme: "alpinism", alpi: "alpinism", "course d'arête": "alpinism",
  surf: "surfing",
  muscu: "strength_training", musculation: "strength_training", renfo: "strength_training", "renforcement": "strength_training",
  yoga: "yoga",
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Next date (strictly today..today+13) whose FR weekday matches `key`. */
function nextWeekday(today: string, key: string): string | null {
  const target = WEEKDAY_KEYS.indexOf(key);
  if (target < 0) return null;
  const base = new Date(today + "T00:00:00Z");
  for (let i = 0; i <= 13; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    if (d.getUTCDay() === target) return d.toISOString().slice(0, 10);
  }
  return null;
}

function addDays(today: string, n: number): string {
  return new Date(Date.parse(today + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
}

function parseDate(textRaw: string, today: string): string | null {
  const t = stripAccents(textRaw.toLowerCase());
  if (/\bapres-demain\b/.test(t)) return addDays(today, 2);
  if (/\bdemain\b/.test(t)) return addDays(today, 1);
  if (/\baujourd'?hui\b/.test(t)) return today;
  if (/\b(ce )?week-?end\b/.test(t) || /\bweekend\b/.test(t)) return nextWeekday(today, "samedi");
  for (const key of WEEKDAY_KEYS) {
    if (key === "dimanche" || key === "samedi" ? new RegExp(`\\b${key}\\b`).test(t) : new RegExp(`\\b${key}\\b`).test(t)) {
      return nextWeekday(today, key);
    }
  }
  return null;
}

function parseSport(textRaw: string, sports: SportLite[]): string | null {
  const t = stripAccents(textRaw.toLowerCase());
  const available = new Set(sports.map((s) => s.code));
  // Synonyms first (longest key first so "ski de rando" wins over "ski"/"rando").
  const keys = Object.keys(SPORT_SYNONYMS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (new RegExp(`\\b${stripAccents(k)}\\b`).test(t)) {
      const code = SPORT_SYNONYMS[k];
      if (available.has(code)) return code;
    }
  }
  // Then the athlete's own sport display names.
  for (const s of sports) {
    const name = stripAccents(s.name.toLowerCase());
    if (name.length >= 3 && t.includes(name)) return s.code;
  }
  return null;
}

export function parseEventText(text: string, opts: { today: string; sports: SportLite[] }): ParsedEvent {
  const raw = (text ?? "").trim();
  const t = stripAccents(raw.toLowerCase());

  // Distance — explicit km only.
  const km = t.match(/(\d+(?:[.,]\d+)?)\s*km\b/);
  const distanceM = km ? Math.round(parseFloat(km[1].replace(",", ".")) * 1000) : null;

  // Vertical — "1500 d+" / "1500m d+" / a bare "1500 m" (distance is km, so bare metres read as D+).
  const dplus = t.match(/(\d{2,5})\s*m?\s*d\s*\+/) || t.match(/(\d{3,5})\s*m\b/);
  const verticalGainM = dplus ? parseInt(dplus[1], 10) : null;

  // Duration — "2h", "2h30", "90 min".
  let durationS: number | null = null;
  const hm = t.match(/(\d+)\s*h(?:\s*(\d{1,2}))?/);
  const min = t.match(/(\d+)\s*min\b/);
  if (hm) durationS = parseInt(hm[1], 10) * 3600 + (hm[2] ? parseInt(hm[2], 10) * 60 : 0);
  else if (min) durationS = parseInt(min[1], 10) * 60;

  return {
    date: parseDate(raw, opts.today),
    sportCode: parseSport(raw, opts.sports),
    title: raw.slice(0, 200),
    distanceM,
    verticalGainM,
    durationS,
    description: null,
  };
}
