/** Phase de périodisation courante, affichée sous l'objectif principal du dashboard (Q15/Q17).
 *  Server-compatible (pas de hooks ici) ; l'aide « ? » est le HelpButton client habituel. Neutre stone :
 *  la phase est un concept de plan, pas une physiologie (la couleur encode la physiologie, jamais la
 *  catégorie — design system). Rendu nul sans objectif daté. */
import { phaseSummaryFr, type PhaseState } from "@/lib/briefing-algo";
import { HelpButton, type HelpContent } from "@/components/help";

const PHASE_HELP: HelpContent = {
  title: "Phases d'entraînement (périodisation)",
  blocks: [
    {
      type: "p",
      text:
        "Ton objectif principal est préparé en phases, rétro-comptées depuis le jour J : " +
        "base (volume, socle aérobie) → build (spécifique : seuil, côtes, descente) → " +
        "pré-compétition (volume ↓, intensité maintenue) → affûtage (on évacue la fatigue).",
    },
    {
      type: "dl",
      items: [
        { k: "Semaine de charge", v: "on vise une montée de forme (CTL) d'environ +3 à +5 pts/semaine, portée par les jours d'endurance" },
        { k: "Semaine de décharge", v: "toutes les 3-4 sem (2:1 en build, 3:1 en base) : volume −35 %, l'intensité reste — c'est là que le corps encaisse" },
        { k: "Affûtage", v: "J−14 → J : volume −50 % en exponentiel, une qualité courte conservée, l'excentrique coupé plus tôt" },
      ],
    },
    {
      type: "example",
      text: "progresser vite ≠ être frais tous les jours : en charge, ta forme (TSB) doit rester légèrement négative ; le TSB positif se réserve pour la course.",
    },
  ],
};

export function PhaseChip({ phase }: { phase: PhaseState }) {
  const s = phaseSummaryFr(phase);
  if (!s) return null;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="rounded-full border border-stone-200 px-2 py-0.5 font-medium text-stone-600 dark:border-stone-700 dark:text-stone-300">
        Phase {s.name}
      </span>
      <span className="text-stone-500 tabular-nums dark:text-stone-400">{s.detail}</span>
      <HelpButton content={PHASE_HELP} />
    </p>
  );
}
