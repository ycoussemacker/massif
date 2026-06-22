"use client";

/** Interactive time-series charts for the dashboard. Dependency-free SVG. The two "Forme" charts
 *  (fitness CTL/ATL and TSB) live in ONE fused card with the selected-day detail; they share a single
 *  selected date (synced crosshair) AND a synced horizontal scroll — moving the cursor or scrolling one
 *  moves the other to the same dates. The channel chart is a separate card below. Colours come only
 *  from theme.ts. The detail panel renders OUTSIDE the scroll container so it is never clipped. */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DailyMetric, Activity } from "@/lib/data";
import { HelpButton, type HelpContent } from "./help";
import { DayDetailPanel } from "./day-detail-panel";
import { groupByDate } from "@/lib/aggregate";
import { VIZ, STATE, AXIS } from "@/lib/theme";

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
    { type: "p", text: "Astuce : clique un point pour voir le jour exact et les activités qui composent la charge — le curseur et le défilement s'alignent sur les deux courbes de forme." },
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
    { type: "example", text: "CTL 35 et ATL 98 → TSB = −63 : grosse fatigue aiguë, repos conseillé. Clique une barre pour voir les séances du jour." },
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
    { type: "example", text: "Clique une barre pour voir quelles activités (trail, rando, bloc…) composent la charge du jour et leur répartition aéro / neuro." },
  ],
};

const H = 150;
const PX_PER_DAY = 20;
const plotWidth = (n: number) => Math.max(620, n * PX_PER_DAY);
const md = (iso: string) => iso.slice(5); // YYYY-MM-DD -> MM-DD

