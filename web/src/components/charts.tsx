/** Colored gauge ("slider") for the Massif dashboard key indicators. Dependency-free, server-rendered.
 *  The interactive time-series charts live in charts-section.tsx (a client island).
 *  Colours come only from theme.ts — never hard-code hex. */
import { MUTED } from "@/lib/theme";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
