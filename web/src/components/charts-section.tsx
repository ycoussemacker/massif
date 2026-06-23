"use client";

/** "Indicateurs clés" — the unified dashboard section. CTL / ATL / TSB are interactive charts that keep
 *  the Forme interaction (synced crosshair + synced horizontal scroll + scroll-to-edge history) AND the
 *  KPI tile look (thin "mountain-ridge" curve, current/selected score, y-axis min/max). Selecting a day
 *  is a SCRUBBER: every indicator below (the 3 scores, Monotonie/ACWR/Disponibilité bars, Fraîcheur, and
 *  the day-detail panel) shows that day's value; with no selection everything shows today — flagged by
 *  the « (aujourd'hui) » → date label. Desktop: CTL · ATL · TSB side by side. Mobile: CTL+ATL fused, then
 *  TSB; movement always synchronised. Dependency-free SVG. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DailyMetric, Activity } from "@/lib/data";
import { loadOlderForme } from "@/app/actions";
import { HelpButton, type HelpContent } from "./help";
import { DayDetailPanel } from "./day-detail-panel";
import { Gauge, type Zone } from "./charts";
import { SparklineTile } from "./sparkline";
import { groupByDateSpanned, rollingMonotony } from "@/lib/aggregate";
import { fmt } from "@/lib/format";
import { VIZ, STATE, AXIS, MUTED } from "@/lib/theme";

const H = 112;
const PX_PER_DAY = 12;
const LOAD_MONTHS = 2;
const plotWidth = (n: number) => n * PX_PER_DAY;
const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthLabel = (iso: string) => MONTHS_FR[Number(iso.slice(5, 7)) - 1] + (iso.slice(5, 7) === "01" ? ` ${iso.slice(2, 4)}` : "");
const shortDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

// ── help popovers ────────────────────────────────────────────────────────────────────────────────
const CTL_HELP: HelpContent = { title: "CTL · forme", blocks: [
  { type: "p", text: "Ta forme de fond (« fitness ») : la charge d'entraînement moyenne lissée sur ~42 jours. Monte lentement, redescend au repos." },
  { type: "formula", lines: ["CTL = moyenne expo ~42 j de la charge quotidienne"] },
  { type: "dl", items: [
    { k: "Unité", v: "points de charge (≈ TSS ; 100 pts ≈ 1 h à intensité seuil)." },
    { k: "Lecture", v: "plus haut = plus en forme ; c'est la tendance qui compte." },
    { k: "Sélection", v: "clique un jour → tous les indicateurs passent sur ce jour ; sinon = aujourd'hui." },
  ] } ] };
const ATL_HELP: HelpContent = { title: "ATL · fatigue", blocks: [
  { type: "p", text: "Ta fatigue récente : la même charge lissée sur ~7 jours. Monte vite, redescend en quelques jours." },
  { type: "formula", lines: ["ATL = moyenne expo ~7 j de la charge quotidienne"] },
  { type: "dl", items: [
    { k: "Unité", v: "points de charge (même échelle que le CTL)." },
    { k: "Repère", v: "la courbe claire en fond = ton CTL ; ATL au-dessus = tu accumules de la fatigue, en-dessous = tu récupères." },
  ] } ] };
const TSB_HELP: HelpContent = { title: "TSB · forme (fraîcheur)", blocks: [
  { type: "p", text: "Ta fraîcheur : l'écart entre ta forme de fond et ta fatigue récente." },
  { type: "formula", lines: ["TSB = CTL − ATL   (en points)"] },
  { type: "dl", items: [
    { k: "Lecture", v: "les seuils s'adaptent au CTL — frais > +10 % · équilibre ±10 % · fatigue productive −30 % à −10 % · surcharge < −30 %." },
    { k: "Barres", v: "vert = frais · ambre = fatigue productive · rouge = surcharge." },
  ] } ] };
const MONO_HELP: HelpContent = { title: "Monotonie · 7 j", blocks: [
  { type: "p", text: "Mesure si l'entraînement est trop uniforme (toujours pareil, sans contraste facile / dur) → plus de risque à charge égale." },
  { type: "formula", lines: ["Monotonie = charge moyenne ÷ écart-type (7 j glissants)"] },
  { type: "dl", items: [{ k: "Lecture", v: "< 1,5 sain · 1,5–2 à surveiller · > 2 risque." }] } ] };
const ACWR_HELP: HelpContent = { title: "ACWR · ratio de charge", blocks: [
  { type: "p", text: "Rapport fatigue récente / forme de fond : indique si tu montes en charge trop vite." },
  { type: "formula", lines: ["ACWR = ATL ÷ CTL"] },
  { type: "dl", items: [{ k: "Lecture", v: "< 0,8 sous-charge · 0,8–1,3 zone idéale · 1,3–1,5 élevé · > 1,5 risque." }] } ] };
const READY_HELP: HelpContent = { title: "Disponibilité (Garmin)", blocks: [
  { type: "p", text: "Score de préparation calculé par la montre Garmin (sommeil, VFC, stress, charge récente)." },
  { type: "dl", items: [
    { k: "Unité", v: "0 à 100." },
    { k: "Lecture", v: "≥ 70 bon · 50–70 modéré · 30–50 bas · < 30 très bas." },
    { k: "Source", v: "Garmin ; n'inclut PAS la fatigue neuromusculaire (voir Fraîcheur)." },
  ] } ] };
const FRESH_AERO_HELP: HelpContent = { title: "Fraîcheur aérobie", blocks: [
  { type: "p", text: "Fraîcheur du moteur cardiovasculaire ; récupère vite (jours), visible dans la VFC / Body Battery." },
  { type: "formula", lines: ["= CTL aérobie − ATL aérobie  (τ aigu ~7 j)"] },
  { type: "dl", items: [{ k: "Repère", v: "ligne 0 = équilibre ; positif = frais, négatif = fatigué." }] } ] };
const FRESH_NEURO_HELP: HelpContent = { title: "Fraîcheur neuromusculaire", blocks: [
  { type: "p", text: "Fraîcheur muscles / tendons / structures (descentes, impacts, port de charge) ; récupère lentement (~2 sem), invisible aux montres." },
  { type: "formula", lines: ["= CTL neuro − ATL neuro  (τ aigu ~14 j, plus lent)"] },
  { type: "dl", items: [{ k: "Repère", v: "ligne 0 = équilibre ; peut rester négatif après de grosses descentes même si la VFC est bonne." }] } ] };

// ── gauge zones (selected-day bars) ────────────────────────────────────────────────────────────────
const monoZones = (max: number): Zone[] => [
  { from: 0, to: 1.5, color: STATE.ready, label: "sain" },
  { from: 1.5, to: 2, color: STATE.caution, label: "à surveiller" },
  { from: 2, to: max, color: STATE.rest, label: "risque" },
];
const acwrZones = (max: number): Zone[] => [
  { from: 0, to: 0.8, color: STATE.cool, label: "sous-charge" },
  { from: 0.8, to: 1.3, color: STATE.ready, label: "zone idéale" },
  { from: 1.3, to: 1.5, color: STATE.caution, label: "élevé" },
  { from: 1.5, to: max, color: STATE.rest, label: "risque de blessure" },
];
const readyZones: Zone[] = [
  { from: 0, to: 30, color: STATE.rest, label: "très bas" },
  { from: 30, to: 50, color: STATE.caution, label: "bas" },
  { from: 50, to: 70, color: STATE.cautionSoft, label: "modéré" },
  { from: 70, to: 100, color: STATE.ready, label: "bon" },
];

type Vis = { lo: number; hi: number };
type RegisterScroll = (el: HTMLDivElement, onScroll: () => void) => () => void;

/** Horizontal-scroll sync for sibling charts (mutable state in refs, touched only in callbacks). */
function useScrollSync(): { register: RegisterScroll; adjustAll: (dx: number) => void } {
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

/** Viewport-width watcher → lets us render the desktop (3-up) vs mobile (fused) chart set, never both. */
function useIsNarrow(query = "(max-width: 1023px)"): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

/** Shared interactive shell: KPI header (label + help + score) over an interactive plot with a synced
 *  crosshair, visible-window scale, synced scroll and scroll-to-left-edge history. */
function InteractiveChart({
  label, help, score, unit, metrics, selected, onSelect, children, renderSelection, axis,
  register, onReachStart, loadingOlder = false,
}: {
  label: React.ReactNode;
  help?: HelpContent;
  score: React.ReactNode;
  unit: string;
  metrics: DailyMetric[];
  selected: string | null;
  onSelect: (date: string | null) => void;
  children: (vis: Vis) => React.ReactNode;
  renderSelection?: (i: number, vis: Vis) => React.ReactNode;
  axis: (vis: Vis) => { min: number; max: number };
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

  useEffect(() => {
    if (sel < 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = centerOf(sel);
    const pad = 40;
    if (x < el.scrollLeft + pad) el.scrollLeft = x - pad;
    else if (x > el.scrollLeft + el.clientWidth - pad) el.scrollLeft = x - el.clientWidth + pad;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const ax = axis(vis);
  const monthTicks = dates.flatMap((d, i) => (d.slice(8, 10) === "01" ? [{ i, x: leftOf(i), label: monthLabel(d) }] : []));

  return (
    <div className="min-w-0">
      <div className="mb-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
          {label}{help && <HelpButton content={help} />}
        </div>
        <div className="mt-0.5">{score}</div>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-1.5">
        <div className="flex w-7 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-stone-400" style={{ height: H }}>
          <span>{Math.round(ax.max)}</span><span>{Math.round(ax.min)}</span>
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
              <div className="relative h-3.5" style={{ width: w }}>
                {monthTicks.map((t) => (
                  <span key={t.i} className="absolute top-0 whitespace-nowrap text-[10px] tabular-nums text-stone-400" style={{ left: t.x }}>{t.label}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-1 pl-[34px] text-[10px] text-stone-400">{unit}</div>
    </div>
  );
}

const fmtScore = (v: number | null | undefined, color?: string) => (
  <div className="text-2xl font-semibold leading-none tabular-nums" style={color ? { color } : undefined}>{fmt(v, 1)}</div>
);

// thin "mountain-ridge" line over the visible window, shared-scale, with optional faint reference curve
function lineChart(
  series: { vals: (number | null)[]; color: string }[], refVals: (number | null)[] | null, n: number, w: number,
) {
  const cx = (i: number) => ((i + 0.5) / n) * w;
  const scaleFor = (vis: Vis) => {
    const lo = Math.max(0, vis.lo - 1), hi = Math.min(n - 1, vis.hi + 1);
    let mx = 1;
    for (let i = lo; i <= hi; i++) {
      for (const s of series) { const v = s.vals[i]; if (v != null) mx = Math.max(mx, v); }
      if (refVals) { const r = refVals[i]; if (r != null) mx = Math.max(mx, r); }
    }
    return { lo, hi, max: mx * 1.1 };
  };
  const poly = (vals: (number | null)[], lo: number, hi: number, yOf: (v: number) => number) => {
    const pts: string[] = [];
    for (let i = lo; i <= hi; i++) { const v = vals[i]; if (v != null) pts.push(`${cx(i).toFixed(1)},${yOf(v).toFixed(1)}`); }
    return pts.join(" ");
  };
  return { cx, scaleFor, poly };
}

// ── the dashboard section ──────────────────────────────────────────────────────────────────────────
export function ChartsSection({
  metrics: initialMetrics, activities: initialActivities,
}: {
  metrics: DailyMetric[];
  activities: Activity[];
}) {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [activities, setActivities] = useState(initialActivities);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedFloor, setReachedFloor] = useState(false);
  const { register, adjustAll } = useScrollSync();
  const busyRef = useRef(false);
  const pendingPrepend = useRef(0);
  const narrow = useIsNarrow();

  const activitiesByDate = useMemo(() => groupByDateSpanned(activities), [activities]);
  const monoSeries = useMemo(() => rollingMonotony(metrics.map((m) => m.daily_load ?? 0)), [metrics]);

  // The day every indicator reflects: the selected day, else the latest day that has a computed model.
  const latestIdx = useMemo(() => {
    for (let i = metrics.length - 1; i >= 0; i--) if (metrics[i].ctl != null) return i;
    return metrics.length - 1;
  }, [metrics]);
  const latestDate = metrics[latestIdx]?.local_date ?? null;
  const selIdx = selected ? metrics.findIndex((m) => m.local_date === selected) : latestIdx;
  const selM = metrics[selIdx] ?? null;
  const isToday = !selected || selected === latestDate;
  const dayLabel = isToday ? "(aujourd'hui)" : shortDate(selected!);
  const panelDate = selected ?? latestDate;

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

  useLayoutEffect(() => {
    if (pendingPrepend.current <= 0) return;
    const dx = pendingPrepend.current * PX_PER_DAY;
    pendingPrepend.current = 0;
    adjustAll(dx);
  }, [metrics, adjustAll]);

  const shared = { metrics, selected, onSelect: setSelected, register, onReachStart, loadingOlder };
  const ctlNode = <CtlAtlChart {...shared} kind="ctl" selM={selM} />;
  const atlNode = <CtlAtlChart {...shared} kind="atl" selM={selM} />;
  const fusedNode = <CtlAtlChart {...shared} kind="fused" selM={selM} />;
  const tsbNode = <TsbChart {...shared} selM={selM} />;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">
          Indicateurs clés <span className={`ml-1 text-xs font-normal ${isToday ? "text-stone-400" : "text-alpine-600 dark:text-alpine-400"}`}>{dayLabel}</span>
        </h2>
        <Link href="/analyse" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-stone-500 transition-colors hover:text-alpine-700 dark:text-stone-400 dark:hover:text-alpine-300">
          Analyser / comparer →
        </Link>
      </div>

      {/* CTL · ATL · TSB — desktop 3-up / mobile fused + TSB. Selecting a day scrubs every indicator. */}
      {narrow ? (
        <div className="space-y-4">{fusedNode}{tsbNode}</div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">{ctlNode}{atlNode}{tsbNode}</div>
      )}

      {/* Day detail — activities of the selected (or today's) day, just under the TSB chart. */}
      {panelDate && (
        <DayDetailPanel
          date={panelDate}
          activities={activitiesByDate.get(panelDate) ?? []}
          onClose={selected ? () => setSelected(null) : undefined}
        />
      )}

      {/* Secondary indicators — the SELECTED day's values. */}
      <div className="mt-6 grid gap-5 sm:grid-cols-3">
        <Gauge label="Monotonie · 7 j" help={MONO_HELP} value={monoSeries[selIdx] ?? null} min={0}
          max={Math.max(2.2, (monoSeries[selIdx] ?? 0) + 0.2)} zones={monoZones(Math.max(2.2, (monoSeries[selIdx] ?? 0) + 0.2))} />
        <Gauge label="ACWR · ratio de charge" help={ACWR_HELP} value={selM?.acwr ?? null} min={0}
          max={Math.max(2, (selM?.acwr ?? 0) + 0.1)} zones={acwrZones(Math.max(2, (selM?.acwr ?? 0) + 0.1))} />
        <Gauge label="Disponibilité (Garmin)" help={READY_HELP} value={selM?.training_readiness ?? null} unit="" min={0} max={100} zones={readyZones} />
      </div>

      {/* Fraîcheur par système — the selected day's per-channel form. */}
      <h3 className="mt-6 mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">Fraîcheur par système</h3>
      <div className="grid grid-cols-2 gap-4 sm:gap-5">
        <FreshTile label="Fraîcheur aérobie" help={FRESH_AERO_HELP} color={VIZ.aerobic}
          value={selM?.tsb_aerobic ?? null} series={metrics.map((m) => m.tsb_aerobic)} ctl={selM?.ctl_aerobic ?? null} />
        <FreshTile label="Fraîcheur neuromusculaire" help={FRESH_NEURO_HELP} color={VIZ.neuro}
          value={selM?.tsb_neuromuscular ?? null} series={metrics.map((m) => m.tsb_neuromuscular)} ctl={selM?.ctl_neuromuscular ?? null} />
      </div>
    </section>
  );
}

type SharedChart = {
  metrics: DailyMetric[];
  selected: string | null;
  onSelect: (d: string | null) => void;
  register: RegisterScroll;
  onReachStart?: () => void;
  loadingOlder?: boolean;
  selM: DailyMetric | null;
};

/** CTL / ATL line chart — or both fused (mobile). Thin ridge line(s); ATL alone shows a faint CTL ref. */
function CtlAtlChart({ kind, metrics, selected, onSelect, register, onReachStart, loadingOlder, selM }: SharedChart & { kind: "ctl" | "atl" | "fused" }) {
  const n = metrics.length;
  const w = plotWidth(n);
  const ctl = metrics.map((m) => m.ctl);
  const atl = metrics.map((m) => m.atl);
  const series = kind === "ctl" ? [{ vals: ctl, color: VIZ.aerobic }]
    : kind === "atl" ? [{ vals: atl, color: VIZ.neuro }]
    : [{ vals: ctl, color: VIZ.aerobic }, { vals: atl, color: VIZ.neuro }];
  const refVals = kind === "atl" ? ctl : null; // faint CTL behind ATL
  const { cx, scaleFor, poly } = lineChart(series, refVals, n, w);

  const label = kind === "ctl" ? "CTL · forme" : kind === "atl" ? "ATL · fatigue" : "CTL · ATL";
  const help = kind === "atl" ? ATL_HELP : CTL_HELP;
  const score = kind === "fused" ? (
    <div className="flex items-baseline gap-3">
      <span className="text-2xl font-semibold tabular-nums" style={{ color: VIZ.aerobic }}>{fmt(selM?.ctl, 1)}</span>
      <span className="text-2xl font-semibold tabular-nums" style={{ color: VIZ.neuro }}>{fmt(selM?.atl, 1)}</span>
      <span className="text-[11px] text-stone-400">CTL · ATL</span>
    </div>
  ) : fmtScore(kind === "ctl" ? selM?.ctl : selM?.atl, kind === "atl" ? VIZ.neuro : undefined);

  return (
    <InteractiveChart
      label={label} help={help} score={score} unit="points de charge"
      metrics={metrics} selected={selected} onSelect={onSelect} register={register} onReachStart={onReachStart} loadingOlder={loadingOlder}
      axis={(vis) => ({ min: 0, max: scaleFor(vis).max })}
      renderSelection={(i, vis) => {
        const { max } = scaleFor(vis);
        const yOf = (v: number) => H - (v / max) * H;
        return (<>{series.map((s, k) => (s.vals[i] != null ? <circle key={k} cx={cx(i)} cy={yOf(s.vals[i]!)} r={3} fill={s.color} /> : null))}</>);
      }}
    >
      {(vis) => {
        const { lo, hi, max } = scaleFor(vis);
        const yOf = (v: number) => H - (v / max) * H;
        return (
          <>
            {refVals && <polyline points={poly(refVals, lo, hi, yOf)} fill="none" stroke={MUTED} strokeWidth={1} strokeDasharray="3 2" opacity={0.6} strokeLinejoin="round" strokeLinecap="round" />}
            {series.map((s, k) => (
              <polyline key={k} points={poly(s.vals, lo, hi, yOf)} fill="none" stroke={s.color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
            ))}
          </>
        );
      }}
    </InteractiveChart>
  );
}

/** TSB bar chart — frais (green) / fatigue productive (amber) / surcharge (red), with the 0 line + zones. */
function TsbChart({ metrics, selected, onSelect, register, onReachStart, loadingOlder, selM }: SharedChart) {
  const n = metrics.length;
  const w = plotWidth(n);
  const tsb = metrics.map((m) => m.tsb ?? 0);
  const bw = (w / Math.max(1, n)) * 0.66;
  const scaleFor = (vis: Vis) => {
    const lo = Math.max(0, vis.lo - 1), hi = Math.min(n - 1, vis.hi + 1);
    let mx = 12, mn = -30;
    for (let i = lo; i <= hi; i++) { mx = Math.max(mx, tsb[i]); mn = Math.min(mn, tsb[i]); }
    return { lo, hi, max: mx, min: mn };
  };
  // Score colour: CTL-relative bands (frais > +10% CTL · productive > −30% · else surcharge).
  const v = selM?.tsb ?? null;
  const c = selM?.ctl ?? null;
  const scoreColor = v == null ? undefined
    : c && v >= 0.1 * c ? STATE.ready
    : c && v >= -0.3 * c ? STATE.caution
    : v >= 0 ? STATE.ready : STATE.caution;

  return (
    <InteractiveChart
      label="TSB · forme" help={TSB_HELP} score={fmtScore(v, scoreColor ?? STATE.rest)} unit="points · vert = frais · rouge = fatigue"
      metrics={metrics} selected={selected} onSelect={onSelect} register={register} onReachStart={onReachStart} loadingOlder={loadingOlder}
      axis={(vis) => { const s = scaleFor(vis); return { min: s.min, max: s.max }; }}
    >
      {(vis) => {
        const { lo, hi, max, min } = scaleFor(vis);
        const span = max - min || 1;
        const yOf = (val: number) => H - ((val - min) / span) * H;
        return (
          <>
            <rect x={0} y={yOf(-30)} width={w} height={H - yOf(-30)} fill={STATE.rest} opacity={0.07} />
            <rect x={0} y={yOf(10)} width={w} height={yOf(-10) - yOf(10)} fill={STATE.ready} opacity={0.08} />
            <line x1={0} y1={yOf(0)} x2={w} y2={yOf(0)} stroke={AXIS} strokeWidth={1} strokeDasharray="3 3" />
            {Array.from({ length: Math.max(0, hi - lo + 1) }, (_, k) => lo + k).map((i) => {
              const val = tsb[i];
              const x = ((i + 0.5) / n) * w - bw / 2;
              const y = yOf(Math.max(val, 0));
              const h = Math.abs(yOf(val) - yOf(0));
              return <rect key={i} x={x} y={y} width={bw} height={Math.max(0.5, h)} rx={1}
                fill={val >= 0 ? STATE.ready : val > -30 ? STATE.caution : STATE.rest} opacity={0.9} />;
            })}
          </>
        );
      }}
    </InteractiveChart>
  );
}

/** Per-channel freshness tile — selected-day value as the score + the full-series sparkline (0-line). */
function FreshTile({ label, help, color, value, series, ctl }: {
  label: string; help: HelpContent; color: string; value: number | null; series: (number | null)[]; ctl: number | null;
}) {
  const b = ctl ? 0.1 * ctl : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {label}<HelpButton content={help} />
      </div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums" style={{ color }}>{fmt(value, 1)}</div>
      <SparklineTile values={series} color={color} unit="pts" window="2 mois" decimals={1}
        refLine={0} zones={b > 0 ? [{ from: -b, to: b, fill: STATE.neutral }] : undefined} />
    </div>
  );
}
