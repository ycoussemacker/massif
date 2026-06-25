/** The panel shown when a chart day is selected: the date, that day's load split, and the activities
 *  that make up the score. Server-compatible (no hooks); rendered inside the client chart island.
 *  Lives OUTSIDE the chart's horizontal scroll container so it is never clipped. */
import Link from "next/link";
import type { Activity } from "@/lib/data";
import { aggregate } from "@/lib/aggregate";
import { fmt, longDateFr } from "@/lib/format";
import { VIZ, STATE } from "@/lib/theme";
import { sportIcon, SYSTEM_TAG_FR } from "@/lib/labels";
import { ActivityLine } from "./activity-row";

function ChannelDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label} <span className="font-medium tabular-nums text-stone-700 dark:text-stone-300">{fmt(value, 0)}</span>
    </span>
  );
}

/** A future planned session shown in the panel when its day has no realised activity yet. */
export type PlannedDetail = {
  kind: "event" | "pinned" | "coach"; // event/pinned = the athlete's committed plan; coach = a proposal
  sessionId: string | null; // planned_sessions id → /seance/[id] (the session detail), when known
  sportCode: string | null;
  systemTag: string | null;  // coach focus (rest/recovery/…) — shown as a sub-label for coach proposals
  title: string;
  predictedLoad: number | null;
  targetCtl: number | null;
  targetAtl: number | null;
  targetTsb: number | null;
  warn: { level: "caution" | "hard"; message: string } | null;
};

/** Short FR label for the kind of plan a marker represents (panel chip). */
const PLANNED_KIND_FR: Record<PlannedDetail["kind"], string> = {
  event: "Événement",
  pinned: "Séance prévue",
  coach: "Proposé par le coach",
};

export function DayDetailPanel({
  date, activities, onClose, planned,
}: {
  date: string;
  activities: Activity[];
  onClose?: () => void;
  planned?: PlannedDetail | null;
}) {
  // Planned mode: a future event with no realised activity → show the prevision instead of the day's load.
  if (planned && activities.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4 dark:border-stone-600 dark:bg-stone-800/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">Prévu · {longDateFr(date)}</span>
              {/* Kind chip: committed plan (event/pinned) reads Alpine = "mine/primary"; a coach proposal stays neutral. */}
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                planned.kind === "coach"
                  ? "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                  : "bg-alpine-50 text-alpine-700 dark:bg-alpine-950/40 dark:text-alpine-300"
              }`}>{PLANNED_KIND_FR[planned.kind]}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {planned.sessionId ? (
                <Link
                  href={`/seance/${planned.sessionId}`}
                  className="group inline-flex items-center gap-1.5 text-sm text-stone-700 transition-colors hover:text-alpine-700 dark:text-stone-200 dark:hover:text-alpine-300"
                >
                  <span aria-hidden>{sportIcon(planned.sportCode)}</span>
                  <span className="font-medium">{planned.title}</span>
                  {planned.systemTag && SYSTEM_TAG_FR[planned.systemTag] && (
                    <span className="text-xs text-stone-400">· {SYSTEM_TAG_FR[planned.systemTag]}</span>
                  )}
                  <span aria-hidden className="text-stone-300 transition-colors group-hover:text-alpine-600 dark:text-stone-600 dark:group-hover:text-alpine-400">→</span>
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm text-stone-700 dark:text-stone-200">
                  <span aria-hidden>{sportIcon(planned.sportCode)}</span>
                  <span className="font-medium">{planned.title}</span>
                </span>
              )}
              {planned.predictedLoad != null && (
                <span className="text-xs text-stone-500">charge estimée <span className="font-medium tabular-nums text-stone-700 dark:text-stone-300">~{fmt(planned.predictedLoad, 0)}</span> pts</span>
              )}
            </div>
            {(planned.targetCtl != null || planned.targetAtl != null || planned.targetTsb != null) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                {planned.targetCtl != null && <ChannelDot color={VIZ.aerobic} label="CTL visé" value={planned.targetCtl} />}
                {planned.targetAtl != null && <ChannelDot color={VIZ.neuro} label="ATL projeté" value={planned.targetAtl} />}
                {planned.targetTsb != null && <ChannelDot color={planned.targetTsb >= 0 ? STATE.ready : STATE.caution} label="TSB projeté" value={planned.targetTsb} />}
              </div>
            )}
            {/* No-LLM readiness flag: arriving fatigued under the plan (the earlier sessions/events cost). */}
            {planned.warn && (
              <div className={`mt-2.5 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                planned.warn.level === "hard"
                  ? "border-rest/40 bg-rest/10"
                  : "border-caution/50 bg-caution/10"
              }`}>
                <span aria-hidden className="leading-none">⚠️</span>
                <span className="text-stone-700 dark:text-stone-200">{planned.warn.message}</span>
              </div>
            )}
          </div>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Fermer le détail du jour"
              className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700">✕</button>
          )}
        </div>
      </div>
    );
  }

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
