/** Dependency-free SVG charts + colored gauges for the Massif dashboard.
 *  Time-series charts have a fixed per-day pixel width and scroll horizontally (newest visible first,
 *  via ScrollRight), keeping chronological order oldest→left, newest→right. */
import type { DailyMetric } from "@/lib/data";
import { ScrollRight } from "./scroll-right";
import { HelpButton, type HelpContent } from "./help";
import { VIZ, STATE, AXIS, MUTED } from "@/lib/theme";

const FITNESS_HELP: HelpContent = {
  title: "Forme : fitness (CTL) vs fatigue (ATL)",
  blocks: [
    { type: "p", text: "Chaque séance produit une charge en « points » : ~100 = 1 h à l'intensité seuil sur le canal aérobie, auxquels s'ajoute le coût neuromusculaire (descente, port de charge, impact, escalade). CTL et ATL sont deux moyennes mobiles exponentielles de cette charge quotidienne (aérobie + neuro)." },
    { type: "dl", items: [
      { k: "CTL (forme)", v: "moyenne lissée sur ~42 jours : ta condition de fond, monte lentement." },
      { k: "ATL (fatigue)", v: "moyenne lissée sur ~7 jours : ta fatigue récente, réagit vite." },
    ] },
    { type: "formula", lines: [
      "CTL(j) = CTL(j-1) + α·(charge_jour − CTL(j-1))",
      "α = 1 − e^(−1/42) ≈ 0,023   (ATL : 1/7 ≈ 0,13)",
    ] },
    { type: "example", text: "Une grosse rando à 400 pts fait bondir l'ATL (7 j) bien plus que la CTL (42 j) : l'écart se creuse = fatigue accumulée." },
    { type: "p", text: "Lecture : ATL au-dessus de CTL → tu charges et fatigues ; ATL repasse en dessous → tu récupères et la forme tient ou monte." },
  ],
};

const TSB_HELP: HelpContent = {
  title: "TSB — fraîcheur (forme du jour)",
  blocks: [
    { type: "p", text: "Le TSB (Training Stress Balance) mesure ta fraîcheur : l'écart entre ta forme de fond et ta fatigue récente." },
    { type: "formula", lines: ["TSB = CTL − ATL   (en points)"] },
    { type: "dl", items: [
      { k: "> +5", v: "frais / affûté — idéal juste avant une course." },
      { k: "−10 à +5", v: "équilibre." },
      { k: "−30 à −10", v: "fatigue productive — normal en bloc d'entraînement." },
      { k: "< −30", v: "surcharge / risque de blessure (bande rouge)." },
    ] },
    { type: "example", text: "CTL 35 et ATL 98 → TSB = −63 : grosse fatigue aiguë, repos conseillé (ton cas après deux jours de montagne)." },
  ],
};

const CHANNEL_HELP: HelpContent = {
  title: "Charge par canal — aérobie vs neuromusculaire",
  blocks: [
    { type: "p", text: "Les deux canaux sont calculés séparément puis additionnés (leur somme = la charge totale) — et non un seul chiffre découpé en pourcentages." },
    { type: "dl", items: [
      { k: "Aérobie (bleu)", v: "coût cardiaque — mesuré par la FC, la puissance ou l'allure (bien capté par FC, VFC, Body Battery). Récupère en heures à 1-2 jours." },
      { k: "Neuromusculaire (orange)", v: "coût structurel + CNS calculé À PART et ajouté : surtout la descente (D−, freinage excentrique), + le port de charge + l'impact de la foulée ; pour l'escalade/la force, l'effort (RPE) est lui-même surtout neuromusculaire. Quasi invisible aux capteurs ; récupère en 24-72 h+, tendons en semaines." },
    ] },
    { type: "formula", lines: [
      "aérobie = coût cardiaque (FC / puissance / allure)",
      "neuro   = descente (D−) + port de charge + impact",
      "total   = aérobie + neuro",
    ] },
    { type: "example", text: "Ton trail (3000 m D−, FC modérée) et ta rando (1500 m D−) ont un coût cardiaque proche — mais le trail charge bien plus l'orange : 2× plus de descente excentrique. D'où un total plus lourd, un coût que la FC seule ne voyait pas (avant, sa descente était invisible)." },
  ],
};

