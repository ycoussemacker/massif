"use client";

/** Interactive Forme charts for the dashboard. Dependency-free SVG, minimal style (no y-axis column,
 *  no gridlines — matching the indicator sparklines). The two "Forme" charts (fitness CTL/ATL and TSB)
 *  share ONE fused card with the selected-day detail, a synced cursor AND a synced horizontal scroll.
 *
 *  Two behaviours specific to this card:
 *   • The vertical scale adapts to the VISIBLE window — only the points within the scroll viewport set
 *     max/min, so an off-screen extreme never squashes what you're looking at. (We also only DRAW the
 *     visible slice, so it stays fast no matter how much history is loaded.)
 *   • History loads ON DEMAND only: scroll to the left edge → a loader shows → the previous 2 months
 *     are fetched and prepended (scroll position preserved). Nothing older is fetched otherwise. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DailyMetric, Activity } from "@/lib/data";
import { loadOlderForme } from "@/app/actions";
import { HelpButton, type HelpContent } from "./help";
import { DayDetailPanel } from "./day-detail-panel";
import { groupByDateSpanned } from "@/lib/aggregate";
import { VIZ, STATE, AXIS } from "@/lib/theme";

const LOAD_MONTHS = 2; // months fetched per scroll-to-edge

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
    { type: "p", text: "L'échelle verticale s'adapte à ce qui est visible ; fais défiler vers la gauche jusqu'à la butée pour charger l'historique antérieur. Clique un point pour le détail du jour." },
  ],
};

const TSB_HELP: HelpContent = {
  title: "TSB — fraîcheur (forme du jour)",
  blocks: [
    { type: "p", text: "Le TSB (Training Stress Balance) mesure ta fraîcheur : l'écart entre ta forme de fond et ta fatigue récente." },
    { type: "formula", lines: ["TSB = CTL − ATL   (en points)"] },
    { type: "dl", items: [
      { k: "> +10% CTL", v: "frais / affûté — idéal juste avant une course." },
      { k: "−10% à +10%", v: "équilibre." },
      { k: "−30% à −10%", v: "fatigue productive — normal en bloc d'entraînement." },
      { k: "< −30% CTL", v: "surcharge / risque de blessure (bande rouge)." },
    ] },
    { type: "p", text: "Les seuils s'adaptent à ta charge chronique (CTL) — la même fatigue « pèse » plus quand tu es peu entraîné. À CTL 85, la zone productive va de ≈ −9 à −25 pts ; à CTL 150, de ≈ −15 à −45." },
  ],
};

const H = 150;
const PX_PER_DAY = 20;
const plotWidth = (n: number) => Math.max(620, n * PX_PER_DAY);
const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
// Abscissa label for a month boundary — month name, plus the 2-digit year each January.
const monthLabel = (iso: string) => {
  const m = Number(iso.slice(5, 7));
  return MONTHS_FR[m - 1] + (m === 1 ? ` ${iso.slice(2, 4)}` : "");
};

const Dot = ({ color, text }: { color: string; text: string }) => (
  <span className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
    <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />{text}
  </span>
);

type Vis = { lo: number; hi: number };
type RegisterScroll = (el: HTMLDivElement, onScroll: () => void) => () => void;

/** Horizontal-scroll sync for sibling charts. Mutable state (the element set + a re-entrancy lock)
 *  lives in refs touched only inside callbacks — never during render — so it's compiler-clean. */
