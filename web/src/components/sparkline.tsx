import { fmt } from "@/lib/format";

/** Tiny inline trend line. Server-compatible (no hooks). Colour defaults to currentColor so callers
 *  set it via a text-* class (neutral); pass `color` (a theme CSS-var) for a channel-tinted line. */
export function Sparkline({
  values, color, width = 100, height = 26, strokeWidth = 1.5, className = "text-stone-400",
}: {
  values: (number | null)[];
  color?: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const n = values.length;
  const pad = strokeWidth;
  const pts = values
    .map((v, i) => (v == null ? null : [(i / Math.max(1, n - 1)) * width, height - pad - ((v - min) / span) * (height - 2 * pad)]))
    .filter((p): p is number[] => p !== null)
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`block ${className}`} aria-hidden preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color ?? "currentColor"} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Sparkline on a small indicator tile: the trend line, a discreet « unit · window » caption, and the
 *  min–max range of the plotted series at the line's edges — so the tile is self-explanatory. Numbers
 *  are tabular; everything is stone-neutral (the channel tint lives in the line via `color`). */
export function SparklineTile({
  values, color, unit, window, decimals = 0, className,
}: {
  values: (number | null)[];
  color?: string;       // channel-tinted line; omit for a neutral stone line
  unit: string;         // e.g. "pts" — the metric unit
  window: string;       // e.g. "2 mois" — the plotted time window
  decimals?: number;    // decimals for the min/max range
  className?: string;   // forwarded to the <Sparkline> (neutral text colour fallback)
}) {
  const nums = values.filter((v): v is number => v != null);
  const min = nums.length ? Math.min(...nums) : null;
  const max = nums.length ? Math.max(...nums) : null;
  return (
    <div className="mt-1">
      <Sparkline values={values} color={color} className={`w-full${className ? ` ${className}` : ""}`} />
      <div className="mt-0.5 flex items-baseline justify-between text-[10px] text-stone-400">
        <span className="tabular-nums">{fmt(min, decimals)}</span>
        <span>{unit} · {window}</span>
        <span className="tabular-nums">{fmt(max, decimals)}</span>
      </div>
    </div>
  );
}
