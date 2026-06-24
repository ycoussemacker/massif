/** Weather — pure helpers (no deps, server + client safe). Surfaces the `daily_weather` forecast SOBERLY,
 *  only where it changes a training decision. The `weather_code` is a WMO interpretation code (Open-Meteo
 *  daily max); it MAY be null until a re-sync backfills it, so every helper degrades gracefully from the
 *  raw temp/precip/wind fields. Weather is informational CONTEXT, never a readiness/physiology signal —
 *  render it neutral (stone), never the green/amber/red state palette. */

/** Emoji glyph for a WMO weather code. When `code` is null, derive a reasonable icon from the raw fields. */
export function weatherIcon(
  code: number | null | undefined,
  fallback?: { precipMm?: number | null; windKmh?: number | null; tempMaxC?: number | null },
): string {
  if (code == null) {
    // No WMO code yet — guess from what we have (precip → rain, then wind, else clear/cloudy by warmth).
    if ((fallback?.precipMm ?? 0) >= 2) return "🌧️";
    if ((fallback?.windKmh ?? 0) >= 35) return "🌬️";
    if (fallback?.tempMaxC != null && fallback.tempMaxC <= 0) return "🌨️";
    return "☀️";
  }
  if (code === 0) return "☀️"; // clear
  if (code === 1 || code === 2) return "🌤️"; // mainly clear / partly cloudy
  if (code === 3) return "☁️"; // overcast
  if (code === 45 || code === 48) return "🌫️"; // fog
  if (code >= 51 && code <= 57) return "🌦️"; // drizzle
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return "🌧️"; // rain / rain showers
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "🌨️"; // snow
  if (code >= 95 && code <= 99) return "⛈️"; // thunderstorm
  return "🌤️"; // unknown code → benign default
}

/** Short FR label for a WMO weather code. Null code → a generic "Météo". */
export function weatherLabel(code: number | null | undefined): string {
  if (code == null) return "Météo";
  if (code === 0) return "Dégagé";
  if (code === 1) return "Plutôt dégagé";
  if (code === 2) return "Partiellement nuageux";
  if (code === 3) return "Couvert";
  if (code === 45 || code === 48) return "Brouillard";
  if (code >= 51 && code <= 57) return "Bruine";
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return "Pluie";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Neige";
  if (code >= 95 && code <= 99) return "Orage";
  return "Météo";
}

/** Notable-condition thresholds — STARTING POINTS (population defaults; tune later, like the load coeffs). */
const CANICULE_FEELS_C = 32; // apparent "feels-like" max ≥ 32 °C ⇒ heat strain the athlete must factor in
const CANICULE_TEMP_C = 34; // OR a dry max ≥ 34 °C
const GRAND_FROID_MIN_C = -5; // overnight/morning min ≤ −5 °C
const GRAND_FROID_MAX_C = 0; // OR a max that never clears freezing
const PLUIE_FORTE_MM = 20; // ≥ 20 mm/day ⇒ heavy rain
const VENT_FORT_KMH = 45; // ≥ 45 km/h max gust-ish ⇒ strong wind

type WeatherInputs = {
  tempMaxC?: number | null;
  tempMinC?: number | null;
  feelsMaxC?: number | null;
  precipMm?: number | null;
  windKmh?: number | null;
  weatherCode?: number | null;
};

/** Returns a notable-condition badge ONLY for weather the athlete must factor into a session — else null.
 *  Picks the MOST SEVERE when several apply (storm > heat ≈ heavy rain ≈ severe cold > strong wind). */
export function weatherAlert(row: WeatherInputs): { emoji: string; label: string } | null {
  const { tempMaxC, tempMinC, feelsMaxC, precipMm, windKmh, weatherCode } = row;

  // Most severe first.
  if (weatherCode != null && (weatherCode === 95 || weatherCode === 96 || weatherCode === 99)) {
    return { emoji: "⛈️", label: "Orage" };
  }
  if ((feelsMaxC != null && feelsMaxC >= CANICULE_FEELS_C) || (tempMaxC != null && tempMaxC >= CANICULE_TEMP_C)) {
    return { emoji: "🥵", label: "Canicule" };
  }
  if ((precipMm != null && precipMm >= PLUIE_FORTE_MM) || (weatherCode != null && (weatherCode === 65 || weatherCode === 82))) {
    return { emoji: "🌧️", label: "Pluie forte" };
  }
  if ((tempMinC != null && tempMinC <= GRAND_FROID_MIN_C) || (tempMaxC != null && tempMaxC <= GRAND_FROID_MAX_C)) {
    return { emoji: "🥶", label: "Grand froid" };
  }
  if (windKmh != null && windKmh >= VENT_FORT_KMH) {
    return { emoji: "🌬️", label: "Vent fort" };
  }
  return null;
}

/** Extreme-TEMPERATURE badge — 🥵 grande chaleur / 🥶 grand froid — meant to COMPLEMENT the sky-condition
 *  icon (a day can be both stormy AND a heatwave). Temperature is a separate axis from the sky condition,
 *  so this is shown alongside `weatherIcon`, not instead of it. Same thresholds as the canicule/grand-froid
 *  alerts. Null on a temperate day. */
export function weatherTempBadge(row: WeatherInputs): { emoji: string; label: string } | null {
  const { tempMaxC, tempMinC, feelsMaxC } = row;
  if ((feelsMaxC != null && feelsMaxC >= CANICULE_FEELS_C) || (tempMaxC != null && tempMaxC >= CANICULE_TEMP_C)) {
    return { emoji: "🥵", label: "Grande chaleur" };
  }
  if ((tempMinC != null && tempMinC <= GRAND_FROID_MIN_C) || (tempMaxC != null && tempMaxC <= GRAND_FROID_MAX_C)) {
    return { emoji: "🥶", label: "Grand froid" };
  }
  return null;
}

/** Sky/precip/wind CONDITION badge — orage / pluie forte / vent fort — null when benign. Temperature is a
 *  separate axis (weatherTempBadge), so a stormy heatwave yields BOTH. */
function weatherConditionAlert(row: WeatherInputs): { emoji: string; label: string } | null {
  const { precipMm, windKmh, weatherCode } = row;
  if (weatherCode != null && (weatherCode === 95 || weatherCode === 96 || weatherCode === 99)) {
    return { emoji: "⛈️", label: "Orage" };
  }
  if ((precipMm != null && precipMm >= PLUIE_FORTE_MM) || (weatherCode != null && (weatherCode === 65 || weatherCode === 82))) {
    return { emoji: "🌧️", label: "Pluie forte" };
  }
  if (windKmh != null && windKmh >= VENT_FORT_KMH) {
    return { emoji: "🌬️", label: "Vent fort" };
  }
  return null;
}

/** All notable badges for a day on TWO complementary axes — condition (orage/pluie/vent) + temperature
 *  (canicule/grand froid). 0–2 entries; e.g. a stormy heatwave day → [⛈️ Orage, 🥵 Grande chaleur]. */
export function weatherAlerts(row: WeatherInputs): { emoji: string; label: string }[] {
  const out: { emoji: string; label: string }[] = [];
  const cond = weatherConditionAlert(row);
  if (cond) out.push(cond);
  const temp = weatherTempBadge(row);
  if (temp) out.push(temp);
  return out;
}
