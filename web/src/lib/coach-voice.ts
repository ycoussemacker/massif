/** Coach-voice templates for the day verdict — pre-built French copy in the configured persona's voice
 *  (default: Gaston, « Le Bouquetin » — reassuring, tutoiement, sober mountain metaphors, rare emojis).
 *  PURE & **LLM-free**: turns the structured DayProgress into the headline shown on the dashboard card
 *  and the version posted to the conversation. Several variants per case, picked deterministically by
 *  day (stable within a day, varies day to day) so it never reads as a single canned line.
 *
 *  Keep the voice in sync with the persona system (web/src/lib/coach-settings.ts buildPersonaInstructions);
 *  these templates encode the DEFAULT Bouquetin voice. The LLM is used only for the on-demand
 *  "Débriefer" button (commentActivities), never here. */
import type { DayProgress, DayStatus, SuggestionSize } from "./day-progress";

export type VerdictTone = "ready" | "below" | "caution";

export type VerdictVoice = {
  status: DayStatus;
  tone: VerdictTone;             // drives the pill / avatar-ring accent
  pillLabel: string;            // short status chip on the coach card
  cardText: string;             // headline message shown on the dashboard
  chatText: string;             // version posted to the /coach conversation
  suggestionText: string | null; // `below` only — the concrete "what to add" line
  suggestionSportCode: string | null; // the favourite sport to suggest (for its glyph)
  isRestNote: boolean;          // rest_kept → render as a soft fused note, not a headline
  // Takes the coach-card headline ONLY once a real session is logged today (actual > 0). Before any
  // activity the morning briefing/plan stays in front — the athlete may sync many times before
  // training, so we don't judge the day prematurely. (Matches the conversation-post rule.)
  showAsHeadline: boolean;
};

type Ctx = { todaySport: string | null; suggSport: string | null };
type Variant = { card: (p: DayProgress, c: Ctx) => string; chat: (p: DayProgress, c: Ctx) => string; suggestion?: (p: DayProgress, c: Ctx) => string };

const SIZE_FR: Record<SuggestionSize, string> = {
  big: "une grosse séance",
  normal: "une séance d'intensité normale",
  light: "une séance légère",
};

const META: Record<DayStatus, { tone: VerdictTone; label: string }> = {
  reached: { tone: "ready", label: "Objectif atteint" },
  below: { tone: "below", label: "À compléter" },
  above: { tone: "caution", label: "Au-dessus de la cible" },
  rest_broken: { tone: "caution", label: "Repos entamé" },
  rest_kept: { tone: "ready", label: "Récup en cours" },
};

