/** Colored gauge ("slider") for the Massif dashboard key indicators. Dependency-free, server-rendered.
 *  The interactive time-series charts live in charts-section.tsx (a client island).
 *  Colours come only from theme.ts — never hard-code hex. */
import { MUTED } from "@/lib/theme";
import { HelpButton, type HelpContent } from "./help";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type Zone = { from: number; to: number; color: string; label: string };

export function Gauge({ label, value, unit, min, max, zones, help }: {
  label: string; value: number | null; unit?: string; min: number; max: number; zones: Zone[]; help?: HelpContent;
}) {
  const pct = (v: number) => clamp(((v - min) / (max - min || 1)) * 100, 0, 100);
  const zone = value == null ? null : zones.find((z) => value >= z.from && value < z.to) ?? zones.at(-1)!;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-stone-600 dark:text-stone-300">
          {label}
          {help && <HelpButton content={help} />}
        </span>
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

// ── compact 3/4-circle variant (mobile): same data as Gauge, value + state centred to save vertical space ──
const TAU = Math.PI / 180;
const polar = (cx: number, cy: number, r: number, deg: number): [number, number] =>
  [cx + r * Math.cos(deg * TAU), cy + r * Math.sin(deg * TAU)];
/** SVG arc path from angle a0 to a1 (degrees, y-down, clockwise/positive sweep). */
const arcPath = (cx: number, cy: number, r: number, a0: number, a1: number): string => {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

/** A 3/4-circle gauge (270°, gap at the bottom): colored zone arcs, a marker at the value, and the
 *  value + active-zone label in the centre. Same props as Gauge — used 3-up on mobile to save height. */
export function ArcGauge({ label, value, unit, min, max, zones, help }: {
  label: string; value: number | null; unit?: string; min: number; max: number; zones: Zone[]; help?: HelpContent;
}) {
  const START = 135, SPAN = 270, cx = 50, cy = 50, r = 38, sw = 9;
  const t = (v: number) => clamp((v - min) / (max - min || 1), 0, 1);
  const deg = (v: number) => START + t(v) * SPAN;
  const zone = value == null ? null : zones.find((z) => value >= z.from && value < z.to) ?? zones.at(-1)!;
  const marker = value == null ? null : polar(cx, cy, r, deg(value));
  return (
    <div className="flex flex-col items-center">
      <div className="mb-1 flex items-center gap-1 text-center text-[10px] font-medium leading-tight text-stone-600 dark:text-stone-300">
        {label}{help && <HelpButton content={help} />}
      </div>
      <div className="relative w-full" style={{ maxWidth: 108 }}>
        <svg viewBox="0 0 100 100" className="block w-full text-stone-700 dark:text-stone-200">
          <path d={arcPath(cx, cy, r, START, START + SPAN)} fill="none" stroke="currentColor"
            className="text-stone-100 dark:text-stone-800" strokeWidth={sw} strokeLinecap="round" />
          {zones.map((z, i) => (
            <path key={i} d={arcPath(cx, cy, r, deg(Math.max(z.from, min)), deg(Math.min(z.to, max)))}
              fill="none" stroke={z.color} strokeWidth={sw} opacity={z === zone ? 0.9 : 0.22} />
          ))}
          {marker && <circle cx={marker[0]} cy={marker[1]} r={4} fill="currentColor" />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold leading-none tabular-nums" style={{ color: zone?.color ?? MUTED }}>
            {value == null ? "—" : value.toFixed(unit === "" ? 0 : 1)}
          </span>
          {zone && <span className="mt-0.5 max-w-full truncate px-1 text-[9px] font-medium leading-tight" style={{ color: zone.color }}>{zone.label}</span>}
        </div>
      </div>
    </div>
  );
}
