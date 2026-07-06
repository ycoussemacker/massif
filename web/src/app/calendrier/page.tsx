import Link from "next/link";
import { Nav } from "@/components/nav";
import { CalendarGrid } from "@/components/calendar-grid";
import { getCalendar, type CalWindow } from "@/lib/calendar";
import { getSports } from "@/lib/activities";
import { todayLocal, daysBetween } from "@/lib/coach-context";
import { effectivePhase, phaseMarkFr } from "@/lib/briefing-algo";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
type SP = { v?: string; d?: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(s + "T00:00:00Z");
const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * 86_400_000));

/** Monday on/before `s` (week starts Monday). */
function mondayOf(s: string): string {
  const d = parse(s);
  const off = (d.getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
  return iso(new Date(d.getTime() - off * 86_400_000));
}
function addMonths(s: string, n: number): string {
  const d = parse(s);
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d);
}

/** Month-view grid range: full weeks (Mon–Sun) covering the anchor's month. */
function monthRange(anchor: string): { start: string; end: string } {
  const first = anchor.slice(0, 8) + "01";
  const d = parse(first);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  const start = mondayOf(first);
  const endMon = mondayOf(iso(lastDay));
  return { start, end: addDays(endMon, 6) };
}

const MONTH_FR = (s: string) =>
  new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(parse(s));
const WEEK_LABEL = (start: string) => {
  const end = addDays(start, 6);
  const f = (x: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(parse(x));
  return `${f(start)} – ${f(end)}`;
};

export default async function CalendrierPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view: "month" | "week" = sp.v === "week" ? "week" : "month";
  const today = todayLocal();
  const anchor = sp.d && DATE_RE.test(sp.d) ? sp.d : today;

  const range = view === "month" ? monthRange(anchor) : { start: mondayOf(anchor), end: addDays(mondayOf(anchor), 6) };
  const [{ days, windows, topGoal }, sports] = await Promise.all([getCalendar(range.start, range.end), getSports()]);

  // Marqueur de phase SOBRE en début de semaine (lundi) : phase effective évaluée À CE lundi-là
  // (objectif principal + fenêtres de contrainte) — « build · S−8 · charge 1/3 », « décharge »…
  const weekMarks: Record<string, string | null> = {};
  for (let m = range.start; m <= range.end; m = addDays(m, 7)) {
    weekMarks[m] = phaseMarkFr(effectivePhase({
      today: m,
      goals: topGoal ? [{ rank: 1, title: topGoal.title, days_to: daysBetween(m, topGoal.target_date) }] : [],
      training_windows: windows as CalWindow[],
    }));
  }

  const prevAnchor = view === "month" ? addMonths(anchor.slice(0, 8) + "01", -1) : addDays(mondayOf(anchor), -7);
  const nextAnchor = view === "month" ? addMonths(anchor.slice(0, 8) + "01", 1) : addDays(mondayOf(anchor), 7);
  // Label from the ANCHOR's month, not range.start (which is the Monday before the 1st — often the prior month).
  const anchorMonthNum = Number(anchor.slice(5, 7));
  const title = view === "month" ? MONTH_FR(anchor.slice(0, 8) + "15") : WEEK_LABEL(range.start);

  const navBtn = "rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm text-stone-600 transition-colors hover:border-alpine-300 hover:text-alpine-700 dark:border-stone-700 dark:text-stone-300";
  const toggleBtn = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      on ? "bg-alpine-100 text-alpine-700 dark:bg-alpine-900/50 dark:text-alpine-300" : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
    }`;

  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current="calendrier" />

        <h1 className="mb-4 text-lg font-bold tracking-tight text-stone-900 dark:text-stone-50 md:hidden">Calendrier</h1>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href={`/calendrier?v=${view}&d=${prevAnchor}`} className={navBtn} aria-label="Précédent">◀</Link>
            <span className="min-w-36 text-center text-sm font-semibold capitalize text-stone-800 dark:text-stone-100">{title}</span>
            <Link href={`/calendrier?v=${view}&d=${nextAnchor}`} className={navBtn} aria-label="Suivant">▶</Link>
            {(sp.d || sp.v) && (
              <Link href="/calendrier" className="ml-1 text-xs text-stone-400 hover:text-stone-600">aujourd&apos;hui</Link>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-stone-200 p-0.5 dark:border-stone-700">
            <Link href={`/calendrier?v=month&d=${anchor}`} className={toggleBtn(view === "month")}>Mois</Link>
            <Link href={`/calendrier?v=week&d=${anchor}`} className={toggleBtn(view === "week")}>Semaine</Link>
          </div>
        </div>

        <CalendarGrid
          view={view}
          rangeStart={range.start}
          rangeEnd={range.end}
          anchorMonth={view === "month" ? anchorMonthNum : null}
          today={today}
          days={days}
          sports={sports}
          windows={windows}
          weekMarks={weekMarks}
        />

        <p className="mt-6 text-center text-xs text-stone-400">
          Tape un jour pour noter une activité prévue — le coach planifie la semaine autour.{" "}
          <Link href="/analyse" className="text-stone-500 underline-offset-2 hover:underline">Analyse →</Link>
        </p>
      </div>
    </div>
  );
}
