import { Nav } from "@/components/nav";
import { DashboardBodySkeleton } from "@/components/dashboard-skeleton";

// État de chargement instantané de la route dashboard. Rend le même cadre externe + le vrai <Nav>
// (composant serveur sans données) + le squelette du corps, pour un shell affiché sans attendre la DB.
export default function Loading() {
  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current="dashboard" />
        <DashboardBodySkeleton />
      </div>
    </div>
  );
}
