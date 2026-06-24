import Link from "next/link";
import { sportIcon, SYSTEM_TAG_FR } from "@/lib/labels";
import type { WeekPlanDay } from "@/lib/data";

/** The 7-day plan strip (today + next 6 days), rendered as a flex-wrap of compact pills — one per day
 *  that carries something. Two kinds, both CLICKABLE to their detail (`/seance/[id]`) so the athlete can
 *  open today's session and plan around it:
 *   • athlete-declared **events** → Alpine border (the sanctioned "links/primary" hue, not a category
 *     colour) — lets us drop the verbose "· événement" suffix and keep the pill tight;
 *   • **coach-planned** sessions → neutral stone.
 *  Today's pill (offset 0) is filled rather than outlined, so the day you act on stands out. Sports stay
 *  glyph + name, never coloured. Server component — no client JS. */
export function WeekPlanPills({ days }: { days: WeekPlanDay[] }) {
  if (!days.length) {
    return (
      <p className="text-sm text-stone-500 dark:text-stone-400">
        Rien de prévu pour les 7 prochains jours.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {days.map((d) => {
        const focus = d.systemTag ? (SYSTEM_TAG_FR[d.systemTag] ?? d.systemTag) : null;
        const label = d.isEvent ? (d.title || focus || "Événement") : (focus ?? "—");
        const dayLabel = d.dayOffset === 0 ? "Auj." : `+${d.dayOffset} j`;
        const isToday = d.dayOffset === 0;
        const clickable = !!d.sessionId;
        const title = d.isEvent
          ? `Événement : ${d.title ?? label}`
          : (focus ? `Séance coach : ${focus}` : "Séance du coach");

        const inner = (
          <>
            <span className="shrink-0 whitespace-nowrap font-medium">{dayLabel}</span>
            {d.sportCode && <span aria-hidden className="shrink-0">{sportIcon(d.sportCode)}</span>}
            <span className="min-w-0 truncate">{label}</span>
            {/* Notable forecast — condition + temperature (e.g. ⛈️🥵). Quiet glyphs, no extra colour. */}
            {d.weatherAlerts?.length > 0 && (
              <span aria-hidden className="shrink-0" title={d.weatherAlerts.map((a) => a.label).join(" · ")}>
                {d.weatherAlerts.map((a) => a.emoji).join("")}
              </span>
            )}
          </>
        );

        const base = "inline-flex max-w-[12rem] items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors";
        const tone = d.isEvent
          // Athlete event — Alpine (my own / interactive). Today filled, other days outlined.
          ? `text-stone-700 dark:text-stone-200 ${
              isToday
                ? "border-alpine-400 bg-alpine-50 dark:border-alpine-500/70 dark:bg-alpine-950/40"
                : "border-alpine-400 dark:border-alpine-500/70"
            } ${clickable ? "hover:bg-alpine-100 hover:border-alpine-500 dark:hover:bg-alpine-900/40" : ""}`
          // Coach session — neutral stone. Today filled, other days outlined.
          : `text-stone-600 dark:text-stone-300 ${
              isToday
                ? "border-stone-300 bg-stone-100 dark:border-stone-600 dark:bg-stone-800"
                : "border-stone-200 dark:border-stone-700"
            } ${clickable ? "hover:bg-stone-50 hover:border-stone-300 dark:hover:bg-stone-800/60" : ""}`;
        const ring = d.isKey
          ? (d.isEvent ? "ring-1 ring-alpine-200 dark:ring-alpine-500/40" : "ring-1 ring-stone-200 dark:ring-stone-700")
          : "";
        const cls = `${base} ${tone} ${ring}`;

        return clickable ? (
          <Link key={d.dayOffset} href={`/seance/${d.sessionId}`} title={title} className={cls}>
            {inner}
          </Link>
        ) : (
          <span key={d.dayOffset} title={title} className={cls}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}
