import Link from "next/link";
import { SyncRefresh } from "@/components/sync-refresh";
import { MobileTopBar } from "@/components/mobile-top-bar";

type Tab = "dashboard" | "calendrier" | "activites" | "analyse" | "coach" | "profil";

const svg = "h-5 w-5";
const IconDashboard = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={svg} aria-hidden>
    <path d="M3 3v18h18" />
    <path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
  </svg>
);
const IconActivites = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={svg} aria-hidden>
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);
const IconAnalyse = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={svg} aria-hidden>
    <rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" />
  </svg>
);
const IconCoach = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={svg} aria-hidden>
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
  </svg>
);
const IconCalendrier = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={svg} aria-hidden>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M3 10h18" /><path d="M8 2v4" /><path d="M16 2v4" />
  </svg>
);
const IconProfil = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={svg} aria-hidden>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const TABS: { key: Tab; href: string; label: string; short: string; icon: React.ReactNode }[] = [
  { key: "dashboard", href: "/", label: "Tableau de bord", short: "Accueil", icon: IconDashboard },
  { key: "calendrier", href: "/calendrier", label: "Calendrier", short: "Agenda", icon: IconCalendrier },
  { key: "activites", href: "/activites", label: "Activités", short: "Activités", icon: IconActivites },
  { key: "analyse", href: "/analyse", label: "Analyse", short: "Analyse", icon: IconAnalyse },
  { key: "coach", href: "/coach", label: "Coach", short: "Coach", icon: IconCoach },
  { key: "profil", href: "/profil", label: "Profil", short: "Profil", icon: IconProfil },
];
// Mobile bottom island (compact icon-over-label): Accueil · Agenda · Activités · Profil — the daily-driver
// tabs. Analyse (deep dive) is desktop-only on mobile, reached via contextual links; Coach is excluded so
// a fixed nav never sits under the chat input. Explicit list (not a filter) keeps it to 4 — no crowding.
const BOTTOM_KEYS: Tab[] = ["dashboard", "calendrier", "activites", "profil"];
const BOTTOM_TABS = BOTTOM_KEYS.map((k) => TABS.find((t) => t.key === k)!);

/** The Massif wordmark — lowercase grotesque + a Summit-orange dot (mirrors the brand hero). */
function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="Massif — accueil"
      className="shrink-0 text-lg font-bold tracking-tight text-stone-900 transition-opacity hover:opacity-70 dark:text-stone-100"
    >
      massif<span className="text-summit-500">.</span>
    </Link>
  );
}

/** Shared navigation. Server component — each page passes the active tab.
 *  Desktop (md+): a top app-bar — wordmark + three text tabs, active marked by an Alpine baseline
 *  indicator. Mobile (< md): a slim top bar (wordmark + a gradient "coach" button) and a fixed,
 *  frosted bottom island with just two labelled tabs (Accueil / Profil). The bottom island is hidden
 *  on the coach page so the chat input + keyboard have the screen to themselves. */
export function Nav({ current }: { current: Tab }) {
  const onCoach = current === "coach";

  return (
    <>
      {/* On-demand sync: desktop floating button + mobile pull-to-refresh (mounted once, global). */}
      <SyncRefresh />

      {/* Desktop / paysage : app-bar haute (wordmark + onglets, indicateur Alpine sur l'actif) */}
      <nav className="mb-6 hidden items-center justify-between gap-4 border-b border-stone-200 md:flex dark:border-stone-800">
        <Wordmark />
        <div className="flex items-center gap-1 text-sm">
          {TABS.map((t) => {
            const on = t.key === current;
            return (
              <Link
                key={t.key}
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={`relative px-3 py-3 font-medium transition-colors ${
                  on
                    ? "text-stone-900 dark:text-stone-100"
                    : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200"
                }`}
              >
                {t.label}
                {on && (
                  <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-alpine-600 dark:bg-alpine-400" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Mobile : barre haute UNIQUEMENT sur l'accueil (marque + accès coach). Suit le scroll : se
          masque en descendant, réapparaît en semi-transparence dès un petit scroll vers le haut.
          Profil & coach n'ont pas de top-bar mobile — ils mènent avec leur propre titre / en-tête. */}
      {current === "dashboard" && <MobileTopBar />}

      {/* Mobile : île flottante en bas — 2 onglets labélisés, animés. Masquée sur la page coach
          (jamais de barre fixe sous une fenêtre de discussion + clavier). */}
      {!onCoach && (
        <nav
          aria-label="Navigation"
          className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] md:hidden"
        >
          <div className="flex items-center gap-0.5 rounded-3xl border border-stone-200/80 bg-white/85 p-1.5 shadow-lg shadow-stone-900/10 backdrop-blur-md dark:border-stone-700/70 dark:bg-stone-900/85">
            {BOTTOM_TABS.map((t) => {
              const on = t.key === current;
              return (
                <Link
                  key={t.key}
                  href={t.href}
                  aria-label={t.label}
                  aria-current={on ? "page" : undefined}
                  className={`flex flex-col items-center gap-0.5 rounded-2xl px-3.5 py-1.5 text-[10px] font-medium transition-transform active:scale-95 ${
                    on
                      ? "animate-nav-pop bg-alpine-100 text-alpine-700 motion-reduce:animate-none dark:bg-alpine-900/50 dark:text-alpine-300"
                      : "text-stone-500 dark:text-stone-400"
                  }`}
                >
                  {t.icon}
                  <span className="whitespace-nowrap">{t.short}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
