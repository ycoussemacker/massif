/** French display labels shared by the dashboard and the coach chat.
 *  system_tag / sport_code stay English identifiers in the DB (enums / codes) — translated here only
 *  for display. Keep this the single source of truth (was inline in page.tsx). */
import { STRUCTURAL_EFFORT_GROUPS, IMPACT_FRAC, DESCENT_LOAD_PER_1000M } from "./load";

export const READINESS = {
  green: { dot: "bg-emerald-500", label: "Prêt", text: "text-emerald-700 dark:text-emerald-400" },
  amber: { dot: "bg-amber-500", label: "Prudence", text: "text-amber-700 dark:text-amber-400" },
  red: { dot: "bg-red-500", label: "Repos", text: "text-red-700 dark:text-red-400" },
} as const;

export type Readiness = keyof typeof READINESS;

export const SYSTEM_TAG_FR: Record<string, string> = {
  rest: "repos",
  recovery: "récup",
  easy: "facile",
  hard_aerobic: "intense · aérobie",
  hard_neuromuscular: "intense · neuro",
  hard_structural: "intense · structurel",
};

// Nom FR + icône par sport (code). Repli sur le display_name pour les sports auto-créés.
export const SPORT_FR: Record<string, string> = {
  running: "Course", trail_running: "Trail", hiking: "Rando", alpinism: "Alpinisme",
  rock_climbing: "Escalade (falaise)", grande_voie: "Grande voie", bouldering: "Bloc",
  indoor_climbing: "Escalade (salle)",
  via_ferrata: "Via ferrata", cycling: "Vélo", gravel_cycling: "Gravel", mountain_biking: "VTT",
  nordic_skiing: "Ski de fond", ski_touring: "Ski de rando", downhill_skiing: "Ski piste",
  snowshoeing: "Raquettes", swimming: "Natation", surfing: "Surf", rowing: "Aviron",
  strength: "Renforcement", yoga: "Yoga & mobilité", walking: "Marche", elliptical: "Elliptique",
  kayaking: "Kayak", kitesurf: "Kitesurf", table_tennis: "Tennis de table",
  high_intensity_interval_training: "Fractionné", unknown: "Autre",
};

export const SPORT_ICON: Record<string, string> = {
  running: "🏃", trail_running: "⛰️", hiking: "🥾", alpinism: "🧗", rock_climbing: "🧗",
  grande_voie: "🧗", bouldering: "🪨", indoor_climbing: "🧗", via_ferrata: "🪜", cycling: "🚴", gravel_cycling: "🚴",
  mountain_biking: "🚵", nordic_skiing: "🎿", ski_touring: "🎿", downhill_skiing: "⛷️",
  snowshoeing: "🥾", swimming: "🏊", surfing: "🏄", rowing: "🚣", strength: "🏋️", yoga: "🧘",
  walking: "🚶", elliptical: "🌀", kayaking: "🛶", kitesurf: "🪁", table_tennis: "🏓",
  high_intensity_interval_training: "🔥", unknown: "🏅",
};

// Regroupement FR des sports par famille physiologique (taxonomy_group) — pour ranger les chips
// de filtre en sections lisibles plutôt qu'en mur de boutons. L'ordre fixe l'affichage.
export const TAXONOMY_FR: Record<string, string> = {
  paced_endurance: "Endurance",
  mountain_vertical: "Montagne",
  mountain_technical: "Montagne technique",
  technical_strength: "Grimpe & technique",
  resistance: "Force",
  aquatic: "Eau",
  other: "Autres",
};
export const TAXONOMY_ORDER = [
  "paced_endurance", "mountain_vertical", "mountain_technical", "technical_strength", "resistance", "aquatic", "other",
] as const;

/** Plain-FR SOURCE of the aerobic channel, derived from load_method_used — i.e. how the cardiac cost
 *  was measured (and thus how much to trust it). "estimé" = no HR/power, a rougher duration-based guess. */
export function aerobicSourceFr(method: string | null | undefined): string {
  switch (method) {
    case "tss": return "puissance";
    case "hrtss": return "FC";
    case "rtss": return "allure";
    case "session_rpe": return "RPE";
    case "vertical_duration":
    case "duration_fallback": return "estimé";
    default: return "—";
  }
}

/** Plain-FR dominant DRIVER of the neuromuscular channel (what physically produced it): the eccentric
 *  descent, the foot-strike impact, or — for climbing/strength — the muscular/CNS effort (sRPE). The
 *  descent-vs-impact comparison mirrors load.py's terms (same IMPACT_FRAC / DESCENT_LOAD_PER_1000M). */
export function neuroSourceFr(a: {
  taxonomy_group: string | null;
  aerobic_load: number | null;
  vertical_loss_m: number | null;
  carried_load_kg?: number | null;
}): string {
  if (a.taxonomy_group && STRUCTURAL_EFFORT_GROUPS.has(a.taxonomy_group)) return "effort";
  const descent = ((a.vertical_loss_m ?? 0) / 1000) * DESCENT_LOAD_PER_1000M;
  const impact = (a.aerobic_load ?? 0) * (IMPACT_FRAC[a.taxonomy_group ?? "other"] ?? IMPACT_FRAC.other);
  if (descent > 0 && descent >= impact) {
    return (a.carried_load_kg ?? 0) > 0 ? "descente + port" : "descente";
  }
  return "impact";
}

/** FR sport name from a code, falling back to the DB display_name. */
export function sportName(code: string | null | undefined, fallback: string): string {
  return code ? (SPORT_FR[code] ?? fallback) : fallback;
}

/** Sport emoji from a code (generic medal fallback). */
export function sportIcon(code: string | null | undefined): string {
  return code ? (SPORT_ICON[code] ?? "🏅") : "🏅";
}
