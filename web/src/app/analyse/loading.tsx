import { Nav } from "@/components/nav";
import {
  SkeletonBox,
  SkeletonCard,
  SkeletonChips,
  SkeletonChartCard,
  SkeletonLine,
} from "@/components/skeletons";

// État de chargement instantané de /analyse (fallback du <Suspense> implicite de Next).
// Réplique le cadre externe de page.tsx au pixel près pour zéro layout shift, rend le vrai
// <Nav current="analyse" />, puis remplace chaque section data-driven par un squelette neutre.
export default function Loading() {
  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current="analyse" />

        {/* En-tête — titre + sous-titre */}
        <header className="mb-6">
          <SkeletonBox className="h-6 w-56" />
          <SkeletonLine className="mt-2 h-3 w-3/4 max-w-md" />
        </header>

        <div className="space-y-5">
          {/* Sélecteur de période (presets 7/28/90 j…) */}
          <SkeletonChips n={6} />

          {/* Quelles périodes — A vs B */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SkeletonCard radius="rounded-xl" padding="p-3">
              <SkeletonBox className="h-3 w-40" />
              <SkeletonBox className="mt-2 h-4 w-48" />
            </SkeletonCard>
            <SkeletonCard radius="rounded-xl" padding="p-3">
              <SkeletonBox className="h-3 w-40" />
              <SkeletonBox className="mt-2 h-4 w-48" />
            </SkeletonCard>
          </section>

          {/* Résumé — gros chiffres + Δ (tableau KPI) */}
          <SkeletonCard>
            <SkeletonBox className="mb-4 h-4 w-24" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                  <SkeletonBox className="h-3 w-24" />
                  <SkeletonBox className="mt-2 h-7 w-20" />
                  <SkeletonLine className="mt-2 h-3 w-28" />
                </div>
              ))}
            </div>
          </SkeletonCard>

          {/* Superposition — montée en charge cumulée A vs B */}
          <SkeletonChartCard height={160} />

          {/* Charge par sport — évolution + répartition */}
          <SkeletonChartCard height={220} />

          {/* Charge par canal */}
          <SkeletonChartCard height={220} />

          {/* Récup & forme — détails (tableau KPI) */}
          <SkeletonCard>
            <SkeletonBox className="mb-4 h-4 w-56" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i}>
                  <SkeletonBox className="h-3 w-20" />
                  <SkeletonBox className="mt-2 h-5 w-16" />
                  <SkeletonLine className="mt-2 h-3 w-24" />
                </div>
              ))}
            </div>
          </SkeletonCard>

          {/* Heatmap — régularité 12 mois */}
          <SkeletonChartCard height={140} />
        </div>
      </div>
    </div>
  );
}