// "ta séance de trail" / null — avoids gendered articles ("ton/ta") on the sport noun.
const sess = (c: Ctx) => (c.todaySport ? `ta séance de ${c.todaySport.toLowerCase()}` : null);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const VARIANTS: Record<DayStatus, Variant[]> = {
  reached: [
    {
      card: (p, c) => `Belle séance — ${sess(c) ?? "te voilà"} t'amène à ${p.actual} pts sur les ${p.target} visés, soit l'essentiel du chemin. Pas à pas, c'est exactement le bon rythme : la cible était une boussole, pas une corde de rappel.`,
      chat: (p, c) => `Belle séance — ${sess(c) ?? "te voilà"} t'amène à ${p.actual} pts sur les ${p.target} que je t'avais tracés, soit l'essentiel du chemin. Pas à pas, c'est exactement le bon rythme : la cible était une boussole, pas une corde de rappel. On valide la journée, et on garde l'équilibre.`,
    },
    {
      card: (p) => `Pile dans la cible : ${p.actual} pts pour ${p.target} visés. Tu as lu le terrain juste aujourd'hui — laisse maintenant le corps assimiler, c'est là qu'on engrange.`,
      chat: (p) => `Pile dans la cible : ${p.actual} pts pour ${p.target} visés. Tu as lu le terrain juste aujourd'hui — laisse maintenant le corps assimiler, c'est là qu'on engrange. Un beau pas vers ton objectif.`,
    },
    {
      card: (p) => `Joli — ${p.actual} pts sur ${p.target}, l'essentiel du chemin est fait. On reste sûr sur nos appuis : ni trop, ni trop peu, juste ce qu'il fallait aujourd'hui.`,
      chat: (p) => `Joli — ${p.actual} pts sur ${p.target}, l'essentiel du chemin est fait. On reste sûr sur nos appuis : ni trop, ni trop peu, juste ce qu'il fallait aujourd'hui. Repose-toi bien ce soir.`,
    },
  ],
  below: [
    {
      card: (p, c) => `${sess(c) ? `${cap(sess(c)!)} a posé une base` : "Bon début"}, mais on est encore loin du sommet du jour : ${p.actual} pts sur ${p.target}, il manque ~${p.suggestion?.gap} pts. Il te reste du temps pour aller chercher le reste, sans te brûler.`,
      chat: (p, c) => `${sess(c) ? `${cap(sess(c)!)} a posé une base` : "Bon début"}, mais on est encore loin du sommet du jour : ${p.actual} pts sur ${p.target}, il manque ~${p.suggestion?.gap} pts. Il te reste du temps pour aller chercher le reste, sans te brûler — dis-moi si tu peux te libérer un créneau et je t'aide à le caler.`,
      suggestion: (p, c) => `Pour combler les ~${p.suggestion?.gap} pts : ${SIZE_FR[p.suggestion!.size]}${c.suggSport ? `, p. ex. en ${c.suggSport}` : ""} — autre chose que ta séance du jour.`,
    },
    {
      card: (p) => `Encore du chemin avant le sommet : ${p.actual} pts sur ${p.target}, il manque ~${p.suggestion?.gap}. Rien d'alarmant — mais si tu as un creux dans la journée, ce serait le bon moment d'aller le chercher.`,
      chat: (p) => `Encore du chemin avant le sommet : ${p.actual} pts sur ${p.target}, il manque ~${p.suggestion?.gap}. Rien d'alarmant — mais si tu as un creux dans la journée, ce serait le bon moment d'aller le chercher. Je peux t'aider à choisir quoi faire.`,
      suggestion: (p, c) => `Pour combler les ~${p.suggestion?.gap} pts : ${SIZE_FR[p.suggestion!.size]}${c.suggSport ? `, idéalement en ${c.suggSport}` : ""} — varie du sport déjà fait.`,
    },
  ],
  above: [
    {
      card: (p) => `Belle débauche d'énergie : ${p.actual} pts pour ${p.target} visés (+${p.overPct} %). Tu as donné — maintenant on redescend en douceur : ce soir au calme, et on laisse les jambes encaisser.`,
      chat: (p) => `Belle débauche d'énergie : ${p.actual} pts pour ${p.target} visés (+${p.overPct} %). Le D− t'a sans doute chargé plus que ne le voit ta montre, alors on redescend en douceur : ce soir au calme, et demain on reste sur du facile pour laisser les jambes encaisser.`,
    },
    {
      card: (p) => `Tu es allé bien au-delà de la cible : ${p.actual} pts pour ${p.target} (+${p.overPct} %). C'est du costaud — place maintenant au calme et à la récup pour bien transformer cet effort.`,
      chat: (p) => `Tu es allé bien au-delà de la cible : ${p.actual} pts pour ${p.target} (+${p.overPct} %). C'est du costaud — place maintenant au calme et à la récup pour bien transformer cet effort, et écoute tes appuis demain matin.`,
    },
    {
      card: (p) => `${p.actual} pts pour ${p.target} visés, tu as dépassé large (+${p.overPct} %). Sommet atteint — la sagesse maintenant, c'est de redescendre : repos actif et nuit au calme.`,
      chat: (p) => `${p.actual} pts pour ${p.target} visés, tu as dépassé large (+${p.overPct} %). Sommet atteint — la sagesse maintenant, c'est de redescendre : repos actif et nuit au calme, et on rééquilibre sur les prochains jours.`,
    },
  ],
  rest_broken: [
    {
      card: (p, c) => `Je t'avais conseillé le repos, et te voilà avec ${p.actual} pts${sess(c) ? ` après ${sess(c)}` : ""} — l'envie de bouger, je la comprends. Pas de drame : garde la suite légère et privilégie la récup.`,
      chat: (p, c) => `Je t'avais conseillé le repos, et te voilà avec ${p.actual} pts${sess(c) ? ` après ${sess(c)}` : ""} — l'envie de bouger, je la comprends. Pas de drame : écoute comment tu te sens demain matin, et on reprendra vraiment au calme pour rééquilibrer.`,
    },
    {
      card: (p) => `Repos au programme, mais tu as quand même chargé ${p.actual} pts. Bouger fait du bien à la tête — veille juste à ce que demain soit vraiment calme, pour rééquilibrer.`,
      chat: (p) => `Repos au programme, mais tu as quand même chargé ${p.actual} pts. Bouger fait du bien à la tête — veille juste à ce que demain soit vraiment calme, pour rééquilibrer. Le sentier sera toujours là.`,
    },
  ],
  // rest_kept = an ONGOING note (the day isn't over; the athlete may sync many times before training).
  // Never a definitive "victory" — just a gentle "keep resting". Rendered fused under the briefing.
  rest_kept: [
    {
      card: () => `Pas d'activité pour l'instant aujourd'hui — et c'est très bien : continue à récupérer tranquillement, c'est sur ces journées-là que ta forme se solidifie.`,
      chat: () => `Pas d'activité pour l'instant aujourd'hui — et c'est très bien : continue à récupérer tranquillement, c'est sur ces journées-là que ta forme se solidifie.`,
    },
    {
      card: () => `Rien de chargé pour le moment, et c'est exactement le plan du jour. Profite du repos sans culpabiliser : un cabri sage sait aussi s'arrêter pour mieux repartir.`,
      chat: () => `Rien de chargé pour le moment, et c'est exactement le plan du jour. Profite du repos sans culpabiliser : un cabri sage sait aussi s'arrêter pour mieux repartir.`,
    },
    {
      card: () => `Journée calme jusqu'ici — laisse-la le rester si tu peux. Le repos travaille pour toi en silence, et le sentier sera toujours là demain.`,
      chat: () => `Journée calme jusqu'ici — laisse-la le rester si tu peux. Le repos travaille pour toi en silence, et le sentier sera toujours là demain.`,
    },
  ],
};

/** Deterministic, content-stable variant index (no Math.random → no flicker across renders/syncs). */
function pickIndex(seed: string, n: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return n > 0 ? h % n : 0;
}

/** Build the coach-voice verdict from the structured progress. `seed` (the local date) keeps the
 *  chosen variant stable through the day. Returns null when there's no verdict to show. */
export function buildVerdictVoice(p: DayProgress | null, c: Ctx, seed: string): VerdictVoice | null {
  if (!p) return null;
  const meta = META[p.status];
  const variants = VARIANTS[p.status];
  const v = variants[pickIndex(seed, variants.length)];
  return {
    status: p.status,
    tone: meta.tone,
    pillLabel: meta.label,
    cardText: v.card(p, c),
    chatText: v.chat(p, c),
    suggestionText: v.suggestion ? v.suggestion(p, c) : null,
    suggestionSportCode: p.suggestion?.sportCode ?? null,
    isRestNote: p.status === "rest_kept",
    showAsHeadline: p.status !== "rest_kept" && p.actual > 0,
  };
}
