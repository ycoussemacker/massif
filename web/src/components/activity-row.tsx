/** Presentational activity rows — one source of truth for the dashboard, the chart day-panel,
 *  the activities page and the comparison breakdown. Server-compatible (no client hooks); the only
 *  interactive leaf is <RpeControl> (its own "use client" island) and <StravaLink> is a plain <a>. */
import Link from "next/link";
import type { Activity } from "@/lib/data";
import { sportName, sportIcon, aerobicSourceFr, neuroSourceFr } from "@/lib/labels";
import { fmt, dur, loadVsAvgColor } from "@/lib/format";
import { VIZ } from "@/lib/theme";
import { RpeControl } from "./rpe";
import { StravaLink } from "./brand";

/** One-line activity recap for the day-detail panel: sport glyph + Strava title + aéro/neuro impacts,
 *  the whole row a link to the Activités page filtered on this day + sport (→ affordance). Fits one line
 *  (the title truncates); no card, no nested controls — the compact read used inside the dashboard. */
export function ActivityLine({ a }: { a: Activity }) {
  const href = `/activites?from=${a.local_date}&to=${a.local_date}${a.sport_id ? `&sport=${a.sport_id}` : ""}`;
  return (
    <Link
      href={href}
      className="group flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-1.5 text-sm transition-colors hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:hover:border-stone-700 dark:hover:bg-stone-800/40"
    >
      <span className="shrink-0" aria-hidden>{sportIcon(a.sport_code)}</span>
      <span className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-200">
        {a.strava_name || sportName(a.sport_code, a.sport)}
      </span>
      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-stone-400">
        <span style={{ color: VIZ.aerobic }}>{fmt(a.aerobic_load, 0)}</span>
        <span className="mx-0.5">·</span>
        <span style={{ color: VIZ.neuro }}>{fmt(a.neuromuscular_load, 0)}</span>
      </span>
      <span className="shrink-0 text-stone-300 transition-colors group-hover:text-alpine-600 dark:text-stone-600 dark:group-hover:text-alpine-400" aria-hidden>→</span>
    </Link>
  );
}

