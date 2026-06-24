// Primitives de squelette de chargement partagées (composants serveur, neutres = stone).
// Réutilisées par les loading.tsx de chaque route et par les fallbacks <Suspense>.

// L'atome : un bloc pulsant neutre (respecte motion-reduce).
export function SkeletonBox({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-stone-200 motion-reduce:animate-none dark:bg-stone-800 ${className ?? ""}`}
    />
  );
}

// Une ligne de texte shimmer (par défaut pleine largeur, surchargeable).
export function SkeletonLine({ className }: { className?: string }) {
  return <SkeletonBox className={`h-4 w-full ${className ?? ""}`} />;
}

// Conteneur carte bordé (bordered-not-shadowed) enveloppant son contenu. Padding et radius sont des
// PROPS (pas des classes à surcharger) : en Tailwind, deux utilitaires de même propriété (p-4 vs p-5)
// se départagent par l'ordre dans le CSS généré, pas par l'ordre dans la className — un override ajouté
// derrière serait silencieusement ignoré. Chaque carte miroir doit matcher le padding de sa vraie carte
// pour un layout-shift nul.
export function SkeletonCard({
  className,
  children,
  padding = "p-5",
  radius = "rounded-2xl",
}: {
  className?: string;
  children?: React.ReactNode;
  padding?: string;
  radius?: string;
}) {
  return (
    <div
      className={`${radius} ${padding} border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

// Miroir d'une tuile dashboard : label court, valeur, sous-ligne fine.
export function SkeletonTile() {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <SkeletonBox className="h-3 w-16" />
      <SkeletonBox className="mt-2 h-7 w-16" />
      <SkeletonBox className="mt-2 h-3 w-20" />
    </div>
  );
}

// Carte graphe : ligne d'en-tête + zone-de-graphe pulsante de hauteur fixée.
export function SkeletonChartCard({ height = 220 }: { height?: number }) {
  return (
    <SkeletonCard>
      <SkeletonBox className="h-4 w-40" />
      <div
        style={{ height }}
        className="mt-4 w-full animate-pulse rounded bg-stone-200 motion-reduce:animate-none dark:bg-stone-800"
      />
    </SkeletonCard>
  );
}

// n lignes d'activité shimmer empilées (glyphe + 2 lignes + nombre à droite).
export function SkeletonActivityRows({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <SkeletonBox className="h-9 w-9 rounded-lg" />
          <div className="flex-1">
            <SkeletonBox className="h-4 w-1/2" />
            <SkeletonBox className="mt-1 h-3 w-1/4" />
          </div>
          <SkeletonBox className="h-5 w-12" />
        </div>
      ))}
    </div>
  );
}

// Rangée de n pilules shimmer (pastilles plan-semaine / chips de filtre).
export function SkeletonChips({ n = 7 }: { n?: number }) {
  return (
    <div className="flex gap-2 overflow-hidden">
      {Array.from({ length: n }).map((_, i) => (
        <SkeletonBox key={i} className="h-12 w-12 rounded-full" />
      ))}
    </div>
  );
}
