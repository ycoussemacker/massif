import { SkeletonBox, SkeletonCard, SkeletonLine } from "@/components/skeletons";

// État de chargement de la page-gate de connexion (pas de <Nav> : on est avant l'auth).
// Réplique le centrage externe de login/page.tsx ; squelette neutre (stone), minimal et centré.
export default function LoginLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 font-sans">
      <SkeletonCard className="w-full max-w-sm">
        <SkeletonLine className="mx-auto w-32" />
        <div className="mt-6 space-y-3">
          <SkeletonBox className="h-10 w-full rounded-lg" />
          <SkeletonBox className="h-10 w-full rounded-lg" />
        </div>
      </SkeletonCard>
    </div>
  );
}
