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
