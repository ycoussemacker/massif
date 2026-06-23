import Link from "next/link";
import { CoachAvatar } from "./coach-avatar";
import { BriefingMenu } from "./briefing-menu";
import { BriefingDetail } from "./briefing-detail";
import { READINESS, type Readiness } from "@/lib/labels";
import { todayLocal, dateMinusDays, ATHLETE_TZ } from "@/lib/coach-context";
import { loadCoachSettings, personaAvatar, personaName } from "@/lib/coach-settings";
import { createServiceClient } from "@/lib/supabase/server";
import type { Briefing } from "@/lib/data";

// Readiness as a soft pill (calmer than a full chip; matches the dashboard's restraint).
const READINESS_PILL: Record<Readiness, string> = {
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  red: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

/** When the briefing was actually generated (created_at), in the athlete's timezone:
 *  "aujourd'hui à 07:12" / "hier à 18:30" / "12 juin à 07:12". Falls back to the day alone
 *  (from briefing_date) if the timestamp is missing. */
function genWhen(briefing: Briefing, today: string): string {
  const dayLabel = (iso: string) =>
    iso === today ? "aujourd'hui"
    : iso === dateMinusDays(today, 1) ? "hier"
    : new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })
        .format(new Date(iso + "T00:00:00Z"));
  if (!briefing.created_at) return dayLabel(briefing.briefing_date);
  const d = new Date(briefing.created_at);
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATHLETE_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: ATHLETE_TZ, hour: "2-digit", minute: "2-digit",
  }).format(d);
  return `${dayLabel(dateStr)} à ${time}`;
}

/** The coach leads the dashboard: a readiness-ringed avatar "speaks" the briefing, anchored by an
 *  unmissable Discuter CTA → /coach. Server component (no client JS). Replaces the buried text link. */
export async function CoachHero({ briefing }: { briefing: Briefing | null }) {
  const today = todayLocal();
  const readiness = (briefing?.readiness ?? null) as Readiness | null;
  const settings = await loadCoachSettings(await createServiceClient());
  const avatarSrc = personaAvatar(settings.persona, settings.persona_gender);
  const coachName = personaName(settings.persona, settings.persona_gender);

  return (
    <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      {/* En-tête : avatar à gauche, bloc empilé à sa droite occupant pile la hauteur de l'avatar
          (nom en haut, date en bas, pastille au milieu via justify-between). */}
      <div className="flex items-stretch gap-3">
        <Link href="/coach" aria-label="Discuter avec le coach" className="shrink-0">
          <CoachAvatar size="hero" readiness={readiness} src={avatarSrc} />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          {/* Nom du coach */}
          <div className="truncate text-lg font-bold leading-tight tracking-tight text-stone-900 dark:text-stone-50 sm:text-xl">
            {coachName}
          </div>
          {/* Statut d'entraînement recommandé du jour */}
          {readiness && (
            <div>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${READINESS_PILL[readiness]}`}>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${READINESS[readiness].dot}`} />
                {READINESS[readiness].label}
              </span>
            </div>
          )}
          {/* Heure de génération + confiance — petit, gris */}
          {briefing && (
            <div className="truncate text-[11px] text-stone-400 sm:text-xs" title="Heure de génération du briefing">
              Généré {genWhen(briefing, today)}
              {briefing.confidence != null && ` · confiance ${Math.round(briefing.confidence * 100)} %`}
            </div>
          )}
        </div>
        {/* Menu discret — régénération du briefing à la demande */}
        <div className="-mr-1 self-start">
          <BriefingMenu />
        </div>
      </div>

      {/* Message du jour — pleine largeur sous l'en-tête */}
      <div className="mt-4">

          {briefing ? (
            <>
              {briefing.today_session && (
                <p className="text-lg font-semibold text-stone-900 dark:text-stone-50">
                  Aujourd&apos;hui → {briefing.today_session}
                </p>
              )}
              {/* `why` (1 phrase) rendu comme une bulle entrante (coin pointé vers l'avatar) */}
              {briefing.why && (
                <p className="mt-2 rounded-2xl rounded-tl-sm bg-stone-100 px-3.5 py-2.5 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                  {briefing.why}
                </p>
              )}
              {briefing.flag && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  ⚠️ {briefing.flag}
                </p>
              )}
              {/* Détail replié : l'état complet (reasoning) + le squelette de semaine */}
              <BriefingDetail reasoning={briefing.reasoning} weekSkeleton={briefing.week_skeleton} />
            </>
          ) : (
            <p className="mt-1 rounded-2xl rounded-tl-sm bg-stone-100 px-3.5 py-2.5 text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              Je n&apos;ai pas encore analysé ta journée — lance-moi quand tu veux
              {" ("}<code className="rounded bg-stone-200 px-1 dark:bg-stone-700">pnpm -C coach coach</code>{")."}
            </p>
          )}

          {/* CTA — l'entrée unique et évidente vers la discussion */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link href="/coach"
              className="bg-massif inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 active:opacity-95 sm:w-auto">
              💬 Discuter avec le coach
            </Link>
            <span className="hidden text-sm text-stone-500 sm:inline dark:text-stone-400">
              Pose-lui une question, commente ta séance
            </span>
          </div>
      </div>
    </section>
  );
}
