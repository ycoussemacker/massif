import { Nav } from "@/components/nav";
import { SkeletonBox, SkeletonCard, SkeletonLine } from "@/components/skeletons";

// Tuile-carte squelette miroir du <Card> de la page (rounded-2xl border p-4) :
// petit titre (uppercase) + n lignes label/valeur.
function SkeletonDetailCard({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonCard padding="p-4">
      <SkeletonBox className="mb-3 h-3 w-24" />
      <div className="space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <SkeletonBox className="h-3.5 w-24" />
            <SkeletonBox className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

// État de chargement instantané de /seance/[id] : reproduit à l'identique le cadre externe
// (bg-page, max-w, paddings, safe-area) pour zéro layout shift, puis squelette d'en-tête + grille
// à 2 colonnes (Prévu / Réalisé). La page calcule navTab = kind === "realised" ? "activites" :
// "calendrier" — impossible à connaître avant le chargement des données, donc on retient le chemin
// d'accès dominant : une séance est le plus souvent ouverte depuis /activites (réalisée) → "activites".
export default function Loading() {
  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current="activites" />

        {/* En-tête : date, bouton retour + glyphe + titre, méta. */}
        <header className="mb-4">
          <SkeletonBox className="h-3 w-32" />
          <div className="mt-1 flex items-center gap-2">
            <SkeletonBox className="h-8 w-8 rounded-lg" />
            <SkeletonBox className="h-7 w-7 rounded-lg" />
            <SkeletonLine className="h-6 w-1/2" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <SkeletonBox className="h-3.5 w-20" />
            <SkeletonBox className="h-3.5 w-16" />
          </div>
        </header>

        {/* Grille Prévu / Réalisé. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <SkeletonDetailCard rows={5} />
          <SkeletonDetailCard rows={6} />
        </div>
      </div>
    </div>
  );
}