function useScrollSync(): { register: RegisterScroll; adjustAll: (dx: number) => void } {
  // Lazily create the Set INSIDE the callbacks (not in the useRef initializer) so the compiler doesn't
  // treat it — and the DOM nodes reachable from it — as render-frozen / immutable.
  const elsRef = useRef<Set<HTMLDivElement> | null>(null);
  const lock = useRef(false);
  const register = useCallback<RegisterScroll>((el, onScroll) => {
    const set = (elsRef.current ??= new Set<HTMLDivElement>());
    set.add(el);
    const handler = () => {
      if (!lock.current) {
        lock.current = true;
        for (const o of set) if (o !== el) o.scrollLeft = el.scrollLeft;
        requestAnimationFrame(() => { lock.current = false; });
      }
      onScroll();
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => { el.removeEventListener("scroll", handler); set.delete(el); };
  }, []);
  const adjustAll = useCallback((dx: number) => {
    const set = elsRef.current;
    if (!set) return;
    lock.current = true;
    for (const el of set) el.scrollLeft += dx;
    requestAnimationFrame(() => { lock.current = false; });
  }, []);
  return { register, adjustAll };
}

/** Shared interactive shell. Controlled selection (synced crosshair) + synced scroll (via `register`)
 *  + visible-window scale (children/renderSelection receive the visible index range) + a
 *  scroll-to-left-edge callback for on-demand history. */
function InteractiveChart({
  label, legend, help, unit, metrics, selected, onSelect, children, renderSelection, axis,
  bare = false, register, onReachStart, loadingOlder = false,
}: {
  label: string;
  legend?: React.ReactNode;
  help?: HelpContent;
  unit: string;
  metrics: DailyMetric[];
  selected: string | null;
  onSelect: (date: string | null) => void;
  children: (vis: Vis) => React.ReactNode;
  renderSelection?: (i: number, vis: Vis) => React.ReactNode;
  axis: (vis: Vis) => { min: number; max: number };
  bare?: boolean;
  register: RegisterScroll;
  onReachStart?: () => void;
  loadingOlder?: boolean;
}) {
  const n = metrics.length;
  const w = plotWidth(n);
  const slotW = w / n;
  const dates = metrics.map((m) => m.local_date);
  const sel = selected == null ? -1 : dates.indexOf(selected);
  const scrollRef = useRef<HTMLDivElement>(null);

  const leftOf = (i: number) => (i / n) * w;
  const centerOf = (i: number) => ((i + 0.5) / n) * w;
  const pick = (i: number) => onSelect(dates[i] === selected ? null : dates[i]);

  const [vis, setVis] = useState<Vis>({ lo: 0, hi: Math.max(0, n - 1) });

  // Latest geometry + callback, read by the (mount-only) scroll listener so it stays correct after the
  // series grows on a prepend without re-binding (which would re-trigger the scroll-to-newest).
  const paramsRef = useRef({ n, w, slotW, onReachStart });
  useEffect(() => { paramsRef.current = { n, w, slotW, onReachStart }; });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onSelect(null); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); onSelect(dates[Math.min((sel < 0 ? -1 : sel) + 1, n - 1)]); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); onSelect(dates[Math.max((sel < 0 ? n : sel) - 1, 0)]); }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const recompute = () => {
      const p = paramsRef.current;
      const lo = Math.max(0, Math.floor(el.scrollLeft / p.slotW) - 1);
      const hi = Math.min(p.n - 1, Math.ceil((el.scrollLeft + el.clientWidth) / p.slotW) + 1);
      setVis((prev) => (prev.lo === lo && prev.hi === hi ? prev : { lo, hi }));
    };
    el.scrollLeft = el.scrollWidth; // newest first
    recompute();
    let raf = 0;
    const cleanup = register(el, () => {
      if (el.scrollWidth > el.clientWidth + 8 && el.scrollLeft <= 8) paramsRef.current.onReachStart?.();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    });
    return () => { cleanup(); cancelAnimationFrame(raf); };
  }, [register]);

  // Keep the selected column in view when the cursor moves (sync propagates to grouped siblings).
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

  const ax = axis(vis); // ordinate scale for the CURRENT visible window
  const monthTicks = dates.flatMap((d, i) => (d.slice(8, 10) === "01" ? [{ i, x: leftOf(i), label: monthLabel(d) }] : []));

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
        {/* Ordinate values — reflect the VISIBLE window's scale (update as you scroll/rescale). */}
        <div className="flex w-9 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-stone-400" style={{ height: H }}>
          <span>{Math.round(ax.max)}</span><span>{Math.round((ax.max + ax.min) / 2)}</span><span>{Math.round(ax.min)}</span>
        </div>
        <div className="relative">
          {loadingOlder && (
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2 py-1 text-[10px] font-medium text-stone-500 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900/90 dark:text-stone-400 dark:ring-stone-700">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-stone-300 border-t-stone-500 dark:border-stone-600 dark:border-t-stone-300" />
                historique…
              </span>
            </div>
          )}
          <div ref={scrollRef} className="min-w-0 overflow-x-auto">
            <div style={{ width: w }}>
              <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block">
                {sel >= 0 && (
                  <rect x={leftOf(sel)} y={0} width={slotW} height={H} fill="currentColor" className="text-stone-200 dark:text-stone-700" opacity={0.5} pointerEvents="none" />
                )}
                {children(vis)}
                {sel >= 0 && (
                  <g pointerEvents="none">
                    <line x1={centerOf(sel)} y1={0} x2={centerOf(sel)} y2={H} stroke={AXIS} strokeWidth={1} />
                    {renderSelection?.(sel, vis)}
                  </g>
                )}
                <g role="group" tabIndex={0} onKeyDown={onKey}
                  aria-label="Graphique interactif — flèches gauche/droite pour parcourir les jours, Échap pour fermer"
                  className="cursor-pointer outline-none">
                  {metrics.map((m, i) => (
                    <rect key={m.local_date} x={leftOf(i)} y={0} width={slotW} height={H} fill="transparent" onClick={() => pick(i)} aria-hidden />
                  ))}
                </g>
              </svg>
              {/* Abscissa — key dates (month boundaries), scrolling with the plot. */}
              <div className="relative h-3.5" style={{ width: w }}>
                {monthTicks.map((t) => (
                  <span key={t.i} className="absolute top-0 whitespace-nowrap text-[10px] tabular-nums text-stone-400" style={{ left: t.x }}>{t.label}</span>
                ))}
              </div>
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
  register: RegisterScroll;
  onReachStart?: () => void;
  loadingOlder?: boolean;
};