function linePoints(values: (number | null)[], min: number, max: number, w: number) {
  const span = max - min || 1;
  const n = values.length;
  return values
    .map((v, i) => (v == null ? null : [(i / Math.max(1, n - 1)) * w, H - ((v - min) / span) * H]))
    .filter((p): p is number[] => p !== null)
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

const Dot = ({ color, text }: { color: string; text: string }) => (
  <span className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
    <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />{text}
  </span>
);

/** Shared scroll group: charts that share one keep identical horizontal scroll positions. */
type ScrollGroup = { els: Set<HTMLDivElement>; lock: { v: boolean } };
const newScrollGroup = (): ScrollGroup => ({ els: new Set(), lock: { v: false } });

/** Shared interactive shell. Controlled selection (by date) so the crosshair stays in sync across
 *  charts; an optional scrollGroup keeps their horizontal scroll in lockstep; and the selected column
 *  is scrolled into view when the cursor moves. The detail panel is rendered once, at the section level. */
function InteractiveChart({
  label, legend, help, max, min = 0, unit, metrics, selected, onSelect, children, renderSelection,
  bare = false, scrollGroup,
}: {
  label: string;
  legend?: React.ReactNode;
  help?: HelpContent;
  max: number;
  min?: number;
  unit: string;
  metrics: DailyMetric[];
  selected: string | null;
  onSelect: (date: string | null) => void;
  children: React.ReactNode;
  renderSelection?: (i: number) => React.ReactNode;
  bare?: boolean;              // omit card chrome so several charts can share one card
  scrollGroup?: ScrollGroup;  // when set, horizontal scroll is mirrored across the group
}) {
  const n = metrics.length;
  const w = plotWidth(n);
  const mid = (max + min) / 2;
  const dates = metrics.map((m) => m.local_date);
  const sel = selected == null ? -1 : dates.indexOf(selected);
  const scrollRef = useRef<HTMLDivElement>(null);

  const leftOf = (i: number) => (i / n) * w;
  const slotW = w / n;
  const centerOf = (i: number) => ((i + 0.5) / n) * w;
  const pick = (i: number) => onSelect(dates[i] === selected ? null : dates[i]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onSelect(null); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); onSelect(dates[Math.min((sel < 0 ? -1 : sel) + 1, n - 1)]); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); onSelect(dates[Math.max((sel < 0 ? n : sel) - 1, 0)]); }
  };

  // Mount: show the newest data first; join the scroll-sync group (mirror scrollLeft across siblings).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    const g = scrollGroup;
    if (!g) return;
    g.els.add(el);
    const onScroll = () => {
      if (g.lock.v) return;
      g.lock.v = true;
      for (const other of g.els) if (other !== el) other.scrollLeft = el.scrollLeft;
      requestAnimationFrame(() => { g.lock.v = false; });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); g.els.delete(el); };
  }, [scrollGroup]);

  // Cursor moved: scroll the selected column into view (sync propagates to grouped siblings).
  useEffect(() => {
    if (sel < 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = centerOf(sel);
    const pad = 48;
    if (x < el.scrollLeft + pad) el.scrollLeft = x - pad;
    else if (x > el.scrollLeft + el.clientWidth - pad) el.scrollLeft = x - el.clientWidth + pad;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div className={bare ? "min-w-0" : "min-w-0 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-stone-700 dark:text-stone-300">
          {label}
          {help && <HelpButton content={help} />}
        </h3>
        {legend}
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <div className="flex w-9 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-stone-400" style={{ height: H }}>
          <span>{Math.round(max)}</span><span>{Math.round(mid)}</span><span>{Math.round(min)}</span>
        </div>
        <div ref={scrollRef} className="min-w-0 overflow-x-auto">
          <div style={{ width: w }}>
            <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block">
              {[0, H / 2, H].map((y) => (
                <line key={y} x1={0} y1={y} x2={w} y2={y} stroke="currentColor" className="text-stone-200 dark:text-stone-800" strokeWidth={1} />
              ))}
              {/* selection band — behind the data so the bars/lines stay readable */}
              {sel >= 0 && (
                <rect x={leftOf(sel)} y={0} width={slotW} height={H} fill="currentColor" className="text-stone-200 dark:text-stone-700" opacity={0.55} pointerEvents="none" />
              )}
              {children}
              {/* crosshair + chart-specific markers on top */}
              {sel >= 0 && (
                <g pointerEvents="none">
                  <line x1={centerOf(sel)} y1={0} x2={centerOf(sel)} y2={H} stroke={AXIS} strokeWidth={1} />
                  {renderSelection?.(sel)}
                </g>
              )}
              {/* hit layer — one transparent rect per day; one tab-stop group with arrow-key nav */}
              <g role="group" tabIndex={0} onKeyDown={onKey}
                aria-label="Graphique interactif — flèches gauche/droite pour parcourir les jours, Échap pour fermer"
                className="cursor-pointer outline-none">
                {metrics.map((m, i) => (
                  <rect key={m.local_date} x={leftOf(i)} y={0} width={slotW} height={H} fill="transparent"
                    onClick={() => pick(i)} aria-hidden />
                ))}
              </g>
            </svg>
            <div className="flex justify-between text-[10px] text-stone-400" style={{ width: w }}>
              <span>{dates[0] ? md(dates[0]) : ""}</span>
              <span>{dates.at(-1) ? md(dates.at(-1)!) : ""}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-1 pl-9 text-center text-[10px] text-stone-400">{unit}</div>
    </div>
  );
}

type ChartProps = {
  metrics: DailyMetric[];
  selected: string | null;
  onSelect: (date: string | null) => void;
  bare?: boolean;
  scrollGroup?: ScrollGroup;
};

function FitnessChart({ metrics, selected, onSelect, bare, scrollGroup }: ChartProps) {
  const w = plotWidth(metrics.length);
  const ctl = metrics.map((m) => m.ctl);
  const atl = metrics.map((m) => m.atl);
  const max = Math.max(1, ...ctl.map((v) => v ?? 0), ...atl.map((v) => v ?? 0)) * 1.1;
  const n = metrics.length;
  const yOf = (v: number) => H - (v / max) * H;
  const cx = (i: number) => ((i + 0.5) / n) * w;
  return (
    <InteractiveChart
      label="Forme — fitness vs fatigue" unit="points de charge" max={max} bare={bare} scrollGroup={scrollGroup}
      metrics={metrics} selected={selected} onSelect={onSelect} help={FITNESS_HELP}
      legend={<div className="flex gap-3"><Dot color={VIZ.aerobic} text="CTL (forme)" /><Dot color={VIZ.neuro} text="ATL (fatigue)" /></div>}
      renderSelection={(i) => (
        <>
          {ctl[i] != null && <circle cx={cx(i)} cy={yOf(ctl[i]!)} r={3} fill={VIZ.aerobic} />}
          {atl[i] != null && <circle cx={cx(i)} cy={yOf(atl[i]!)} r={3} fill={VIZ.neuro} />}
        </>
      )}
    >
      <polyline points={linePoints(ctl, 0, max, w)} fill="none" stroke={VIZ.aerobic} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={linePoints(atl, 0, max, w)} fill="none" stroke={VIZ.neuro} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </InteractiveChart>
  );
}

function FormChart({ metrics, selected, onSelect, bare, scrollGroup }: ChartProps) {
  const w = plotWidth(metrics.length);
  const tsb = metrics.map((m) => m.tsb ?? 0);
  const max = Math.max(15, ...tsb);
  const min = Math.min(-30, ...tsb);
  const span = max - min || 1;
  const yOf = (v: number) => H - ((v - min) / span) * H;
  const n = tsb.length;
  const bw = (w / Math.max(1, n)) * 0.7;
  return (
    <InteractiveChart
      label="Forme (TSB) — frais vs fatigué" unit="points (vert = frais · rouge = fatigue)"
      help={TSB_HELP} max={max} min={min} metrics={metrics} selected={selected} onSelect={onSelect} bare={bare} scrollGroup={scrollGroup}
    >
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
    </InteractiveChart>
  );
}

function ChannelChart({ metrics, selected, onSelect }: ChartProps) {
  const w = plotWidth(metrics.length);
  const max = Math.max(1, ...metrics.map((m) => m.daily_load ?? 0)) * 1.05;
  const n = metrics.length;
  const bw = (w / Math.max(1, n)) * 0.7;
  return (
    <InteractiveChart
      label="Charge quotidienne par canal" unit="points de charge / jour" max={max}
      metrics={metrics} selected={selected} onSelect={onSelect} help={CHANNEL_HELP}
      legend={<div className="flex gap-3"><Dot color={VIZ.aerobic} text="aérobie" /><Dot color={VIZ.neuro} text="neuromusculaire" /></div>}
    >
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
    </InteractiveChart>
  );
}

/** Dashboard charts. The two Forme charts + the day-detail share ONE fused card with a synced cursor
 *  AND synced horizontal scroll; the channel chart is a separate card below. */
export function ChartsSection({
  metrics, activities, avgLoad,
}: {
  metrics: DailyMetric[];
  activities: Activity[];
  avgLoad?: number | null;
}) {
  const activitiesByDate = useMemo(() => groupByDate(activities), [activities]);
  const [selected, setSelected] = useState<string | null>(null);
  const [formeScroll] = useState(newScrollGroup); // stable scroll-sync group for the two Forme charts
  const selMetric = selected ? metrics.find((m) => m.local_date === selected) ?? null : null;

  return (
    <div className="space-y-4">
      {/* Zone « Forme » fusionnée : les 2 courbes de forme + le détail du jour sélectionné */}
      <section className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">Forme</h2>
          <Link href="/analyse" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-stone-500 transition-colors hover:text-alpine-700 dark:text-stone-400 dark:hover:text-alpine-300">
            Analyser / comparer →
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <FitnessChart metrics={metrics} selected={selected} onSelect={setSelected} bare scrollGroup={formeScroll} />
          <FormChart metrics={metrics} selected={selected} onSelect={setSelected} bare scrollGroup={formeScroll} />
        </div>
        {selected && (
          <DayDetailPanel
            date={selected}
            metric={selMetric}
            activities={activitiesByDate.get(selected) ?? []}
            avgLoad={avgLoad}
            onClose={() => setSelected(null)}
          />
        )}
      </section>

      {/* Charge par canal : carte séparée (curseur synchronisé avec la zone Forme) */}
      <ChannelChart metrics={metrics} selected={selected} onSelect={setSelected} />
    </div>
  );
}
