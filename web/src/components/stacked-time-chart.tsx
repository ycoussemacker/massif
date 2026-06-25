/** Static (non-interactive) stacked daily-bar time-series. Minimal style (faint gridlines, thin) to
 *  match the dashboard. Server-compatible. Used on /analyse for per-channel and per-sport load over a
 *  period. Each segment's colour is passed in — channels use the physiology hues; sports the SERIES
 *  palette. */
import { mondayTickIndices, axisDateLabel } from "@/lib/chart-axis";

export type StackSeg = { key: string; color: string; label: string; glyph?: string };

const H = 140;

export function StackedTimeChart({ label, dates, segments, data, unit }: {
  label: string;
  dates: string[];
  segments: StackSeg[];
  data: Map<string, Map<string, number>>; // date -> segKey -> value
  unit?: string;
}) {
  const n = Math.max(1, dates.length);
  const w = Math.max(480, n * 14);
  const bw = (w / n) * 0.74;
  const dayTotal = (d: string) => segments.reduce((s, seg) => s + (data.get(d)?.get(seg.key) ?? 0), 0);
  const max = Math.max(1, ...dates.map(dayTotal)) * 1.05;
  const mid = max / 2;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 className="text-sm font-medium text-stone-700 dark:text-stone-300">{label}</h3>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {segments.map((seg) => (
            <span key={seg.key} className="flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: seg.color }} />
              {seg.glyph && <span aria-hidden>{seg.glyph}</span>}{seg.label}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <div className="flex w-9 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-stone-400" style={{ height: H }}>
          <span>{Math.round(max)}</span><span>{Math.round(mid)}</span><span>0</span>
        </div>
        <div className="min-w-0 overflow-x-auto">
          <div style={{ width: w }}>
            <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block">
              {[0, H / 2, H].map((y) => (
                <line key={y} x1={0} y1={y} x2={w} y2={y} stroke="currentColor" className="text-stone-100 dark:text-stone-800" strokeWidth={1} />
              ))}
              {dates.map((d, i) => {
                const x = ((i + 0.5) / n) * w - bw / 2;
                const day = data.get(d);
                let yTop = H;
                return (
                  <g key={d}>
                    {segments.map((seg) => {
                      const v = day?.get(seg.key) ?? 0;
                      if (v <= 0) return null;
                      const h = (v / max) * H;
                      yTop -= h;
                      return <rect key={seg.key} x={x} y={yTop} width={bw} height={h} fill={seg.color} opacity={0.92} />;
                    })}
                  </g>
                );
              })}
            </svg>
            <div className="relative h-3.5 text-[10px] tabular-nums text-stone-400" style={{ width: w }}>
              {mondayTickIndices(dates).map((i) => (
                <span key={i} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: ((i + 0.5) / n) * w }}>
                  {axisDateLabel(dates[i])}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      {unit && <div className="mt-1 pl-9 text-center text-[10px] text-stone-400">{unit}</div>}
    </div>
  );
}

/** Horizontal stacked bar — a single period's composition as one proportional bar. */
export function StackBar({ segments, data }: { segments: StackSeg[]; data: Map<string, number> }) {
  const total = segments.reduce((s, seg) => s + (data.get(seg.key) ?? 0), 0) || 1;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
      {segments.map((seg) => {
        const v = data.get(seg.key) ?? 0;
        if (v <= 0) return null;
        return <div key={seg.key} className="h-full" style={{ width: `${(v / total) * 100}%`, background: seg.color, opacity: 0.92 }} title={`${seg.label} · ${Math.round(v)} pts`} />;
      })}
    </div>
  );
}