function FitnessChart(props: ChartProps) {
  const { metrics } = props;
  const w = plotWidth(metrics.length);
  const n = metrics.length;
  const ctl = metrics.map((m) => m.ctl);
  const atl = metrics.map((m) => m.atl);
  const cx = (i: number) => ((i + 0.5) / n) * w;
  const scaleFor = (vis: Vis) => {
    const lo = Math.max(0, vis.lo - 1), hi = Math.min(n - 1, vis.hi + 1);
    let mx = 1;
    for (let i = lo; i <= hi; i++) { const c = ctl[i], a = atl[i]; if (c != null) mx = Math.max(mx, c); if (a != null) mx = Math.max(mx, a); }
    return { lo, hi, max: mx * 1.1 };
  };
  const lineOf = (vals: (number | null)[], lo: number, hi: number, yOf: (v: number) => number) => {
    const pts: string[] = [];
    for (let i = lo; i <= hi; i++) { const v = vals[i]; if (v != null) pts.push(`${cx(i).toFixed(1)},${yOf(v).toFixed(1)}`); }
    return pts.join(" ");
  };
  return (
    <InteractiveChart
      label="Forme — fitness vs fatigue" unit="points de charge" help={FITNESS_HELP}
      bare={props.bare} register={props.register} onReachStart={props.onReachStart} loadingOlder={props.loadingOlder}
      metrics={metrics} selected={props.selected} onSelect={props.onSelect}
      axis={(vis) => ({ min: 0, max: scaleFor(vis).max })}
      legend={<div className="flex gap-3"><Dot color={VIZ.aerobic} text="CTL (forme)" /><Dot color={VIZ.neuro} text="ATL (fatigue)" /></div>}
      renderSelection={(i, vis) => {
        const { max } = scaleFor(vis);
        const yOf = (v: number) => H - (v / max) * H;
        return (
          <>
            {ctl[i] != null && <circle cx={cx(i)} cy={yOf(ctl[i]!)} r={3} fill={VIZ.aerobic} />}
            {atl[i] != null && <circle cx={cx(i)} cy={yOf(atl[i]!)} r={3} fill={VIZ.neuro} />}
          </>
        );
      }}
    >
      {(vis) => {
        const { lo, hi, max } = scaleFor(vis);
        const yOf = (v: number) => H - (v / max) * H;
        return (
          <>
            <polyline points={lineOf(ctl, lo, hi, yOf)} fill="none" stroke={VIZ.aerobic} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={lineOf(atl, lo, hi, yOf)} fill="none" stroke={VIZ.neuro} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        );
      }}
    </InteractiveChart>
  );
}

