"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DescentPoint } from "@/lib/descent-training";
import { VIZ, MUTED } from "@/lib/theme";
import { mondayTickIndices, axisDateLabel } from "@/lib/chart-axis";

const PX_PER_DAY = 16; // ~2 months fill a typical card width → opens on the last ~56 days
const H = 150, padT = 12, padB = 22;
const yTop = padT, yBot = H - padB;
const BUF = 6; // render a few points past the viewport so the curves don't pop in at the edges

/** Descent CTL/ATL: the FAST 28-day D− exposure (Summit area+line) vs the SLOW adaptation baseline (MUTED
 *  dashed — the evolving reference that replaced the old fixed median). Above the baseline = building
 *  descent capacity; below = detraining. Opens on the last ~2 months, scrolls LEFT through history, and the
 *  Y-scale ADAPTS to the visible window's max (both curves share the unit, so both stay in frame). */
export function DescentChart({ points }: { points: DescentPoint[] }) {
  const n = points.length;
  const W = Math.max(1, n * PX_PER_DAY);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState({ lo: Math.max(0, n - 56), hi: n - 1 });

  const mondays = useMemo(() => mondayTickIndices(points.map((p) => p.date)), [points]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const recompute = () => {
      const lo = Math.max(0, Math.floor(el.scrollLeft / PX_PER_DAY));
      const hi = Math.min(n - 1, Math.ceil((el.scrollLeft + el.clientWidth) / PX_PER_DAY));
      setVis((prev) => (prev.lo === lo && prev.hi === hi ? prev : { lo, hi }));
    };
    el.scrollLeft = el.scrollWidth; // newest first → opens on the most recent weeks
    recompute();
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(recompute); };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [n]);

  // Y-scale from the VISIBLE window's max of BOTH curves (same unit), rounded to a clean step.
  let vmax = 0;
  for (let i = vis.lo; i <= vis.hi; i++) { const p = points[i]; if (p) vmax = Math.max(vmax, p.fast, p.slow); }
  const maxM = Math.max(200, Math.ceil((vmax || 1) / 200) * 200);
  const X = (i: number) => (i + 0.5) * PX_PER_DAY;
  const Y = (m: number) => yBot - (m / maxM) * (yBot - yTop);

  // Windowed paths (visible slice ± buffer). The spine is contiguous, so no gaps to handle.
  const lo = Math.max(0, vis.lo - BUF), hi = Math.min(n - 1, vis.hi + BUF);
  let fastLine = "", slowLine = "", area = "";
  for (let i = lo; i <= hi; i++) {
    const p = points[i];
    const cmd = i === lo ? "M" : "L";
    fastLine += `${cmd}${X(i).toFixed(1)},${Y(p.fast).toFixed(1)} `;
    slowLine += `${cmd}${X(i).toFixed(1)},${Y(p.slow).toFixed(1)} `;
    area += `${i === lo ? `M${X(lo).toFixed(1)},${yBot} L` : "L"}${X(i).toFixed(1)},${Y(p.fast).toFixed(1)} `;
  }
  if (hi >= lo) area += `L${X(hi).toFixed(1)},${yBot} Z`;
  const ticks = mondays.filter((i) => i >= lo && i <= hi);

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-1.5">
      {/* fixed y-axis (adapts to the visible window): max (top) · mid · 0 */}
      <div className="relative w-10 shrink-0 text-right text-[10px] tabular-nums text-stone-400" style={{ height: H }} aria-hidden>
        <span className="absolute right-0 -translate-y-1/2" style={{ top: yTop }}>{maxM}</span>
        <span className="absolute right-0 -translate-y-1/2" style={{ top: (yTop + yBot) / 2 }}>{Math.round(maxM / 2)}</span>
        <span className="absolute right-0 -translate-y-1/2" style={{ top: yBot }}>0</span>
      </div>
      <div ref={scrollRef} className="overflow-x-auto">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label="Exposition à la descente sur 28 jours vs ligne d'adaptation, historique complet">
          {/* weekly (Monday) date ticks */}
          {ticks.map((i) => (
            <g key={i}>
              <line x1={X(i)} x2={X(i)} y1={yBot} y2={yBot + 3} stroke={MUTED} strokeWidth={1} opacity={0.5} />
              <text x={X(i)} y={H - 6} textAnchor="middle" fontSize={9} fill={MUTED}>{axisDateLabel(points[i].date)}</text>
            </g>
          ))}
          {/* fast = 28-day exposure (Summit area + line) */}
          <path d={area} fill={VIZ.neuro} opacity={0.13} />
          <path d={fastLine} fill="none" stroke={VIZ.neuro} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          {/* slow = adaptation baseline (neutral dashed reference — replaces the old fixed median) */}
          <path d={slowLine} fill="none" stroke={MUTED} strokeWidth={1.25} strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />
          {/* current exposure point */}
          {vis.hi === n - 1 && <circle cx={X(n - 1)} cy={Y(points[n - 1].fast)} r={2.6} fill={VIZ.neuro} />}
        </svg>
      </div>
    </div>
  );
}
