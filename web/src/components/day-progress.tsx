/** Dashboard nudge — "today's load vs the coach's plan". A thin SERVER component (no client JS, no LLM):
 *  it sums today's activity load, derives favourite sports, and renders the pre-built verdict from
 *  computeDayProgress. Shown right under the coach's word so the quantitative check follows the briefing.
 *  Colour encodes meaning (design system): green = on/under-control, blue = under-load, amber = ease off. */
import type { Activity } from "@/lib/data";
import {
  computeDayProgress,
  rankedFavorites,
  todaySportCodes,
  type DayStatus,
  type SuggestionSize,
} from "@/lib/day-progress";
import { sportIcon, sportName } from "@/lib/labels";
import { STATE } from "@/lib/theme";

// Status → accent colour (theme token, never raw hex) + the chip glyph.
const LOOK: Record<DayStatus, { color: string; glyph: string }> = {
  reached: { color: STATE.ready, glyph: "✓" },
  below: { color: STATE.cool, glyph: "+" },
  above: { color: STATE.caution, glyph: "↑" },
  rest_kept: { color: STATE.ready, glyph: "✓" },
  rest_broken: { color: STATE.caution, glyph: "!" },
};

const SIZE_FR: Record<SuggestionSize, string> = {
  big: "une grosse séance",
  normal: "une séance d'intensité normale",
  light: "une séance légère",
};

export function DayProgress({
  activities,
  today,
  hasPlan,
  target,
  isRest,
  avgLoad,
}: {
  activities: Activity[];
  today: string;
  hasPlan: boolean;
  target: number | null;
  isRest: boolean;
  avgLoad: number | null;
}) {
  const actual = activities
    .filter((a) => a.local_date === today)
    .reduce((s, a) => s + (a.training_load ?? 0), 0);

  const progress = computeDayProgress({
    hasPlan,
    target,
    isRest,
    actual,
    avgLoad,
    todaySports: todaySportCodes(activities, today),
    favorites: rankedFavorites(activities),
  });
  if (!progress) return null;

  const { color, glyph } = LOOK[progress.status];
  const sug = progress.suggestion;

  return (
    <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-400">
        Charge du jour vs. plan du coach
      </div>
      <div className="mt-2 flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-base font-bold tabular-nums"
          style={{ borderColor: color, color }}
          aria-hidden
        >
          {glyph}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {progress.title}
          </h2>
          <p className="mt-0.5 text-sm text-stone-600 dark:text-stone-300">{progress.body}</p>

          {sug && (
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
              <span className="font-medium text-stone-700 dark:text-stone-200">Pour compléter :</span>{" "}
              {SIZE_FR[sug.size]}
              {sug.sportCode ? (
                <>
                  , p.&nbsp;ex.{" "}
                  <span className="whitespace-nowrap font-medium text-stone-700 dark:text-stone-200">
                    <span aria-hidden>{sportIcon(sug.sportCode)}</span> {sportName(sug.sportCode, sug.sportCode)}
                  </span>
                </>
              ) : (
                " dans un autre sport que ceux du jour"
              )}
              {" "}(différent de tes séances d&apos;aujourd&apos;hui).
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
