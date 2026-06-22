/** Shared formatting + load-vs-average colour helpers.
 *  Pure (no I/O, no JSX) so server pages, the activities page, the comparison page and the chart
 *  day-detail panel all share one source of truth. Extracted out of app/page.tsx. */
import { STATE } from "./theme";

/** A number to fixed decimals, or an em-dash for null/undefined. */
export function fmt(n: number | null | undefined, d = 0): string {
  return n == null ? "—" : n.toFixed(d);
}

/** Seconds → "X h YY" / "Z min" / "—". */
export function dur(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

/** Metres → "1 234 m" / "—" (thin-space grouping, tabular-friendly). */
export function meters(m: number | null | undefined): string {
  return m == null ? "—" : `${Math.round(m).toLocaleString("fr-FR").replace(/ | /g, " ")} m`;
}

/** Metres → kilometres, "12,3 km" / "—". */
export function km(m: number | null | undefined): string {
  return m == null ? "—" : `${(m / 1000).toFixed(1)} km`;
}

export function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Mean points-per-session over the last `days` days (the colour-code reference), or null if none. */
export function avgLoadRecent(
  activities: { local_date: string; training_load: number | null }[], today: string, days: number,
): number | null {
  const cutoff = isoMinusDays(today, days - 1); // window [today-(days-1) … today]
  const recent = activities.filter((a) => a.local_date >= cutoff && a.training_load != null);
  return recent.length ? recent.reduce((s, a) => s + (a.training_load ?? 0), 0) / recent.length : null;
}

/** A session's load vs the recent average: amber = heavier, alpine blue = lighter, neutral within ±50 %.
 *  Returns a theme CSS-var string (never a raw hex) or undefined for "no accent". */
export function loadVsAvgColor(load: number | null | undefined, avg: number | null): string | undefined {
  if (load == null || avg == null || avg <= 0) return undefined;
  const r = load / avg;
  if (r >= 1.5) return STATE.caution;
  if (r <= 0.5) return STATE.cool;
  return undefined;
}

/** Long French date for headings, e.g. "lundi 23 juin 2026". UTC so the YYYY-MM-DD never shifts a day. */
export function longDateFr(localDate: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(localDate + "T00:00:00Z"));
}
