import type { Activity } from "@/lib/data";
import { sportName, sportIcon } from "@/lib/labels";
import { dur, fmt } from "@/lib/format";

type SnapAct = Pick<
  Activity,
  "id" | "sport_code" | "sport" | "training_load" | "duration_s" | "distance_m" | "vertical_gain_m" | "vertical_loss_m" | "avg_hr"
>;

/** A day's activities exactly as they read in the /coach conversation: a 📅 header + one line per
 *  session (sport glyph + name + load pts, then durée · km · D+/D− · FC). Presentational + server-safe,
 *  so it's the ONE source of truth shared by the conversation's ActivityGroupCard and the dashboard
 *  coach card's "snapshot". `footer` lets the chat fuse its "Commente" button; the dashboard omits it. */
export function ActivitySnapshot({
  dateLabel,
  activities,
  footer,
  className = "",
}: {
  dateLabel: string;
  activities: SnapAct[];
  footer?: React.ReactNode;
  className?: string;
}) {
  const n = activities.length;
  return (
    <div className={`overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 ${className}`}>
      <div className="border-b border-stone-100 px-4 py-2 dark:border-stone-800">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-400">
          📅 {dateLabel}{n > 1 ? ` · ${n} activités` : ""}
        </span>
      </div>
      <ul className="divide-y divide-stone-100 dark:divide-stone-800">
        {activities.map((a) => {
          const bits = [
            dur(a.duration_s),
            a.distance_m != null ? `${(a.distance_m / 1000).toFixed(1)} km` : null,
            a.vertical_gain_m != null || a.vertical_loss_m != null
              ? `D+ ${fmt(a.vertical_gain_m, 0)} / D− ${fmt(a.vertical_loss_m, 0)}` : null,
            a.avg_hr != null ? `FC ${a.avg_hr}` : null,
          ].filter(Boolean) as string[];
          return (
            <li key={a.id} className="px-4 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  <span aria-hidden>{sportIcon(a.sport_code)}</span>
                  <span className="truncate">{sportName(a.sport_code, a.sport)}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {fmt(a.training_load, 0)}<span className="ml-0.5 text-xs font-normal text-stone-400">pts</span>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                {bits.map((bit, i) => <span key={i}>{bit}</span>)}
              </div>
            </li>
          );
        })}
      </ul>
      {footer}
    </div>
  );
}