/** Plain, tabular activity date. The deep-link lives in its own "Strava ↗" affordance. */
export function ActivityDate({ a, className = "" }: { a: Activity; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{a.local_date}</span>;
}

/** The Strava title of an activity (muted), or nothing when absent. */
function StravaName({ a, className = "" }: { a: Activity; className?: string }) {
  if (!a.strava_name) return null;
  return <span className={`block truncate text-xs text-stone-400 dark:text-stone-500 ${className}`}>{a.strava_name}</span>;
}

/** Mobile / narrow card. */
export function ActivityCard({ a, avgLoad }: { a: Activity; avgLoad?: number | null }) {
  const accent = loadVsAvgColor(a.training_load, avgLoad ?? null);
  return (
    <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-medium">
          <span className="mr-1.5" aria-hidden>{sportIcon(a.sport_code)}</span>
          {sportName(a.sport_code, a.sport)}
          <StravaName a={a} />
        </span>
        <ActivityDate a={a} className="shrink-0 text-xs text-stone-400" />
      </div>
      {a.spanInfo && (
        <div className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
          🗓 Sortie multi-jours · jour {a.spanInfo.index}/{a.spanInfo.total} · {fmt(a.spanInfo.fullLoad, 0)} pts au total répartis sur {a.spanInfo.total} j
        </div>
      )}
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
          {fmt(a.training_load, 0)}<span className="ml-1 text-xs font-normal text-stone-400">pts</span>
        </span>
        <span className="text-xs text-stone-500 dark:text-stone-400">
          aéro {fmt(a.aerobic_load, 0)} <span className="text-stone-400 dark:text-stone-500">({aerobicSourceFr(a.load_method_used)})</span>
          {" · "}neuro {fmt(a.neuromuscular_load, 0)} <span className="text-stone-400 dark:text-stone-500">({neuroSourceFr(a)})</span>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
        <span>⏱ {dur(a.duration_s)}</span>
        <span>D+ {a.vertical_gain_m != null ? Math.round(a.vertical_gain_m) : "—"} / D− {a.vertical_loss_m != null ? Math.round(a.vertical_loss_m) : "—"}</span>
        {a.avg_hr != null && <span>FC {a.avg_hr}</span>}
        {a.needs_review && (
          <span
            title="Charge possiblement sur-estimée : longtemps à l'arrêt, ou capteur FC/intensité douteux. Affine avec un RPE."
            className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
          >
            ⚠ à vérifier
          </span>
        )}
        {a.needs_manual_rpe && <RpeControl activityId={a.id} value={a.perceived_rpe} />}
        <StravaLink source={a.source} sourceActivityId={a.source_activity_id} className="ml-auto" />
      </div>
    </div>
  );
}

/** Shared desktop table header — keeps columns in sync between dashboard and activities page. */
export function ActivityTableHead() {
  return (
    <thead>
      <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-700">
        <th className="py-2 pr-3 font-medium">Date</th>
        <th className="py-2 pr-3 font-medium">Sport</th>
        <th className="py-2 pr-3 text-right font-medium">Charge</th>
        <th className="py-2 pr-3 text-right font-medium">Aéro / Neuro</th>
        <th className="py-2 pr-3 text-right font-medium">Durée</th>
        <th className="py-2 pr-3 text-right font-medium">D+ / D−</th>
        <th className="py-2 pr-3 text-right font-medium">FC</th>
        <th className="py-2 pr-3 font-medium">RPE</th>
        <th className="py-2 text-right font-medium"><span className="sr-only">Lien Strava</span></th>
      </tr>
    </thead>
  );
}

/** Desktop table row (caller owns the <table>/<thead>; use <ActivityTableHead/>). */
export function ActivityRow({ a, avgLoad }: { a: Activity; avgLoad?: number | null }) {
  const accent = loadVsAvgColor(a.training_load, avgLoad ?? null);
  return (
    <tr className="border-b border-stone-100 last:border-0 dark:border-stone-800">
      <td className="py-2 pr-3 align-top"><ActivityDate a={a} className="text-stone-500" /></td>
      <td className="py-2 pr-3">
        <span className="whitespace-nowrap">
          <span className="mr-1.5" aria-hidden>{sportIcon(a.sport_code)}</span>
          {sportName(a.sport_code, a.sport)}
          {a.needs_review && (
            <span
              title="Charge possiblement sur-estimée : longtemps à l'arrêt, ou capteur FC/intensité douteux. Affine avec un RPE."
              className="ml-1.5 text-stone-400 dark:text-stone-500"
            >
              ⚠
            </span>
          )}
        </span>
        <StravaName a={a} className="max-w-[16rem]" />
      </td>
      <td className="py-2 pr-3 text-right align-top font-medium tabular-nums" style={accent ? { color: accent } : undefined}>
        {fmt(a.training_load, 0)}
      </td>
      <td className="py-2 pr-3 text-right align-top whitespace-nowrap text-stone-500">
        <span className="tabular-nums">{fmt(a.aerobic_load, 0)}</span>{" "}
        <span className="text-stone-400 dark:text-stone-500">{aerobicSourceFr(a.load_method_used)}</span>
        {" / "}
        <span className="tabular-nums">{fmt(a.neuromuscular_load, 0)}</span>{" "}
        <span className="text-stone-400 dark:text-stone-500">{neuroSourceFr(a)}</span>
      </td>
      <td className="py-2 pr-3 text-right align-top tabular-nums text-stone-500">{dur(a.duration_s)}</td>
      <td className="py-2 pr-3 text-right align-top tabular-nums text-stone-500">
        {a.vertical_gain_m != null ? Math.round(a.vertical_gain_m) : "—"} / {a.vertical_loss_m != null ? Math.round(a.vertical_loss_m) : "—"}
      </td>
      <td className="py-2 pr-3 text-right align-top tabular-nums text-stone-500">{a.avg_hr ?? "—"}</td>
      <td className="py-2 pr-3 align-top">
        {a.needs_manual_rpe
          ? <RpeControl activityId={a.id} value={a.perceived_rpe} />
          : <span className="text-stone-300 dark:text-stone-600">—</span>}
      </td>
      <td className="py-2 text-right align-top whitespace-nowrap">
        <StravaLink source={a.source} sourceActivityId={a.source_activity_id} />
      </td>
    </tr>
  );
}
