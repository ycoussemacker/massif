import { getProfilePageData } from "@/lib/profile";
import { Nav } from "@/components/nav";
import { ProfileForm } from "@/components/profile-form";
import { GoalsEditor } from "@/components/goals-editor";
import { HrZonesPanel } from "@/components/hr-zones";
import { BriefingModeSetting } from "@/components/briefing-mode-setting";
import { Connections } from "@/components/connections";

export const dynamic = "force-dynamic"; // toujours refléter les dernières modifs / le dernier sync

export default async function ProfilPage({
  searchParams,
}: {
  searchParams: Promise<{ strava?: string }>;
}) {
  const [{ profile, goals, sports, connections, briefingMode }, sp] = await Promise.all([
    getProfilePageData(),
    searchParams,
  ]);

  return (
    <div className="min-h-full overflow-x-hidden bg-page pt-[env(safe-area-inset-top)] font-sans text-stone-900 dark:text-stone-100">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 md:pb-8">
        <Nav current="profil" />

        <header className="mb-6">
          <h1 className="text-lg font-bold tracking-tight">
            Profil <span className="font-normal text-stone-400">— Parle-nous de toi</span>
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Personnalise tes données, tes objectifs et tes connexions. Le coach raisonne sur ces informations.
          </p>
        </header>

        <div className="space-y-6">
          <GoalsEditor goals={goals} sports={sports} />
          <BriefingModeSetting initial={briefingMode} />
          <ProfileForm profile={profile} />
          <HrZonesPanel zones={profile?.hr_zones ?? null} />
          <Connections status={connections} justConnected={sp?.strava === "ok"} />
        </div>

        <footer className="mt-8 text-center text-xs text-stone-400">
          Massif · application mono-utilisateur (l&apos;hébergement multi-utilisateur ajoutera la gestion de comptes)
        </footer>
      </div>
    </div>
  );
}
