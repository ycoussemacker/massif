/** GitHub-style calendar heatmap of a daily quantity (here: training load). Columns = weeks (Mon-start),
 *  rows = Mon→Sun. Intensity is a NEUTRAL single-hue ramp (currentColor opacity) — it encodes VOLUME,
 *  not physiology, and flips correctly in dark mode. Server-compatible (no hooks). */
export function Heatmap({ days }: { days: { date: string; load: number }[] }) {
  if (days.length === 0) return <p className="text-sm text-stone-500 dark:text-stone-400">Pas encore de données.</p>;
  const max = Math.max(1, ...days.map((d) => d.load));
  const lead = (new Date(days[0].date + "T00:00:00Z").getUTCDay() + 6) % 7; // Mon = 0
  const op = (load: number) => (load <= 0 ? 0.07 : Math.min(1, 0.28 + 0.72 * (load / max)));
  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="grid grid-flow-col grid-rows-7 gap-[3px] text-stone-600 dark:text-stone-300" style={{ width: "max-content" }}>
          {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} className="h-3 w-3" aria-hidden />)}
          {days.map((d) => (
            <div
              key={d.date}
              className="h-3 w-3 rounded-[2px]"
              title={`${d.date} · ${Math.round(d.load)} pts`}
              style={{ background: "currentColor", opacity: op(d.load) }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-stone-400">
        <span>moins</span>
        <span className="flex items-center gap-[3px] text-stone-600 dark:text-stone-300">
          {[0.07, 0.3, 0.5, 0.72, 1].map((o, i) => (
            <span key={i} className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: "currentColor", opacity: o }} />
          ))}
        </span>
        <span>plus</span>
        <span className="ml-auto tabular-nums">{days[0].date} → {days.at(-1)!.date}</span>
      </div>
    </div>
  );
}