const H = 150;
const PX_PER_DAY = 20;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const plotWidth = (n: number) => Math.max(620, n * PX_PER_DAY);

function linePoints(values: (number | null)[], min: number, max: number, w: number) {
  const span = max - min || 1;
  const n = values.length;
  return values
    .map((v, i) => (v == null ? null : [(i / Math.max(1, n - 1)) * w, H - ((v - min) / span) * H]))
    .filter((p): p is number[] => p !== null)
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

const md = (iso: string) => iso.slice(5); // YYYY-MM-DD -> MM-DD

function Chart({ label, legend, help, max, min = 0, unit, dates, w, children }: {
  label: string; legend?: React.ReactNode; help?: HelpContent; max: number; min?: number;
  unit: string; dates: string[]; w: number; children: React.ReactNode;
}) {
  const mid = (max + min) / 2;
  return (
    <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-stone-700 dark:text-stone-300">
          {label}
          {help && <HelpButton content={help} />}
        </h3>
        {legend}
      </div>
      {/* grid with minmax(0,1fr) on the plot column = robust shrink-to-fit so the scroll actually engages */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        {/* fixed y-axis (does not scroll) */}
        <div className="flex w-9 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-stone-400"
          style={{ height: H }}>
          <span>{Math.round(max)}</span><span>{Math.round(mid)}</span><span>{Math.round(min)}</span>
        </div>
        <ScrollRight className="min-w-0 overflow-x-auto">
          <div style={{ width: w }}>
            <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block">
              {[0, H / 2, H].map((y) => (
                <line key={y} x1={0} y1={y} x2={w} y2={y} stroke="currentColor"
                  className="text-stone-200 dark:text-stone-800" strokeWidth={1} />
              ))}
              {children}
            </svg>
            {/* dates scroll with the plot: oldest at left, newest at right */}
            <div className="flex justify-between text-[10px] text-stone-400" style={{ width: w }}>
              <span>{dates[0] ? md(dates[0]) : ""}</span>
              <span>{dates.at(-1) ? md(dates.at(-1)!) : ""}</span>
            </div>
          </div>
        </ScrollRight>
      </div>
      <div className="mt-1 pl-9 text-center text-[10px] text-stone-400">{unit}</div>
    </div>
  );
}

const Dot = ({ color, text }: { color: string; text: string }) => (
  <span className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
    <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />{text}
  </span>
);

export function FitnessChart({ metrics }: { metrics: DailyMetric[] }) {
  const w = plotWidth(metrics.length);
  const ctl = metrics.map((m) => m.ctl);
  const atl = metrics.map((m) => m.atl);
  const max = Math.max(1, ...ctl.map((v) => v ?? 0), ...atl.map((v) => v ?? 0)) * 1.1;
  return (
    <Chart label="Forme — fitness vs fatigue" unit="points de charge" max={max} w={w} dates={metrics.map((m) => m.local_date)}
      help={FITNESS_HELP}
      legend={<div className="flex gap-3"><Dot color={VIZ.aerobic} text="CTL (forme)" /><Dot color={VIZ.neuro} text="ATL (fatigue)" /></div>}>
      <polyline points={linePoints(ctl, 0, max, w)} fill="none" stroke={VIZ.aerobic} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={linePoints(atl, 0, max, w)} fill="none" stroke={VIZ.neuro} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </Chart>
  );
}

export function FormChart({ metrics }: { metrics: DailyMetric[] }) {
  const w = plotWidth(metrics.length);
  const tsb = metrics.map((m) => m.tsb ?? 0);
  const max = Math.max(15, ...tsb);
  const min = Math.min(-30, ...tsb);
  const span = max - min || 1;
  const yOf = (v: number) => H - ((v - min) / span) * H;
  const n = tsb.length;
  const bw = (w / Math.max(1, n)) * 0.7;
  return (
    <Chart label="Forme (TSB) — frais vs fatigué" unit="points (vert = frais · rouge = fatigue)"
      help={TSB_HELP}
      max={max} min={min} w={w} dates={metrics.map((m) => m.local_date)}>
      <rect x={0} y={yOf(-30)} width={w} height={H - yOf(-30)} fill={STATE.rest} opacity={0.07} />
      <rect x={0} y={yOf(10)} width={w} height={yOf(-10) - yOf(10)} fill={STATE.ready} opacity={0.08} />
      <line x1={0} y1={yOf(0)} x2={w} y2={yOf(0)} stroke={AXIS} strokeWidth={1} strokeDasharray="3 3" />
      {tsb.map((v, i) => {
        const x = ((i + 0.5) / n) * w - bw / 2;
        const y = yOf(Math.max(v, 0));
        const h = Math.abs(yOf(v) - yOf(0));
        return <rect key={i} x={x} y={y} width={bw} height={Math.max(0.5, h)} rx={1}
          fill={v >= 0 ? STATE.ready : v > -30 ? STATE.caution : STATE.rest} opacity={0.9} />;
      })}
    </Chart>
  );
}

export function ChannelChart({ metrics }: { metrics: DailyMetric[] }) {
  const w = plotWidth(metrics.length);
  const max = Math.max(1, ...metrics.map((m) => m.daily_load ?? 0)) * 1.05;
  const n = metrics.length;
  const bw = (w / Math.max(1, n)) * 0.7;
  return (
    <Chart label="Charge quotidienne par canal" unit="points de charge / jour" max={max} w={w} dates={metrics.map((m) => m.local_date)}
      help={CHANNEL_HELP}
      legend={<div className="flex gap-3"><Dot color={VIZ.aerobic} text="aérobie" /><Dot color={VIZ.neuro} text="neuromusculaire" /></div>}>
      {metrics.map((m, i) => {
        const x = ((i + 0.5) / n) * w - bw / 2;
        const aer = ((m.daily_aerobic_load ?? 0) / max) * H;
        const neu = ((m.daily_neuromuscular_load ?? 0) / max) * H;
        return (
          <g key={i}>
            <rect x={x} y={H - aer} width={bw} height={aer} fill={VIZ.aerobic} opacity={0.85} />
            <rect x={x} y={H - aer - neu} width={bw} height={neu} fill={VIZ.neuro} opacity={0.9} />
          </g>
        );
      })}
    </Chart>
  );
}

// ── Gauge (colored zone "slider") ─────────────────────────────────────────────

export type Zone = { from: number; to: number; color: string; label: string };

export function Gauge({ label, value, unit, min, max, zones }: {
  label: string; value: number | null; unit?: string; min: number; max: number; zones: Zone[];
}) {
  const pct = (v: number) => clamp(((v - min) / (max - min || 1)) * 100, 0, 100);
  const zone = value == null ? null : zones.find((z) => value >= z.from && value < z.to) ?? zones.at(-1)!;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-stone-600 dark:text-stone-300">{label}</span>
        <span className="text-lg font-semibold tabular-nums" style={{ color: zone?.color ?? MUTED }}>
          {value == null ? "—" : value.toFixed(unit === "" ? 0 : 1)}
          {unit && <span className="ml-0.5 text-xs font-normal text-stone-400">{unit}</span>}
        </span>
      </div>
      {/* Zones stay as a faint context backdrop; only the ACTIVE zone is tinted, so each gauge has a
          single colour accent (the current state) rather than a full rainbow. */}
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
        {zones.map((z, i) => (
          <div key={i} className="absolute top-0 h-full" style={{
            left: `${pct(z.from)}%`, width: `${pct(z.to) - pct(z.from)}%`, background: z.color,
            opacity: z === zone ? 0.6 : 0.16,
          }} />
        ))}
        {value != null && (
          <div className="absolute top-[-2px] h-[calc(100%+4px)] w-0.5 bg-stone-900 dark:bg-white"
            style={{ left: `calc(${pct(value)}% - 1px)` }} />
        )}
      </div>
      {zone && <div className="mt-1 text-xs font-medium" style={{ color: zone.color }}>{zone.label}</div>}
    </div>
  );
}
