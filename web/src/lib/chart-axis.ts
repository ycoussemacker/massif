/** Shared x-axis tick helpers so EVERY time-series chart labels the same way: a date every 7 days, on
 *  Mondays. Charts pass their contiguous ascending ISO date array; the helper returns the indices that
 *  land on a Monday (each chart maps an index to its own x-pixel + renders the label). */

/** Indices of `dates` (ISO YYYY-MM-DD, ascending) that fall on a Monday — one tick per week. */
export function mondayTickIndices(dates: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    const t = Date.parse((dates[i] ?? "").slice(0, 10) + "T00:00:00Z");
    if (!Number.isNaN(t) && new Date(t).getUTCDay() === 1) out.push(i); // 1 = Monday (UTC)
  }
  return out;
}

/** Compact FR date label for an axis tick, e.g. "12 mai". */
export function axisDateLabel(iso: string): string {
  const t = Date.parse((iso ?? "").slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(t));
}
