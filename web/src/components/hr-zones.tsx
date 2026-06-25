/** Read-only display of the athlete's HR training zones (bpm) on /profil — so they can check at a glance
 *  that Massif's zones match their Garmin watch (the whole point of the feature). No editing: zones come
 *  from Garmin (the watch's own config) or, when unavailable, a %HRR fallback computed from the athlete's
 *  thresholds. On the design system: neutral stone, bordered-not-shadowed, every bpm tabular-nums (zones
 *  are intensity, not a sport/physiology channel, so no Alpine/Summit colour). Server component (no hooks). */
import type { HrZones } from "@/lib/profile-types";

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const t = Date.parse(d.length === 10 ? d + "T00:00:00Z" : d);
  if (Number.isNaN(t)) return d;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(t));
}

export function HrZonesPanel({ zones }: { zones: HrZones }) {
  const source = zones?.source ?? null;
  const sourceLabel =
    source === "garmin" ? "depuis ta montre Garmin"
    : source === "computed" ? "estimées depuis tes seuils (FC max / repos)"
    : null;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">Zones cardiaques</h2>
        {zones?.updated_at && (
          <span className="text-xs text-stone-400">mises à jour le {fmtDate(zones.updated_at)}</span>
        )}
      </div>

      {!zones || !zones.zones?.length ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Aucune zone enregistrée pour l&apos;instant. Le prochain sync Garmin récupère tes zones (sinon
          elles seront estimées depuis ta FC max / FC de repos).
        </p>
      ) : (
        <>
          {sourceLabel && (
            <p className="mb-3 text-xs text-stone-500 dark:text-stone-400">
              {sourceLabel}. Le coach prescrit tes séances aérobies dans ces zones pour qu&apos;elles
              correspondent à ta montre.
            </p>
          )}
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {zones.zones.map((z) => (
              <div key={z.n} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                <span className="font-medium text-stone-700 dark:text-stone-200">{z.name}</span>
                <span className="tabular-nums text-stone-600 dark:text-stone-300">
                  {z.low_bpm}–{z.high_bpm} <span className="text-stone-400">bpm</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
