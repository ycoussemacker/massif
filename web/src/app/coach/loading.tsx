import { Nav } from "@/components/nav";
import { SkeletonBox, SkeletonCard, SkeletonLine } from "@/components/skeletons";

// État de chargement instantané de /coach (fallback du <Suspense> implicite à la navigation).
// Réplique EXACTEMENT le cadre externe de page.tsx pour zéro layout shift, puis squelette neutre du fil.
// Composant serveur pur — pas de "use client", pas de données.
export default function CoachLoading() {
  return (
    <div className="flex h-[100dvh] flex-col bg-page pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] font-sans text-stone-900 dark:text-stone-100">
      {/* Barre de nav — DESKTOP uniquement, comme dans page.tsx (Nav est sans données, sûr ici). */}
      <div className="mx-auto hidden w-full max-w-5xl px-4 pt-6 sm:px-6 sm:pt-8 md:block">
        <Nav current="coach" />
      </div>
      {/* Zone d'échange — même cadre (max-w-3xl, paddings) que la vraie page. */}
      <div className="mx-auto flex w-full min-h-0 max-w-3xl flex-1 flex-col overflow-hidden px-4 pt-3 pb-4 sm:px-6 md:pt-0">
        {/* En-tête coach : avatar + nom (≈ <h1>). */}
        <header className="mb-2">
          <div className="flex min-w-0 items-center gap-2">
            <SkeletonBox className="h-9 w-9 shrink-0 rounded-full" />
            <SkeletonLine className="h-7 w-40" />
          </div>
        </header>

        {/* Fil de messages : bulles de largeurs variées, alternées gauche/droite. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-hidden py-2">
          <SkeletonCard className="mr-auto max-w-[75%]">
            <SkeletonLine className="w-48" />
            <SkeletonLine className="mt-2 w-64" />
            <SkeletonLine className="mt-2 w-40" />
          </SkeletonCard>
          <SkeletonCard className="ml-auto max-w-[60%]">
            <SkeletonLine className="w-40" />
            <SkeletonLine className="mt-2 w-28" />
          </SkeletonCard>
          <SkeletonCard className="mr-auto max-w-[70%]">
            <SkeletonLine className="w-56" />
            <SkeletonLine className="mt-2 w-44" />
          </SkeletonCard>
          <SkeletonCard className="ml-auto max-w-[50%]">
            <SkeletonLine className="w-32" />
          </SkeletonCard>
        </div>

        {/* Barre de saisie en bas. */}
        <SkeletonBox className="h-12 w-full rounded-2xl" />
      </div>
    </div>
  );
}
