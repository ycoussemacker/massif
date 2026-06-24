import { Nav } from "@/components/nav";
import { SkeletonBox, SkeletonLine } from "@/components/skeletons";

// État de chargement instantané de /calendrier (fallback du <Suspense> implicite
// pendant la navigation). Cadre externe + Nav réels (zéro layout shift), sections
// pilotées par les données remplacées par des squelettes neutres (stone).
export default function CalendrierLoading() {
  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current="calendrier" />

        <h1 className="mb-4 text-lg font-bold tracking-tight text-stone-900 dark:text-stone-50 md:hidden">Calendrier</h1>

        {/* Barre d'outils : navigation mois/semaine + bascule (miroir de la vraie page) */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SkeletonBox className="h-8 w-9 rounded-lg" />
            <SkeletonLine className="h-4 w-40" />
            <SkeletonBox className="h-8 w-9 rounded-lg" />
          </div>
          <SkeletonBox className="h-9 w-40 rounded-lg" />
        </div>

        {/* Grille calendrier : 7 colonnes × ~5 semaines de cellules carrées */}
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }).map((_, i) => (
            <SkeletonBox key={i} className="aspect-square rounded-lg" />
          ))}
        </div>

        <div className="mt-6 flex justify-center">
          <SkeletonLine className="h-3 w-64" />
        </div>
      </div>
    </div>
  );
}
