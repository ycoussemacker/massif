// Squelette du corps du dashboard (composant serveur pur, neutre = stone). Reflète l'ordre et la
// forme des sections réelles (web/src/app/page.tsx → DashboardBody) pour ZÉRO layout shift quand le
// vrai corps streame via <Suspense>. Composé uniquement depuis @/components/skeletons.
import {
  SkeletonBox,
  SkeletonCard,
  SkeletonLine,
  SkeletonChips,
  SkeletonChartCard,
  SkeletonTile,
  SkeletonActivityRows,
} from "@/components/skeletons";

export function DashboardBodySkeleton() {
  return (
    <>
      {/* 1. Carte « Ton plan d'entraînement » : titre + objectif + 7 pastilles + bouton à droite.
          La vraie carte est p-4 sm:p-5 (page.tsx) → on matche pour un layout-shift nul sur mobile. */}
      <SkeletonCard className="mb-6" padding="p-4 sm:p-5">
        <SkeletonBox className="h-3 w-40" />
        <SkeletonBox className="mt-3 h-5 w-2/3" />
        <div className="mt-3">
          <SkeletonChips n={7} />
        </div>
        <div className="mt-4 flex justify-end border-t border-stone-100 pt-4 dark:border-stone-800">
          <SkeletonBox className="h-9 w-40 rounded-lg" />
        </div>
      </SkeletonCard>

      {/* 2. Carte coach hero : bulle readiness + lignes de texte + CTA */}
      <SkeletonCard className="mb-6">
        <div className="flex items-start gap-4">
          <SkeletonBox className="h-16 w-16 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="w-1/3" />
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-4/5" />
          </div>
        </div>
        <div className="mt-4">
          <SkeletonBox className="h-10 w-40 rounded-lg" />
        </div>
      </SkeletonCard>

      {/* 3. Zone graphes : carte Forme (CTL/ATL + TSB) puis carte canal */}
      <div className="mb-6">
        <SkeletonChartCard />
      </div>
      <div className="mb-6">
        <SkeletonChartCard />
      </div>

      {/* 4. Carte récupération : en-tête + grille de 6 tuiles */}
      <SkeletonCard className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <SkeletonBox className="h-4 w-56" />
          <SkeletonBox className="h-8 w-8 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonTile key={i} />
          ))}
        </div>
      </SkeletonCard>

      {/* 5. Saisie courbatures : petite carte */}
      <SkeletonCard className="mb-6">
        <SkeletonBox className="h-4 w-48" />
        <SkeletonBox className="mt-3 h-9 w-full rounded-lg" />
      </SkeletonCard>

      {/* 6. Carte activités récentes : en-tête + 3 lignes */}
      <SkeletonCard>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SkeletonBox className="h-4 w-40" />
          <SkeletonBox className="h-4 w-20" />
        </div>
        <SkeletonActivityRows n={3} />
      </SkeletonCard>
    </>
  );
}
