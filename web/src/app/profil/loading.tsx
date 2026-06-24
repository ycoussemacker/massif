import { Nav } from "@/components/nav";
import { SkeletonCard, SkeletonLine, SkeletonBox } from "@/components/skeletons";

// État de chargement instantané de /profil (fallback du <Suspense> implicite de Next).
// Réplique EXACTEMENT le cadre externe de page.tsx pour zéro layout shift au swap.
// Composant serveur pur (statique) — neutre = stone.

// Une carte : ligne titre + n paires "label + champ".
function SkeletonFormCard({
  titleWidth = "w-40",
  pairs = 4,
}: {
  titleWidth?: string;
  pairs?: number;
}) {
  return (
    <SkeletonCard>
      <SkeletonBox className={`h-5 ${titleWidth}`} />
      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {Array.from({ length: pairs }).map((_, i) => (
          <div key={i}>
            <SkeletonLine className="h-3 w-24" />
            <SkeletonBox className="mt-2 h-9 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

export default function ProfilLoading() {
  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current="profil" />

        <header className="mb-6">
          <SkeletonBox className="h-6 w-64" />
          <SkeletonLine className="mt-2 h-3 w-80 max-w-full" />
        </header>

        <div className="space-y-6">
          {/* GoalsEditor — objectifs classés */}
          <SkeletonFormCard titleWidth="w-32" pairs={2} />
          {/* ProfileForm — identité / perso / baselines / prefs */}
          <SkeletonFormCard titleWidth="w-40" pairs={6} />
          {/* Connections — Strava / Garmin */}
          <SkeletonFormCard titleWidth="w-36" pairs={2} />
        </div>

        <footer className="mt-8 flex justify-center">
          <SkeletonBox className="h-3 w-72 max-w-full" />
        </footer>
      </div>
    </div>
  );
}