function FormChart(props: ChartProps) {
  const { metrics } = props;
  const w = plotWidth(metrics.length);
  const n = metrics.length;
  const tsb = metrics.map((m) => m.tsb ?? 0);
  const bw = (w / Math.max(1, n)) * 0.7;
  const scaleFor = (vis: Vis) => {
    const lo = Math.max(0, vis.lo - 1), hi = Math.min(n - 1, vis.hi + 1);
    let mx = 15, mn = -30;
    for (let i = lo; i <= hi; i++) { mx = Math.max(mx, tsb[i]); mn = Math.min(mn, tsb[i]); }
    return { lo, hi, max: mx, min: mn };
  };
  return (
    <InteractiveChart
      label="Forme (TSB) — frais vs fatigué" unit="points (vert = frais · rouge = fatigue)" help={TSB_HELP}
      bare={props.bare} register={props.register} onReachStart={props.onReachStart} loadingOlder={props.loadingOlder}
      metrics={metrics} selected={props.selected} onSelect={props.onSelect}
      axis={(vis) => { const s = scaleFor(vis); return { min: s.min, max: s.max }; }}
    >
      {(vis) => {
        const { lo, hi, max, min } = scaleFor(vis);
        const span = max - min || 1;
        const yOf = (v: number) => H - ((v - min) / span) * H;
        return (
          <>
            <rect x={0} y={yOf(-30)} width={w} height={H - yOf(-30)} fill={STATE.rest} opacity={0.07} />
            <rect x={0} y={yOf(10)} width={w} height={yOf(-10) - yOf(10)} fill={STATE.ready} opacity={0.08} />
            <line x1={0} y1={yOf(0)} x2={w} y2={yOf(0)} stroke={AXIS} strokeWidth={1} strokeDasharray="3 3" />
            {Array.from({ length: Math.max(0, hi - lo + 1) }, (_, k) => lo + k).map((i) => {
              const v = tsb[i];
              const x = ((i + 0.5) / n) * w - bw / 2;
              const y = yOf(Math.max(v, 0));
              const h = Math.abs(yOf(v) - yOf(0));
              return <rect key={i} x={x} y={y} width={bw} height={Math.max(0.5, h)} rx={1}
                fill={v >= 0 ? STATE.ready : v > -30 ? STATE.caution : STATE.rest} opacity={0.9} />;
            })}
          </>
        );
      }}
    </InteractiveChart>
  );
}

/** Dashboard "Forme" card — fused CTL/ATL + TSB + day detail, synced cursor + synced scroll, with
 *  on-demand history (scroll to the left edge loads the previous months, position preserved). */
export function ChartsSection({
  metrics: initialMetrics, activities: initialActivities, avgLoad,
}: {
  metrics: DailyMetric[];
  activities: Activity[];
  avgLoad?: number | null;
}) {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [activities, setActivities] = useState(initialActivities);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedFloor, setReachedFloor] = useState(false);
  const { register, adjustAll } = useScrollSync();
  const busyRef = useRef(false);     // synchronous guard (two synced charts fire in the same tick)
  const pendingPrepend = useRef(0);   // days prepended, awaiting scroll-position preservation

  const activitiesByDate = useMemo(() => groupByDateSpanned(activities), [activities]);
  const selMetric = selected ? metrics.find((m) => m.local_date === selected) ?? null : null;
  // A server refresh (new data) remounts this island via its `key` in page.tsx → state resets to the
  // fresh 2-month window. No prop→state sync effect needed.

  const onReachStart = useCallback(() => {
    if (busyRef.current || reachedFloor) return;
    const oldest = metrics[0]?.local_date;
    if (!oldest) return;
    busyRef.current = true;
    setLoadingOlder(true);
    loadOlderForme(oldest, LOAD_MONTHS)
      .then((res) => {
        if (!res.metrics.length) setReachedFloor(true);
        else {
          pendingPrepend.current = res.metrics.length;
          setMetrics((prev) => [...res.metrics, ...prev]);
          setActivities((prev) => [...res.activities, ...prev]);
        }
      })
      .finally(() => { busyRef.current = false; setLoadingOlder(false); });
  }, [reachedFloor, metrics]);

  // Preserve the viewport when older data is prepended (the SVG grows on the left). Every grouped
  // scroll element gets the same delta, so the resulting scroll/sync events are a no-op.
  useLayoutEffect(() => {
    if (pendingPrepend.current <= 0) return;
    const dx = pendingPrepend.current * PX_PER_DAY;
    pendingPrepend.current = 0;
    adjustAll(dx);
  }, [metrics, adjustAll]);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">Forme</h2>
        <Link href="/analyse" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-stone-500 transition-colors hover:text-alpine-700 dark:text-stone-400 dark:hover:text-alpine-300">
          Analyser / comparer →
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <FitnessChart metrics={metrics} selected={selected} onSelect={setSelected} bare register={register} onReachStart={onReachStart} loadingOlder={loadingOlder} />
        <FormChart metrics={metrics} selected={selected} onSelect={setSelected} bare register={register} onReachStart={onReachStart} loadingOlder={loadingOlder} />
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
  );
}
