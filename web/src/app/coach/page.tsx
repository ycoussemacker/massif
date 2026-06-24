import Link from "next/link";
import { getConversation } from "@/lib/chat";
import { CoachChat } from "@/components/coach-chat";
import { CoachSettingsModal } from "@/components/coach-settings";
import { Nav } from "@/components/nav";
import { GoalBadge } from "@/components/goal-badge";
import { personaName } from "@/lib/coach-settings";

export const dynamic = "force-dynamic"; // refléter le dernier briefing / sync / échange

export default async function CoachPage() {
  const { timeline, topGoal, settings, cursor, hasMore } = await getConversation();
  // Nom du coach = celui du persona choisi (Gaston, Génie, Maud…), accordé au genre choisi.
  const coachName = personaName(settings.persona, settings.persona_gender);

  return (
    <div className="flex h-[100dvh] flex-col bg-page pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] font-sans text-stone-900 dark:text-stone-100">
      {/* Barre de nav pleine largeur — DESKTOP uniquement. En mobile, le chat a son propre en-tête
          (flèche retour + nom du coach) pour laisser un maximum de place à la conversation. */}
      <div className="mx-auto hidden w-full max-w-5xl px-4 pt-6 sm:px-6 sm:pt-8 md:block">
        <Nav current="coach" />
      </div>
      {/* Zone d'échange — volontairement plus étroite (max-w-3xl). */}
      <div className="mx-auto flex w-full min-h-0 max-w-3xl flex-1 flex-col overflow-hidden px-4 pt-3 pb-4 sm:px-6 md:pt-0">
        <header className="mb-2">
          <div className="flex min-w-0 items-center gap-2">
            {/* Mobile : flèche retour ultra-simple vers l'accueil (pas de barre de nav ici) */}
            <Link
              href="/"
              aria-label="Retour à l'accueil"
              className="-ml-1.5 shrink-0 rounded-lg p-1.5 text-stone-500 transition-transform hover:text-stone-800 active:scale-90 md:hidden dark:text-stone-400 dark:hover:text-stone-200"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden>
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link>
            {/* Clique l'avatar pour personnaliser ton coach (galerie de personas + Expert). */}
            <CoachSettingsModal initial={settings} />
            <h1 className="truncate text-2xl font-bold tracking-tight">{coachName}</h1>
          </div>
          {topGoal && (
            <div className="mt-1.5">
              <GoalBadge goal={topGoal} />
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1">
          <CoachChat timeline={timeline} initialCursor={cursor} initialHasMore={hasMore} />
        </div>
      </div>
    </div>
  );
}
