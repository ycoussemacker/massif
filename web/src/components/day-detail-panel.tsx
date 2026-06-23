/** The panel shown when a chart day is selected: the date, that day's load split, and the activities
 *  that make up the score. Server-compatible (no hooks); rendered inside the client chart island.
 *  Lives OUTSIDE the chart's horizontal scroll container so it is never clipped. */
import type { Activity } from "@/lib/data";
import { aggregate } from "@/lib/aggregate";
import { fmt, longDateFr } from "@/lib/format";
import { VIZ } from "@/lib/theme";
import { ActivityLine } from "./activity-row";

function ChannelDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label} <span className="font-medium tabular-nums text-stone-700 dark:text-stone-300">{fmt(value, 0)}</span>
    </span>
  );
}

export function DayDetailPanel({
  date, activities, onClose,
}: {
  date: string;
  activities: Activity[];
  onClose?: () => void;
}) {
  const agg = aggregate(activities);
  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-800/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stone-900 dark:text-stone-50">{longDateFr(date)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-lg font-semibold tabular-nums">
              {fmt(agg.load, 0)}<span className="ml-1 text-xs font-normal text-stone-400">pts</span>
            </span>
            <ChannelDot color={VIZ.aerobic} label="aéro" value={agg.aerobic} />
            <ChannelDot color={VIZ.neuro} label="neuro" value={agg.neuro} />
            <span className="text-xs text-stone-400">· {agg.sessions} séance{agg.sessions > 1 ? "s" : ""}</span>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le détail du jour"
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700"
          >
            ✕
          </button>
        )}
      </div>

      {/* One line per activity — click to open Activités filtered on that day/sport. */}
      <div className="mt-3 space-y-1.5">
        {activities.length === 0
          ? <p className="text-sm text-stone-500 dark:text-stone-400">Aucune activité ce jour-là (jour de repos).</p>
          : activities.map((a) => <ActivityLine key={a.id} a={a} />)}
      </div>
    </div>
  );
}
