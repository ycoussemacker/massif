import Link from "next/link";
import { CoachAvatar } from "./coach-avatar";
import { BriefingMenu } from "./briefing-menu";
import { BriefingBody, BriefingRegenProvider } from "./briefing-regen";
import { StaleBriefingNotice } from "./stale-briefing-notice";
import { BriefingDetail } from "./briefing-detail";
import { BriefingCollapsible } from "./briefing-collapsible";
import { CoachCta } from "./coach-cta";
import { ActivitySnapshot } from "./activity-snapshot";
import { READINESS, sportIcon, type Readiness } from "@/lib/labels";
import { todayLocal, dateMinusDays, ATHLETE_TZ } from "@/lib/coach-context";
import { loadCoachSettings, personaAvatar, personaName } from "@/lib/coach-settings";
import { createServiceClient } from "@/lib/supabase/server";
import type { Activity, Briefing } from "@/lib/data";
import type { DayStatus } from "@/lib/day-progress";
import type { VerdictTone, VerdictVoice } from "@/lib/coach-voice";

// Readiness as a soft pill (calmer than a full chip; matches the dashboard's restraint).
const READINESS_PILL: Record<Readiness, string> = {
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  red: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

// Verdict pill / avatar-ring accent. `below` (under-load) is Alpine blue — the design-system "cool"
// pole, distinct from the readiness traffic-light (it's "not done yet", not a warning).
const VERDICT_PILL: Record<VerdictTone, { pill: string; dot: string }> = {
  ready: { pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400", dot: "bg-emerald-500" },
  below: { pill: "bg-alpine-50 text-alpine-700 dark:bg-alpine-950/40 dark:text-alpine-300", dot: "bg-alpine-500" },
  caution: { pill: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400", dot: "bg-amber-500" },
};

// The avatar ring "wears" the verdict where a readiness colour fits; `below` has no traffic-light
// equivalent, so it falls back to the briefing's own readiness.
const VERDICT_READINESS: Partial<Record<DayStatus, Readiness>> = {
  reached: "green", above: "amber", rest_broken: "amber",
};

/** A YYYY-MM-DD in the athlete's words, relative to today: "aujourd'hui" / "hier" / "12 juin". */
function dayLabel(iso: string, today: string): string {
  return iso === today ? "aujourd'hui"
    : iso === dateMinusDays(today, 1) ? "hier"
    : new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })
        .format(new Date(iso + "T00:00:00Z"));
}

/** When the briefing was actually generated (created_at), in the athlete's timezone:
 *  "aujourd'hui à 07:12" / "hier à 18:30" / "12 juin à 07:12". Falls back to the day alone
 *  (from briefing_date) if the timestamp is missing. */
function genWhen(briefing: Briefing, today: string): string {
  if (!briefing.created_at) return dayLabel(briefing.briefing_date, today);
  const d = new Date(briefing.created_at);
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATHLETE_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: ATHLETE_TZ, hour: "2-digit", minute: "2-digit",
  }).format(d);
  return `${dayLabel(dateStr, today)} à ${time}`;
}

/** The morning briefing's narrative, rendered FLAT (no nested toggle) for use inside the "Voir le plan
 *  du coach" collapsible when the day verdict takes the headline. The 7-day plan strip lives at the top
 *  of the dashboard ("Ton plan d'entraînement") now, so it's intentionally omitted here. */
function BriefingPlan({ briefing }: { briefing: Briefing }) {
  return (
    <>
      {briefing.today_session && (
        <p className="text-sm font-semibold text-stone-900 dark:text-stone-50">
          Séance prévue → {briefing.today_session}
        </p>
      )}
      {briefing.why && (
        <p className="rounded-2xl rounded-tl-sm bg-stone-100 px-3.5 py-2.5 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200">
          {briefing.why}
        </p>
      )}
      {briefing.reasoning && (
        <p className="text-sm leading-relaxed text-stone-600 dark:text-stone-300">{briefing.reasoning}</p>
      )}
    </>
  );
}

/** The coach leads the dashboard: a readiness-ringed avatar "speaks". When a same-day VERDICT exists
 *  (today's load vs the coach's target — computed LLM-free), the verdict becomes the headline and the
 *  morning briefing folds under "Voir le plan du coach"; the lone exception is `rest_kept`, where the
 *  briefing stays in front and the verdict appears as a soft "keep resting" note below (the day isn't
 *  over — the athlete may sync many times before training). Server component (no client JS of its own). */
