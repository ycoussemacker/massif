/** Profil card: "Entraînement à la descente dans le temps" — the trailing-28-day D− (descent volume),
 *  the FAMILIARITY proxy the descent model uses (Upgrade 7). Above the athlete's own median = well adapted
 *  (the model discounts the eccentric cost + recovers faster); below = reprise (more DOMS). The chart is a
 *  horizontally-scrollable strip (same UX as the dashboard's fitness charts: opens on the most recent
 *  weeks, scroll LEFT through the full history) — all history is fetched server-side, so scroll-back is
 *  instant. Design system: descent = NEUROMUSCULAR → Summit via theme tokens; median = neutral reference
 *  (stone, dashed); bordered-not-shadowed; metres tabular-nums. Server markup inside the ScrollRight island. */
import type { DescentTraining } from "@/lib/descent-training";
import { ScrollRight } from "./scroll-right";
import { VIZ, MUTED } from "@/lib/theme";
import { mondayTickIndices, axisDateLabel } from "@/lib/chart-axis";

const PX_PER_DAY = 16; // same cadence as the dashboard charts → ~2 months fill a typical card width
const fmtM = (m: number) => `${new Intl.NumberFormat("fr-FR").format(Math.round(m))} m`;
const monthLabel = (iso: string) => {
  const d = new Date(Date.parse(iso.slice(0, 10) + "T00:00:00Z"));
  const mois = new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(d);
  // Year only on January boundaries (dashboard convention) so it isn't repeated on every tick.
  return d.getUTCMonth() === 0 ? `${mois} ${String(d.getUTCFullYear()).slice(2)}` : mois;
};

const STATE_TEXT: Record<DescentTraining["state"], { tone: string; text: string }> = {
  adapted: { tone: "text-summit-700 dark:text-summit-400", text: "Bien adapté aux descentes en ce moment — tes jambes encaissent (le modèle allège un peu le coût neuromusculaire)." },
  typical: { tone: "text-stone-500 dark:text-stone-400", text: "Exposition aux descentes proche de ton niveau habituel." },
  deconditioned: { tone: "text-stone-500 dark:text-stone-400", text: "En reprise sur les descentes — tes prochaines grosses descentes coûteront un peu plus cher (courbatures plus marquées)." },
  insufficient: { tone: "text-stone-500 dark:text-stone-400", text: "" },
};

function Card({ children, windowDays }: { children: React.ReactNode; windowDays: number }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">Entraînement à la descente</h2>
        <span className="text-xs text-stone-400">D− cumulé sur {windowDays} j glissants</span>
      </div>
      {children}
    </section>
  );
}

export function DescentTrainingCard({ data }: { data: DescentTraining }) {
  const { points, medianM, currentM, state, windowDays } = data;

  if (state === "insufficient" || points.length < 2) {
    return (
      <Card windowDays={windowDays}>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Pas encore assez d&apos;historique de descente pour tracer ta courbe d&apos;adaptation. Elle
          apparaîtra après quelques sorties avec du dénivelé négatif.
        </p>
      </Card>
    );
  }

  // ── geometry: a fixed-width strip (px = days × PX_PER_DAY) that overflows → horizontal scroll ──
  const H = 150, padT = 12, padB = 22;
  const yTop = padT, yBot = H - padB;
  const W = Math.round(points.length * PX_PER_DAY);
  const rawMax = Math.max(medianM, ...points.map((p) => p.m), 1);
  const maxM = Math.max(1000, Math.ceil(rawMax / 1000) * 1000); // nice round y-scale top (also the axis label)
  const X = (i: number) => (i + 0.5) * PX_PER_DAY;
  const Y = (m: number) => yBot - (m / maxM) * (yBot - yTop);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(p.m).toFixed(1)}`).join(" ");
  const area = `M${X(0).toFixed(1)},${yBot} ${points.map((p, i) => `L${X(i).toFixed(1)},${Y(p.m).toFixed(1)}`).join(" ")} L${X(points.length - 1).toFixed(1)},${yBot} Z`;
  const yMedian = Y(medianM);
  // Weekly x-axis: a date every 7 days, on Mondays (shared with the other time-series charts).
  const ticks = mondayTickIndices(points.map((p) => p.date)).map((i) => ({ i, date: points[i].date }));
  const adapted = state === "adapted"; // colour the current value only when the state agrees (≥1.15× median)
  const st = STATE_TEXT[state];

  return (
    <Card windowDays={windowDays}>
      <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
        Plus tu accumules de descente (D−), plus tes jambes s&apos;y adaptent. Au-dessus de ta médiane =
        bien exposé&nbsp;; en dessous = reprise. Fais défiler vers la gauche pour l&apos;historique.
      </p>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-1.5">
        {/* fixed y-axis (always visible while scrolling): max (top) · médiane (true height) · 0 (m, D−) */}
        <div className="relative w-10 shrink-0 text-right text-[10px] tabular-nums text-stone-400" style={{ height: H }} aria-hidden>
          <span className="absolute right-0 -translate-y-1/2" style={{ top: yTop }}>{Math.round(maxM)}</span>
          <span className="absolute right-0 -translate-y-1/2" style={{ top: yMedian }}>{Math.round(medianM)}</span>
          <span className="absolute right-0 -translate-y-1/2" style={{ top: yBot }}>0</span>
        </div>
        <ScrollRight className="overflow-x-auto">
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
            aria-label="Dénivelé négatif cumulé sur 28 jours glissants, historique complet">
            {/* median reference line (full width) */}
            <line x1={0} x2={W} y1={yMedian} y2={yMedian} stroke={MUTED} strokeWidth={1}
              strokeDasharray="4 3" opacity={0.7} />
            {/* area + line (Summit = neuromuscular / descent) */}
            <path d={area} fill={VIZ.neuro} opacity={0.14} />
            <path d={line} fill="none" stroke={VIZ.neuro} strokeWidth={1.75}
              strokeLinejoin="round" strokeLinecap="round" />
            {/* current point (far right — visible on open) */}
            <circle cx={X(points.length - 1)} cy={Y(points[points.length - 1].m)} r={2.6} fill={VIZ.neuro} />
            {/* weekly (Monday) date ticks */}
            {ticks.map((t) => (
              <g key={t.i}>
                <line x1={X(t.i)} x2={X(t.i)} y1={yBot} y2={yBot + 3} stroke={MUTED} strokeWidth={1} opacity={0.5} />
                <text x={X(t.i)} y={H - 6} textAnchor="middle" fontSize={9} fill={MUTED}>{axisDateLabel(t.date)}</text>
              </g>
            ))}
          </svg>
        </ScrollRight>
      </div>
      <div className="pl-[46px] text-[10px] text-stone-400">m de D− · 28 j glissants</div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-xs text-stone-500 dark:text-stone-400">
          Actuellement&nbsp;:{" "}
          <span className={`font-medium tabular-nums ${adapted ? "text-summit-700 dark:text-summit-400" : "text-stone-700 dark:text-stone-300"}`}>
            {currentM != null ? fmtM(currentM) : "—"}
          </span>{" "}
          <span className="text-stone-400">(médiane {fmtM(medianM)})</span>
        </span>
      </div>
      {st.text && <p className={`mt-1 text-xs leading-snug ${st.tone}`}>{st.text}</p>}
    </Card>
  );
}
