import { fmt } from "@/lib/format";
import { AXIS, MUTED } from "@/lib/theme";

/** A shaded horizontal band on a sparkline (drawn behind the line). `from`/`to` are in the data's
 *  y-units; `null` means open-ended to that edge of the chart. */
export type SparklineZone = { from: number | null; to: number | null; fill: string };

/** y-domain [lo, hi] for a sparkline: the data PLUS every reference (zone bounds, refLine, refCurve),
 *  padded 5% each side so references/strokes stay off the edges. Shared by <Sparkline> and the tile's
 *  y-axis labels so they use the exact same scale. */
function sparklineDomain(
  nums: number[], refLine?: number, refCurve?: (number | null)[], zones?: SparklineZone[],
): { lo: number; hi: number } {
  const vals = [...nums];
  if (refLine != null) vals.push(refLine);
  if (refCurve) for (const v of refCurve) if (v != null) vals.push(v);
  if (zones) for (const z of zones) {
    if (z.from != null) vals.push(z.from);
    if (z.to != null) vals.push(z.to);
  }
  const dMin = Math.min(...vals);
  const dMax = Math.max(...vals);
  const dSpan = dMax - dMin || 1;
  return { lo: dMin - dSpan * 0.05, hi: dMax + dSpan * 0.05 };
}

/** Tiny inline trend line. Server-compatible (no hooks). Colour defaults to currentColor so callers
 *  set it via a text-* class (neutral); pass `color` (a theme CSS-var) for a channel-tinted line.
 *
 *  Optional interpretation references, all in the data's y-units and drawn BEHIND the main line:
 *  - `zones`    — faint shaded horizontal bands (e.g. a risk band).
 *  - `refLine`  — a thin dashed horizontal reference line at a value (e.g. 0 = equilibrium).
 *  - `refCurve` — a faint secondary series (same x-domain as `values`), thin/dashed/muted.
 *  The y-domain extends to include the data AND every reference, so a band/line stays visible even
 *  when the data doesn't reach it. The base signature (values/color/size/className) is unchanged. */
export function Sparkline({
  values, color, width = 100, height = 26, strokeWidth = 1.5, className = "text-stone-400",
  zones, refLine, refCurve,
}: {
  values: (number | null)[];
  color?: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
  zones?: SparklineZone[];
  refLine?: number;
  refCurve?: (number | null)[];
}) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return null;

  const { lo, hi } = sparklineDomain(nums, refLine, refCurve, zones);
  const span = hi - lo || 1;
  const n = values.length;
  const pad = strokeWidth;
  const innerH = height - 2 * pad;
  const yOf = (v: number) => height - pad - ((v - lo) / span) * innerH;
  const xOf = (i: number) => (i / Math.max(1, n - 1)) * width;

  const polyline = (series: (number | null)[]) =>
    series
      .map((v, i) => (v == null ? null : [xOf(i), yOf(v)]))
      .filter((p): p is number[] => p !== null)
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");

  const pts = polyline(values);
  const refPts = refCurve ? polyline(refCurve) : null;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`block ${className}`} aria-hidden preserveAspectRatio="none">
      {/* Interpretation references behind the line */}
      {zones?.map((z, i) => {
        const top = z.to == null ? 0 : yOf(z.to);
        const bottom = z.from == null ? height : yOf(z.from);
        const y = Math.min(top, bottom);
        const h = Math.abs(bottom - top);
        if (h <= 0) return null;
        return <rect key={i} x={0} y={y} width={width} height={h} fill={z.fill} opacity={0.14} />;
      })}
      {refLine != null && (
        <line x1={0} y1={yOf(refLine)} x2={width} y2={yOf(refLine)} stroke={AXIS} strokeWidth={1} strokeDasharray="3 3" />
      )}
      {refPts && (
        <polyline points={refPts} fill="none" stroke={MUTED} strokeWidth={1} strokeDasharray="3 2" strokeLinejoin="round" strokeLinecap="round" opacity={0.7} />
      )}
      <polyline points={pts} fill="none" stroke={color ?? "currentColor"} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Sparkline on a small indicator tile. The series min/max sit on the LEFT y-AXIS (max high, min low,
 *  at their true heights — so e.g. a Monotonie max of 1.5 reads as sitting below the risk band, not at
 *  the top), and a discreet « unit · window » caption (the x/time context) sits centred below. Numbers
 *  are tabular and stone-neutral; the channel tint lives in the line via `color`. Interpretation
 *  references (`zones`/`refLine`/`refCurve`) pass straight through to <Sparkline>. */
export function SparklineTile({
  values, color, unit, window, decimals = 0, className, zones, refLine, refCurve,
}: {
  values: (number | null)[];
  color?: string;       // channel-tinted line; omit for a neutral stone line
  unit: string;         // e.g. "pts" — the metric unit
  window: string;       // e.g. "2 mois" — the plotted time window
  decimals?: number;    // decimals for the min/max range
  className?: string;   // forwarded to the <Sparkline> (neutral text colour fallback)
  zones?: SparklineZone[];     // faint interpretation bands (in y-units)
  refLine?: number;            // dashed reference line (e.g. 0)
  refCurve?: (number | null)[]; // faint secondary series behind the main line
}) {
  const H = 34;
  const PAD = 1.5;
  const nums = values.filter((v): v is number => v != null);
  const min = nums.length ? Math.min(...nums) : null;
  const max = nums.length ? Math.max(...nums) : null;

  // Place each axis label at the TRUE y of its value (same domain as the line), clamped so the 10px
  // text never clips at the chart edges.
  const { lo, hi } = nums.length ? sparklineDomain(nums, refLine, refCurve, zones) : { lo: 0, hi: 1 };
  const span = hi - lo || 1;
  const yPx = (v: number) => Math.max(6, Math.min(H - 6, H - PAD - ((v - lo) / span) * (H - 2 * PAD)));

  return (
    <div className="mt-1">
      <div className="flex items-stretch gap-1.5">
        <div className="relative w-7 shrink-0 text-[10px] tabular-nums text-stone-400" style={{ height: H }} aria-hidden>
          {max != null && (
            <span className="absolute right-0 -translate-y-1/2" style={{ top: yPx(max) }}>{fmt(max, decimals)}</span>
          )}
          {min != null && (
            <span className="absolute right-0 -translate-y-1/2" style={{ top: yPx(min) }}>{fmt(min, decimals)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Sparkline
            values={values} color={color} height={H} className={`w-full${className ? ` ${className}` : ""}`}
            zones={zones} refLine={refLine} refCurve={refCurve}
          />
        </div>
      </div>
      <div className="mt-0.5 text-center text-[10px] text-stone-400">{unit} · {window}</div>
    </div>
  );
}
