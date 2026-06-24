import { Nav } from "@/components/nav";
import {
  SkeletonCard,
  SkeletonChips,
  SkeletonLine,
  SkeletonActivityRows,
} from "@/components/skeletons";

// État de chargement instantané de /activites (fallback du <Suspense> implicite de Next).
// Réplique EXACTEMENT le cadre externe de page.tsx (zéro layout shift) + le vrai <Nav current="activites" />.
// Squelette neutre (stone), composants serveur purs — pas de "use client", pas de DB.
export default function Loading() {
  return (
    <div className="min-h-full overflow-x-clip bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8 lg:max-w-6xl">
        <Nav current="activites" />

        {/* En-tête (titre + sous-titre) */}
        <header className="mb-6">
          <SkeletonLine className="h-6 w-72 max-w-full" />
          <SkeletonLine className="mt-2 h-4 w-96 max-w-full" />
        </header>

        <div className="lg:flex lg:items-start lg:gap-6">
          {/* Barre de filtres — chips sport + recherche + plages date/charge */}
          <SkeletonCard className="lg:w-72 lg:shrink-0">
            <SkeletonChips n={6} />
            <SkeletonLine className="mt-4 h-9 w-full rounded-lg" />
            <SkeletonLine className="mt-3 h-9 w-full rounded-lg" />
            <SkeletonLine className="mt-3 h-9 w-full rounded-lg" />
          </SkeletonCard>

          <main className="mt-4 min-w-0 flex-1 space-y-5 lg:mt-0">
            {/* Bandeau de synthèse */}
            <SkeletonCard padding="p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <SkeletonLine className="h-8 w-28" />
                <SkeletonLine className="h-5 w-40" />
              </div>
              <SkeletonLine className="mt-3 h-2 w-full rounded-full" />
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <SkeletonLine className="h-10 w-20" />
                <SkeletonLine className="h-10 w-20" />
                <SkeletonLine className="h-10 w-20" />
                <SkeletonLine className="h-10 w-20" />
              </div>
            </SkeletonCard>

            {/* Liste / tableau des activités */}
            <SkeletonCard padding="p-4 sm:p-5">
              <SkeletonActivityRows n={8} />
            </SkeletonCard>
          </main>
        </div>
      </div>
    </div>
  );
}
