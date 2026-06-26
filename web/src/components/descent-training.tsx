/** Profil card: "Entraînement à la descente" — wraps the interactive DescentChart (a descent CTL/ATL:
 *  28-day D− exposure vs a slow adaptation baseline). Server component; interactivity is in the island.
 *  Design system: descent = Summit/neuro; the adaptation baseline is a neutral (stone) reference. */
import type { DescentTraining } from "@/lib/descent-training";
import { DescentChart } from "./descent-chart";
import { VIZ, MUTED } from "@/lib/theme";

const fmtM = (m: number) => `${new Intl.NumberFormat("fr-FR").format(Math.round(m))} m`;
const STATE: Record<"building" | "maintaining" | "detraining", { text: string; tone: string }> = {
  building: { text: "tu montes en capacité descente", tone: "text-summit-700 dark:text-summit-400" },
  maintaining: { text: "tu maintiens ta capacité descente", tone: "text-stone-500 dark:text-stone-400" },
  detraining: { text: "tu te désadaptes un peu aux grosses descentes", tone: "text-stone-500 dark:text-stone-400" },
};

export function DescentTrainingCard({ data }: { data: DescentTraining }) {
  const { points, currentFast, currentSlow, state, windowDays, insufficient } = data;
  const s = state ? STATE[state] : null;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">Entraînement à la descente</h2>
        <span className="text-xs text-stone-400">D− par {windowDays} j</span>
      </div>

      {insufficient || points.length < 2 ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Pas encore assez de descentes pour tracer ta courbe d&apos;adaptation. Elle apparaîtra après
          quelques sorties avec du dénivelé négatif.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
            Ton <strong className="font-medium">exposition</strong> à la descente sur 28 j vs ta ligne
            d&apos;<strong className="font-medium">adaptation</strong> (lente). Au-dessus = tu montes en
            capacité&nbsp;; en-dessous = tu te désadaptes. L&apos;échelle suit la fenêtre&nbsp;; défile pour
            l&apos;historique.
          </p>
          {/* legend */}
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-[1px]" style={{ background: VIZ.neuro, opacity: 0.55 }} aria-hidden />
              exposition 28 j
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: MUTED }} aria-hidden />
              adaptation
            </span>
          </div>
          <DescentChart points={points} />
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            <span className="tabular-nums">
              expo <span className="font-medium text-summit-700 dark:text-summit-400">{fmtM(currentFast)}</span>
              {" · "}adaptation {fmtM(currentSlow)}
            </span>
            {s && <span className={`ml-1 ${s.tone}`}>— {s.text}</span>}
          </p>
        </>
      )}
    </section>
  );
}