export async function CoachHero({
  briefing, verdict, todayActivities,
}: {
  briefing: Briefing | null;
  verdict: VerdictVoice | null;
  todayActivities: Activity[]; // today's logged sessions — shown as a conversation "snapshot" + debrief target
}) {
  const today = todayLocal();
  const debriefDate = todayActivities.length > 0 ? today : null;
  const readiness = (briefing?.readiness ?? null) as Readiness | null;
  const settings = await loadCoachSettings(await createServiceClient());
  const avatarSrc = personaAvatar(settings.persona, settings.persona_gender);
  const coachName = personaName(settings.persona, settings.persona_gender);

  // Le briefing affiché n'est pas celui d'aujourd'hui → on signale qu'il est périmé.
  const stale = !!briefing && briefing.briefing_date !== today;

  // Le verdict prend la tête une fois une activité réalisée (showAsHeadline) ; "repos respecté" reste
  // une note douce sous le briefing. Avant toute activité (matin), le briefing/plan mène.
  const headline = verdict?.showAsHeadline ? verdict : null;
  const restNote = verdict?.isRestNote ? verdict : null;
  const ringReadiness: Readiness | null = headline ? (VERDICT_READINESS[headline.status] ?? readiness) : readiness;

  return (
    <BriefingRegenProvider>
      <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
        {/* En-tête : avatar à gauche, bloc empilé à sa droite occupant pile la hauteur de l'avatar. */}
        <div className="flex items-stretch gap-3">
          <Link href="/coach" aria-label="Discuter avec le coach" className="shrink-0">
            <CoachAvatar size="hero" readiness={ringReadiness} src={avatarSrc} />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            {/* Nom du coach */}
            <div className="truncate text-lg font-bold leading-tight tracking-tight text-stone-900 dark:text-stone-50 sm:text-xl">
              {coachName}
            </div>
            {/* Statut du jour : verdict de charge si dispo, sinon readiness du briefing */}
            {headline ? (
              <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${VERDICT_PILL[headline.tone].pill}`}>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${VERDICT_PILL[headline.tone].dot}`} />
                {headline.pillLabel}
              </span>
            ) : readiness ? (
              <BriefingBody>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${READINESS_PILL[readiness]}`}>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${READINESS[readiness].dot}`} />
                  {READINESS[readiness].label}
                </span>
              </BriefingBody>
            ) : null}
            {/* Heure de génération + confiance — petit, gris */}
            {briefing && (
              <div className="flex min-w-0 items-center gap-1 text-[11px] text-stone-400 sm:text-xs">
                {stale && (
                  <svg
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round"
                    className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                    role="img" aria-label="Briefing périmé"
                  >
                    <title>Ce briefing n&apos;est pas celui d&apos;aujourd&apos;hui — régénère-le pour la date du jour.</title>
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                    <path d="M12 9v4" /><path d="M12 17h.01" />
                  </svg>
                )}
                <span className="truncate" title="Heure de génération du briefing">
                  Généré {genWhen(briefing, today)}
                  {briefing.confidence != null && ` · confiance ${Math.round(briefing.confidence * 100)} %`}
                </span>
              </div>
            )}
          </div>
          {/* Menu discret — régénération du briefing à la demande */}
          <div className="-mr-1 self-start">
            <BriefingMenu />
          </div>
        </div>

        {/* Briefing périmé (la régénération/cron du jour n'a pas tourné) → on met en avant le bouton
            "Régénérer" plutôt que de laisser le ⋮ discret porter une action devenue nécessaire. */}
        {stale && briefing && <StaleBriefingNotice dayLabel={dayLabel(briefing.briefing_date, today)} />}

        {/* Message du jour — pleine largeur sous l'en-tête */}
        <div className="mt-4">
          {/* Snapshot de la conversation : l'activité du jour, telle qu'elle apparaît dans le chat
              (sans le bouton "Commente"), juste au-dessus du message du coach. */}
          {todayActivities.length > 0 && (
            <ActivitySnapshot dateLabel="Aujourd'hui" activities={todayActivities} className="mb-3" />
          )}
          {headline ? (
            // ── Le verdict du jour parle ; le briefing du matin se replie en dessous. ──
            <>
              <p className="rounded-2xl rounded-tl-sm bg-stone-100 px-3.5 py-2.5 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                {headline.cardText}
              </p>
              {headline.suggestionText && (
                <p className="mt-2 flex items-start gap-2 rounded-xl border border-alpine-100 bg-alpine-50 px-3 py-2 text-sm text-alpine-700 dark:border-alpine-900 dark:bg-alpine-950/40 dark:text-alpine-300">
                  <span aria-hidden className="text-base leading-snug">{sportIcon(headline.suggestionSportCode)}</span>
                  <span>{headline.suggestionText}</span>
                </p>
              )}
              {briefing && (
                <BriefingCollapsible>
                  <BriefingBody>
                    <div className="space-y-2">
                      {/* Le ⚠️ vit ici, dans le plan replié (et non en tête) — choix produit. */}
                      {briefing.flag && (
                        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                          ⚠️ {briefing.flag}
                        </p>
                      )}
                      <BriefingPlan briefing={briefing} />
                    </div>
                  </BriefingBody>
                </BriefingCollapsible>
              )}
            </>
          ) : (
            // ── Pas de verdict en tête : le briefing du matin (ou l'invite vide) mène. ──
            <BriefingBody>
              {briefing ? (
                <>
                  {briefing.today_session && (
                    <p className="text-lg font-semibold text-stone-900 dark:text-stone-50">
                      {/* Quand le briefing est périmé, sa "séance du jour" est en fait celle de sa
                          journée de génération — ne pas la présenter comme celle d'aujourd'hui. */}
                      {stale ? "Séance prévue" : "Aujourd'hui"} → {briefing.today_session}
                    </p>
                  )}
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
                  <BriefingDetail reasoning={briefing.reasoning} />
                </>
              ) : (
                <p className="mt-1 rounded-2xl rounded-tl-sm bg-stone-100 px-3.5 py-2.5 text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                  Je n&apos;ai pas encore analysé ta journée — lance-moi quand tu veux
                  {" ("}<code className="rounded bg-stone-200 px-1 dark:bg-stone-700">pnpm -C coach coach</code>{")."}
                </p>
              )}
            </BriefingBody>
          )}

          {/* "Repos respecté" : note douce fusionnée sous le briefing (le jour n'est pas fini). */}
          {restNote && (
            <p className="mt-2 rounded-2xl rounded-tl-sm bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              {restNote.cardText}
            </p>
          )}

          {/* CTA unique : "Débrief avec {coach}" (commente la séance du jour → /coach) ou, sans activité,
              simple entrée vers la conversation. Seul usage autorisé du dégradé bg-massif. */}
          <CoachCta coachName={coachName} debriefDate={debriefDate} sessionCount={todayActivities.length} />
        </div>
      </section>
    </BriefingRegenProvider>
  );
}
